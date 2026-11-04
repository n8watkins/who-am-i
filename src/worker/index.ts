// Worker entry: serves the API and routes each room to its Durable Object.
// Static assets (the React SPA) are served by Workers static assets for every non-/api path.
import { z } from "zod";
import {
  CommandSchema,
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  PACK_IDS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomCodeSchema,
  WS_PROTOCOL,
  WS_TOKEN_PREFIX,
  type ApiError,
  type ErrorCode,
} from "../shared/protocol";
import { packInfo } from "./content";
import { allowRequest } from "./rate-limiter";
import { PLAYER_ID_HEADER, ROOM_ID_HEADER, type RpcFailure } from "./room";
import { MissingSecretError, signSession, verifySession, type SessionClaims } from "./session";

export { RoomDurableObject } from "./room";
export { RateLimiterDurableObject } from "./rate-limiter";

const MAX_BODY_BYTES = 4 * 1024;
const CODE_ATTEMPTS = 8;

const STATUS_BY_ERROR: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
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

function wsToken(request: Request): string | null {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((p) => p.trim());
  if (!protocols.includes(WS_PROTOCOL)) return null;
  const tokenProtocol = protocols.find((p) => p.startsWith(WS_TOKEN_PREFIX));
  return tokenProtocol ? tokenProtocol.slice(WS_TOKEN_PREFIX.length) : null;
}

/** Verifies the signed session and that it belongs to this room's current incarnation. */
async function authenticate(env: Env, code: string, token: string | null): Promise<SessionClaims | null> {
  const claims = await verifySession(env.SESSION_SECRET, token);
  if (!claims || claims.code !== code) return null;
  return claims;
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = request.method;

  if (parts[1] === "packs" && parts.length === 2 && method === "GET") {
    return json({ ok: true, packs: PACK_IDS.map(packInfo) });
  }

  if (parts[1] !== "rooms") return error("not_found", "Unknown endpoint.");

  // POST /api/rooms
  if (parts.length === 2 && method === "POST") {
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

  // GET /api/rooms/:code/ws (WebSocket; the token travels as a subprotocol)
  if (action === "ws" && parts.length === 4 && method === "GET") {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("bad_request", "Expected a WebSocket upgrade.");
    const claims = await authenticate(env, code, wsToken(request));
    if (!claims) return error("unauthorized", "Your session for this room is no longer valid.");
    const headers = new Headers(request.headers);
    headers.set(PLAYER_ID_HEADER, claims.playerId);
    headers.set(ROOM_ID_HEADER, claims.roomId);
    return stub.fetch(new Request(request, { headers }));
  }

  const claims = await authenticate(env, code, bearerToken(request));
  if (!claims) return error("unauthorized", "Your session for this room is no longer valid.");

  // GET /api/rooms/:code/state
  if (action === "state" && parts.length === 4 && method === "GET") {
    const result = await stub.getView(claims.roomId, claims.playerId);
    return result.ok ? json(result) : failure(result);
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
    const url = new URL(request.url);
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
