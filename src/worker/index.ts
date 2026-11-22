// Worker entry: serves the API and routes each room to its Durable Object.
// Static assets (the React SPA) are served by Workers static assets for every non-/api path.
import { z } from "zod";
import {
  CLIENT_VERSION,
  CLIENT_VERSION_HEADER,
  CommandSchema,
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  LEGACY_WS_PROTOCOL,
  LEGACY_WS_TOKEN_PREFIX,
  PACK_IDS,
  PinSchema,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomCodeSchema,
  WS_CLOSE,
  WS_PROTOCOL,
  type ApiError,
  type ErrorCode,
  type RoomPreview,
} from "../shared/protocol";
import pkg from "../../package.json";
import { CARD_MAX_BYTES, SHARE_PATH_PREFIX } from "../kit/shared/share-cards";
import { checkCardPng, createCard, handleShareApi, shareCardPage } from "../kit/worker/share-cards";
import { versionResponse, type VersionEnv } from "../kit/worker/version";
import { ASSETS_PATH_PREFIX, hashedAsset } from "./assets";
import { healthCheck } from "./health";
import { packInfo } from "./content";
import { PIN_DIRECTORY_NAME } from "./pin-directory";
import { allowRequest } from "./rate-limiter";
import type { RpcFailure } from "./room";
import { MissingSecretError, signSession, verifySession, type SessionClaims } from "./session";

export { RoomDurableObject } from "./room";
export { RateLimiterDurableObject } from "./rate-limiter";
export { PinDirectoryDurableObject } from "./pin-directory";

const MAX_BODY_BYTES = 4 * 1024;
const CODE_ATTEMPTS = 8;

const STATUS_BY_ERROR: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  removed: 403,
  outdated: 426,
  not_found: 404,
  room_full: 409,
  version_conflict: 409,
  invalid_transition: 409,
  rate_limited: 429,
  internal: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function error(code: ErrorCode, message: string, extra: Partial<ApiError> = {}): Response {
  return json({ ok: false, error: code, message, ...extra } satisfies ApiError, STATUS_BY_ERROR[code]);
}

function failure(result: RpcFailure): Response {
  return error(result.error, result.message, result.view ? { view: result.view } : {});
}

async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_BYTES) return error("bad_request", "Request body too large.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return error("bad_request", "Request body too large.");
    body = JSON.parse(text);
  } catch {
    return error("bad_request", "Expected a JSON body.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
  return parsed.data;
}

/** Reads a request body of at most `limit` bytes, or null if it is longer. */
async function readBytes(request: Request, limit: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("Content-Length") ?? "0") > limit) return null;
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > limit) return null;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function randomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  let code = "";
  // Rejection sampling keeps every character uniformly likely.
  const limit = 256 - (256 % ROOM_CODE_ALPHABET.length);
  while (code.length < ROOM_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && code.length < ROOM_CODE_LENGTH) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
    }
  }
  return code;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Pages from before the v2 socket handshake keep their old code across client-side navigation,
 * so one that creates or joins a game would take a real seat and then put its fresh token in a
 * logged socket header. Create and join therefore require the current client's marker. Old pages
 * show the message where create and join errors already appear.
 */
function currentClient(request: Request): boolean {
  return request.headers.get(CLIENT_VERSION_HEADER) === CLIENT_VERSION;
}

function outdatedClient(): Response {
  return error("outdated", "This page is out of date. Reload it and try again.");
}

function offeredProtocols(request: Request): string[] {
  return (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((p) => p.trim());
}

/**
 * A page built before the v2 handshake put its token in the subprotocol header. It is never
 * honoured (that would keep tokens flowing into the logs) and never reaches the room. The old
 * page only stops reconnecting on one of its fatal codes, and "room closed" is the one that keeps
 * its stored seat: it shows the room-closed screen, and a reload brings the seat back on the new
 * handshake. Any other answer makes it retry every few seconds, sending its token every time.
 */
function closeOldHandshake(): Response {
  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  server.accept();
  server.close(WS_CLOSE.roomClosed, "update_required");
  return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": LEGACY_WS_PROTOCOL } });
}

/** Verifies the signed session and that it belongs to this room's current incarnation. */
async function authenticate(env: Env, code: string, token: string | null): Promise<SessionClaims | null> {
  const claims = await verifySession(env.SESSION_SECRET, token);
  if (!claims || claims.code !== code) return null;
  return claims;
}

/** Finds the joinable room behind a PIN or code. Every miss looks the same to the caller. */
async function lookUpJoin(env: Env, value: string): Promise<RoomPreview | null> {
  if (PinSchema.safeParse(value).success) {
    const target = await env.PINS.getByName(PIN_DIRECTORY_NAME).resolve(value);
    if (!target) return null;
    const stub = env.ROOMS.getByName(target.code);
    if ((await stub.roomId()) !== target.roomId) return null;
    const preview = await stub.preview();
    return preview && !preview.full ? preview : null;
  }
  const code = RoomCodeSchema.safeParse(value);
  return code.success ? env.ROOMS.getByName(code.data).preview() : null;
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = request.method;

  // GET /api/version (which build is live: version and commit)
  if (parts[1] === "version" && parts.length === 2 && method === "GET") return versionResponse(pkg, env as Env & VersionEnv);

  // /api/share/... (shared result cards: public details, image, and the owner's visibility switch)
  if (parts[1] === "share") return (await handleShareApi(request, env, url)) ?? error("not_found", "Unknown endpoint.");

  if (parts[1] === "packs" && parts.length === 2 && method === "GET") {
    return json({ ok: true, packs: PACK_IDS.map(packInfo) });
  }

  // GET /api/join/:pinOrCode (the room preview, never a player id or token)
  if (parts[1] === "join" && parts.length === 3 && method === "GET") {
    // Both windows always count, so a burst cannot dodge the hourly limit.
    const allowed = await Promise.all([allowRequest(env, request, "pin_short"), allowRequest(env, request, "pin_long")]);
    if (!allowed.every(Boolean)) return error("rate_limited", "Too many tries. Wait a few minutes and try again.");
    const preview = await lookUpJoin(env, parts[2]!);
    return preview ? json({ ok: true, preview }) : error("not_found", "No open game matches that. Check it with the host.");
  }

  if (parts[1] !== "rooms") return error("not_found", "Unknown endpoint.");

  // POST /api/rooms
  if (parts.length === 2 && method === "POST") {
    if (!currentClient(request)) return outdatedClient();
    if (!(await allowRequest(env, request, "create"))) return error("rate_limited", "Too many rooms. Try again in a minute.");
    const body = await readJson(request, CreateRoomRequestSchema);
    if (body instanceof Response) return body;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = randomCode();
      const result = await env.ROOMS.getByName(code).create({ code, nickname: body.nickname, settings: body.settings });
      if (!result.ok) continue; // Code collision with a live room: try another.
      const token = await signSession(env.SESSION_SECRET, { roomId: result.roomId, code, playerId: result.playerId });
      return json({ ok: true, token, playerId: result.playerId, view: result.view }, 201);
    }
    return error("internal", "Could not allocate a room code. Try again.");
  }

  const parsedCode = RoomCodeSchema.safeParse(parts[2] ?? "");
  if (!parsedCode.success) return error("not_found", "That room code is not valid.");
  const code = parsedCode.data;
  const stub = env.ROOMS.getByName(code);
  const action = parts[3];

  // GET /api/rooms/:code (public preview for the join screen)
  if (parts.length === 3 && method === "GET") {
    if (!(await allowRequest(env, request, "lookup"))) return error("rate_limited", "Too many lookups. Try again in a minute.");
    const preview = await stub.preview();
    return preview ? json({ ok: true, preview }) : error("not_found", "This room does not exist or has expired.");
  }

  // POST /api/rooms/:code/join
  if (action === "join" && parts.length === 4 && method === "POST") {
    if (!currentClient(request)) return outdatedClient();
    if (!(await allowRequest(env, request, "join"))) return error("rate_limited", "Too many join attempts. Try again in a minute.");
    const body = await readJson(request, JoinRoomRequestSchema);
    if (body instanceof Response) return body;
    const result = await stub.join(body.nickname);
    if (!result.ok) return failure(result);
    const roomId = await stub.roomId();
    if (!roomId) return error("not_found", "This room does not exist or has expired.");
    const token = await signSession(env.SESSION_SECRET, { roomId, code, playerId: result.playerId });
    return json({ ok: true, token, playerId: result.playerId, view: result.view });
  }

  // GET /api/rooms/:code/ws (WebSocket). The request names only the room: the token is the
  // socket's first message, checked by the room, because request addresses and headers are logged.
  if (action === "ws" && parts.length === 4 && method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("bad_request", "Expected a WebSocket upgrade.");
    const protocols = offeredProtocols(request);
    // First, and outside the limit: it never touches the room, so it answers no code guess, and
    // a 429 would make an old page retry every few seconds with its token in the header.
    if (protocols.some((p) => p.startsWith(LEGACY_WS_TOKEN_PREFIX))) return closeOldHandshake();
    // Before anything touches the room: whether a room answers is itself an answer to a code
    // guess, and a flood of silent sockets must not crowd real players out.
    if (!(await allowRequest(env, request, "socket"))) return error("rate_limited", "Too many connections. Try again in a minute.");
    if (!protocols.includes(WS_PROTOCOL)) return error("bad_request", "Unsupported WebSocket protocol.");
    return stub.fetch(request);
  }

  const claims = await authenticate(env, code, bearerToken(request));
  if (!claims) return error("unauthorized", "Your session for this room is no longer valid.");

  // GET /api/rooms/:code/state
  if (action === "state" && parts.length === 4 && method === "GET") {
    const result = await stub.getView(claims.roomId, claims.playerId);
    return result.ok ? json(result) : failure(result);
  }

  // POST /api/rooms/:code/pin (the host swaps the PIN for a new one)
  if (action === "pin" && parts.length === 4 && method === "POST") {
    if (!(await allowRequest(env, request, "pin_new"))) return error("rate_limited", "Too many new PINs. Try again in a minute.");
    const result = await stub.renewPin(claims.roomId, claims.playerId);
    return result.ok ? json(result) : failure(result);
  }

  // POST /api/rooms/:code/share (body: the 1200x630 PNG result card the player's browser painted).
  // The card is stored private; it goes public only while the player shares it.
  if (action === "share" && parts.length === 4 && method === "POST") {
    if (!(await allowRequest(env, request, "share"))) return error("rate_limited", "Too many shares. Try again in a few minutes.");
    const png = await readBytes(request, CARD_MAX_BYTES);
    if (!png) return error("bad_request", "The card image is too large.");
    const problem = checkCardPng(png);
    if (problem) return error("bad_request", problem);
    const text = await stub.shareText(claims.roomId, claims.playerId);
    if (!text.ok) return failure(text);
    const card = await createCard(env, url.origin, { game: "who-am-i", title: text.title, description: text.description, png });
    return json(card, 201);
  }

  // POST /api/rooms/:code/commands
  if (action === "commands" && parts.length === 4 && method === "POST") {
    const command = await readJson(request, CommandSchema);
    if (command instanceof Response) return command;
    const result = await stub.command(claims.roomId, claims.playerId, command);
    return result.ok ? json(result) : failure(result);
  }

  return error("not_found", "Unknown endpoint.");
}

export default {
  async fetch(request, env): Promise<Response> {
    const health = healthCheck(request);
    if (health) return health;
    const url = new URL(request.url);
    if (url.pathname.startsWith(SHARE_PATH_PREFIX) && request.method === "GET") {
      try {
        return (await shareCardPage(request, env, url)) ?? env.ASSETS.fetch(request);
      } catch (err) {
        console.error("Share page failed", err instanceof Error ? err.message : "unknown");
        return env.ASSETS.fetch(request);
      }
    }
    if (url.pathname.startsWith(ASSETS_PATH_PREFIX)) return hashedAsset(request, env);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof MissingSecretError) {
        console.error("SESSION_SECRET is missing or too short; see .dev.vars.example");
        return error("internal", "The server is not configured.");
      }
      console.error("Unhandled API error", err instanceof Error ? err.message : "unknown");
      return error("internal", "Something went wrong.");
    }
  },
} satisfies ExportedHandler<Env>;
