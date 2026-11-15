// One Durable Object per room: the authoritative game server.
// It owns the room state, applies commands through the pure engine, persists every change
// before it becomes visible, and pushes a per-player filtered view to each WebSocket.
import { DurableObject } from "cloudflare:workers";
import {
  ClientHelloSchema,
  WS_CLOSE,
  WS_PROTOCOL,
  type Command,
  type ErrorCode,
  type RoomPreview,
  type RoomView,
  type ServerMessage,
  type Settings,
} from "../shared/protocol";
import { allAway, isPresenceSignal, PRESENCE_AWAY } from "../kit/shared/presence";
import { ROOM_IDLE_MS, rules, type RoomState } from "../party/game";
import { PIN_DIRECTORY_NAME } from "./pin-directory";
import { resultCardText } from "./result-card";
import { MissingSecretError, verifySession } from "./session";

/** Rooms are deleted after this long without any player activity. */
export const ROOM_IDLE_TTL_MS = ROOM_IDLE_MS;
const STORAGE_KEY = "room";
const CLOSE_ROOM_EXPIRED: number = WS_CLOSE.roomClosed;
const CLOSE_LEFT_ROOM: number = WS_CLOSE.leftRoom;
const CLOSE_REMOVED: number = WS_CLOSE.removed;
/** The host's open lobby refreshes the PIN this long before it would expire. */
const PIN_REFRESH_MARGIN_MS = 60_000;

/**
 * Sockets that have not yet said who they are. A page sends its hello the moment the socket
 * opens, so a handful covers two players reconnecting at once; more than that is someone else.
 */
export const MAX_UNIDENTIFIED_SOCKETS = 4;
/** A silent socket older than this is closed the next time the room handles a new socket. */
export const HELLO_TIMEOUT_MS = 10_000;

/** Stored on each socket, so it survives the room sleeping (hibernation). */
interface SocketAttachment {
  /** Null until the socket's first message (a hello with a valid token) says whose seat it is. */
  playerId: string | null;
  /** When the socket opened. Set on sockets that have not said who they are. */
  openedAt?: number;
  /** The page behind this socket is hidden. */
  away?: boolean;
}

const attachmentOf = (ws: WebSocket) => ws.deserializeAttachment() as SocketAttachment;

export type RpcFailure = { ok: false; error: ErrorCode; message: string; view?: RoomView };
export type CreateResult = { ok: true; roomId: string; playerId: string; view: RoomView } | RpcFailure;
export type JoinResult = { ok: true; playerId: string; view: RoomView } | RpcFailure;
export type CommandResult = { ok: true; duplicate: boolean; view: RoomView } | RpcFailure;
export type ViewResult = { ok: true; view: RoomView } | RpcFailure;
export type ShareTextResult = { ok: true; title: string; description: string } | RpcFailure;

export class RoomDurableObject extends DurableObject<Env> {
  private room: RoomState | null = null;
  /** Calling the directory yields to other events, so PIN work runs strictly one job at a time. */
  private pinWork: Promise<void> = Promise.resolve();
  /**
   * Sockets whose hello is being checked. Their later events wait here (see identify), while
   * every other socket's events go straight through. In memory only: the room cannot sleep while
   * a check is running.
   */
  private helloGates = new Map<WebSocket, Promise<void>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>(STORAGE_KEY)) ?? null;
    });
  }

  // -------------------------------------------------------------------------
  // RPC (called only by the Worker, after it has verified the session token)

  async create(input: { code: string; nickname: string; settings: Settings }): Promise<CreateResult> {
    if (this.room) return { ok: false, error: "bad_request", message: "Room code already in use." };
    const now = Date.now();
    const { room, playerId } = rules.open({ roomId: crypto.randomUUID(), ...input }, now);
    await this.commit(room);
    // The host has no socket yet, but their lobby is about to open.
    await this.enqueuePinWork(() => this.reconcilePin(true));
    return { ok: true, roomId: room.roomId, playerId, view: rules.view(this.room!, playerId, now) };
  }

  async preview(): Promise<RoomPreview | null> {
    return this.room ? rules.preview(this.room) : null;
  }

  /** The room id is checked so tokens from an expired room with a reused code are rejected. */
  async roomId(): Promise<string | null> {
    return this.room?.roomId ?? null;
  }

  async join(nickname: string): Promise<JoinResult> {
    const room = this.room;
    if (!room) return notFound();
    const now = Date.now();
    const result = rules.join(room, nickname, now);
    if (!result.ok) return result;
    await this.commit(result.room);
    return { ok: true, playerId: result.playerId, view: rules.view(this.room!, result.playerId, now) };
  }

  async getView(roomId: string, playerId: string): Promise<ViewResult> {
    const room = this.authorized(roomId, playerId);
    if (!room) return this.denied(roomId, playerId);
    await this.expireIfDue();
    return { ok: true, view: rules.view(this.room!, playerId, Date.now()) };
  }

  /** The words for a shared result card, once the match is over. */
  async shareText(roomId: string, playerId: string): Promise<ShareTextResult> {
    if (!this.authorized(roomId, playerId)) return this.denied(roomId, playerId);
    const text = resultCardText(this.room!);
    if (!text) return { ok: false, error: "invalid_transition", message: "You can share a result once the match is over." };
    return { ok: true, ...text };
  }

  /** The host swaps the PIN, for example after someone unwanted saw it. */
  async renewPin(roomId: string, playerId: string): Promise<ViewResult> {
    const room = this.authorized(roomId, playerId);
    if (!room) return unauthorized();
    if (room.hostPlayerId !== playerId) return { ok: false, error: "forbidden", message: "Only the host can change the PIN." };
    if (!rules.pinWanted(room)) return { ok: false, error: "invalid_transition", message: "PINs are for lobbies with a free seat." };
    await this.enqueuePinWork(async () => {
      if (!this.room?.pin) return;
      await this.pinDirectory().release(this.room.code);
      await this.storePin(null);
      await this.reconcilePin(true);
    });
    return { ok: true, view: rules.view(this.room!, playerId, Date.now()) };
  }

  async command(roomId: string, playerId: string, command: Command): Promise<CommandResult> {
    if (!this.authorized(roomId, playerId)) return this.denied(roomId, playerId);
    // A turn whose deadline passed ends before any command is considered (first valid transition wins).
    await this.expireIfDue();
    const now = Date.now();
    const result = rules.command(this.room!, playerId, command, now);
    if (!result.ok) {
      const stillPlayer = rules.player(this.room!, playerId);
      return stillPlayer ? { ...result, view: rules.view(this.room!, playerId, now) } : result;
    }
    if (!result.duplicate) await this.commit(result.room, command.type === "player.remove" ? CLOSE_REMOVED : CLOSE_LEFT_ROOM);
    if (command.type === "player.leave") {
      this.closeSockets(playerId, CLOSE_LEFT_ROOM, "left_room");
      if (result.room.players.length === 0) await this.destroy();
      // The leaver gets no further view of the room.
      return { ok: true, duplicate: result.duplicate, view: leftView(result.room, playerId, now) };
    }
    return { ok: true, duplicate: result.duplicate, view: rules.view(this.room!, playerId, now) };
  }

  // -------------------------------------------------------------------------
  // WebSockets (Hibernation API)

  /**
   * Opens a socket that belongs to nobody yet. The request carries no token (its address and
   * headers are logged); the socket's first message must be a hello that names the seat, and
   * until then it is sent nothing and can do nothing.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    if (!this.room) return new Response("Not found", { status: 404 });
    const now = Date.now();
    // Silent sockets past the timeout go; then, at the cap, the oldest silent one makes room.
    // Refusing the newcomer instead would let anyone holding the slots keep real players out,
    // while a real page says hello within milliseconds, so it is never the oldest for long.
    const silent = this.unidentifiedSockets().sort((a, b) => (attachmentOf(a).openedAt ?? 0) - (attachmentOf(b).openedAt ?? 0));
    const expired = silent.filter((ws) => now - (attachmentOf(ws).openedAt ?? 0) > HELLO_TIMEOUT_MS);
    const kept = silent.filter((ws) => !expired.includes(ws));
    const evicted = [...expired, ...kept.slice(0, Math.max(0, kept.length - MAX_UNIDENTIFIED_SOCKETS + 1))];
    for (const ws of evicted) closeQuietly(ws, WS_CLOSE.helloTimeout, "hello_timeout");

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null, openedAt: now } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_PROTOCOL } });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.helloSettled(ws);
    const attachment = attachmentOf(ws);
    const { playerId } = attachment;
    if (playerId === null) return this.identify(ws, message);
    if (!this.room || !rules.player(this.room, playerId)) return;
    if (message === "sync") {
      this.sendView(ws, playerId);
      return;
    }
    // "away" / "back": the page behind this socket was hidden or shown.
    if (!isPresenceSignal(message)) return;
    ws.serializeAttachment({ ...attachment, away: message === PRESENCE_AWAY } satisfies SocketAttachment);
    await this.syncAway(playerId);
  }

  /**
   * The socket's first message. A valid hello makes it the seat's socket and it then behaves
   * as sockets always have; anything else closes it, and either way it learns nothing first.
   */
  private async identify(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const hello = typeof message === "string" ? parseHello(message) : null;
    if (!hello) return closeQuietly(ws, WS_CLOSE.reload, "expected_hello");
    // Checking the token yields, so the socket's next events wait at this gate until the socket
    // is the player's and their presence is stored, and are then handled in arrival order.
    let open!: () => void;
    this.helloGates.set(ws, new Promise<void>((resolve) => (open = resolve)));
    try {
      await this.acceptHello(ws, hello.token, open);
    } finally {
      this.helloGates.delete(ws);
      open();
    }
  }

  /** Waits until the socket's hello, if one is being checked, has been dealt with. */
  private helloSettled(ws: WebSocket): Promise<void> | undefined {
    return this.helloGates.get(ws);
  }

  /** Checks a session token. A method of its own so tests can make it slow. */
  private verifyToken(token: string) {
    return verifySession(this.env.SESSION_SECRET, token);
  }

  private async acceptHello(ws: WebSocket, token: string, open: () => void): Promise<void> {
    let claims;
    try {
      claims = await this.verifyToken(token);
    } catch (err) {
      if (err instanceof MissingSecretError) console.error("SESSION_SECRET is missing or too short; see .dev.vars.example");
      return closeQuietly(ws, 1011, "server_error");
    }
    const room = this.room;
    if (!room) return closeQuietly(ws, CLOSE_ROOM_EXPIRED, "room_closed");
    if (ws.readyState !== WebSocket.OPEN) return; // It went away while the token was checked.
    if (!claims || claims.code !== room.code || claims.roomId !== room.roomId) return closeQuietly(ws, WS_CLOSE.unauthorized, "unauthorized");
    const { playerId } = claims;
    if (!rules.player(room, playerId)) {
      const removed = room.removedPlayerIds?.includes(playerId) ?? false;
      return closeQuietly(ws, removed ? CLOSE_REMOVED : WS_CLOSE.unauthorized, removed ? "removed" : "unauthorized");
    }
    ws.serializeAttachment({ playerId } satisfies SocketAttachment);
    await this.welcome(ws, playerId, open);
  }

  /**
   * What opening a socket did before the hello existed: presence, then this player's view.
   * `open` lets the socket's next events through once that is stored, before the PIN directory
   * is called, so a slow directory never holds up the socket.
   */
  private async welcome(ws: WebSocket, playerId: string, open: () => void): Promise<void> {
    await this.expireIfDue();
    if (!this.room || !rules.player(this.room, playerId)) return;
    // Connecting never changes away by itself: a new page starts visible and reports otherwise.
    const away = rules.player(this.room, playerId)?.away ?? false;
    const updated = rules.presence(this.room, playerId, { connected: true, away }, Date.now());
    if (updated) {
      await this.store(updated);
      open();
      await this.updatePin();
    } else {
      // Another tab was already connected: this visible one may end their away state.
      this.sendView(ws, playerId);
      open();
      await this.syncAway(playerId);
    }
  }

  /** Sockets that have said whose seat they are, for one player. */
  private playerSockets(playerId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => attachmentOf(ws).playerId === playerId);
  }

  /** Open sockets that have not said who they are yet. */
  private unidentifiedSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN && attachmentOf(ws).playerId === null);
  }

  /** A player is away when every one of their open sockets reports a hidden page. */
  private async syncAway(playerId: string, except?: WebSocket): Promise<void> {
    if (!this.room) return;
    const sockets = this.playerSockets(playerId)
      .filter((s) => s !== except && s.readyState === WebSocket.OPEN)
      .map((s) => ({ away: attachmentOf(s).away ?? false }));
    if (sockets.length === 0 || !rules.player(this.room, playerId)?.connected) return;
    const updated = rules.presence(this.room, playerId, { connected: true, away: allAway(sockets) }, Date.now());
    if (updated) await this.commit(updated);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // The runtime completes the close handshake itself (web_socket_auto_reply_to_close).
    await this.socketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  private async socketGone(ws: WebSocket): Promise<void> {
    await this.helloSettled(ws);
    const { playerId } = attachmentOf(ws);
    if (playerId === null || !this.room || !rules.player(this.room, playerId)) return;
    const stillOpen = this.playerSockets(playerId).some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (stillOpen) return this.syncAway(playerId, ws);
    const updated = rules.presence(this.room, playerId, { connected: false, away: false }, Date.now());
    if (updated) await this.commit(updated);
  }

  // -------------------------------------------------------------------------
  // Timers: one alarm covers the turn deadline and idle expiry.

  override async alarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();
    if (now >= this.room.lastActivityAt + ROOM_IDLE_TTL_MS) {
      await this.destroy();
      return;
    }
    await this.expireIfDue();
    await this.updatePin();
    await this.scheduleAlarm();
  }

  /** Applies a due turn timeout exactly once. Returns true if the state changed. */
  private async expireIfDue(): Promise<boolean> {
    if (!this.room) return false;
    const updated = rules.tick(this.room, Date.now());
    if (!updated) return false;
    await this.commit(updated);
    return true;
  }

  private async scheduleAlarm(): Promise<void> {
    if (!this.room) return;
    const expiry = this.room.lastActivityAt + ROOM_IDLE_TTL_MS;
    const deadline = rules.nextDeadline(this.room);
    const pinAt = this.nextPinCheck();
    await this.ctx.storage.setAlarm(Math.min(expiry, deadline ?? Infinity, pinAt ?? Infinity));
  }

  private nextPinCheck(): number | null {
    const pin = this.room?.pin;
    if (!pin) return null;
    const now = Date.now();
    const refreshAt = pin.expiresAt - PIN_REFRESH_MARGIN_MS;
    if (now < refreshAt) return refreshAt;
    // Past the refresh point with no host around: look again when it lapses, then stop.
    return now < pin.expiresAt ? pin.expiresAt : null;
  }

  // -------------------------------------------------------------------------
  // PIN lifecycle. Everything here is best effort: a room works fine with no PIN.

  private pinDirectory() {
    return this.env.PINS.getByName(PIN_DIRECTORY_NAME);
  }

  private enqueuePinWork(job: () => Promise<void>): Promise<void> {
    this.pinWork = this.pinWork.then(job).catch((err: unknown) => {
      console.error("PIN update failed", err instanceof Error ? err.message : "unknown");
    });
    return this.pinWork;
  }

  /** Skips the queue, and any call to the directory, when the room's PIN is already right. */
  private updatePin(): Promise<void> {
    const room = this.room;
    if (!room) return this.pinWork;
    const hostConnected = rules.player(room, room.hostPlayerId)?.connected ?? false;
    const settled = rules.pinWanted(room)
      ? room.pin
        ? Date.now() < room.pin.expiresAt - PIN_REFRESH_MARGIN_MS
        : !hostConnected
      : !room.pin;
    return settled ? this.pinWork : this.enqueuePinWork(() => this.reconcilePin(false));
  }

  /** Brings the PIN in line with the room as it is now, which may be newer than when this was queued. */
  private async reconcilePin(hostIsArriving: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    const directory = this.pinDirectory();
    const { code, roomId, pin } = room;
    if (!rules.pinWanted(room)) {
      if (pin) {
        await directory.release(code);
        await this.storePin(null);
      }
      return;
    }
    const hostConnected = rules.player(room, room.hostPlayerId)?.connected ?? false;
    if (pin) {
      const now = Date.now();
      if (now < pin.expiresAt - PIN_REFRESH_MARGIN_MS) return;
      if (hostConnected) {
        const expiresAt = await directory.refresh(code);
        if (expiresAt !== null) return this.storePin({ ...pin, expiresAt });
        await this.storePin(null);
      } else {
        if (now >= pin.expiresAt) await this.storePin(null);
        return;
      }
    }
    if (!hostConnected && !hostIsArriving) return;
    const issued = await directory.issue(code, roomId);
    if (!issued) return; // The directory is full: the invite falls back to the code and QR.
    if (this.room?.roomId === roomId) await this.storePin(issued);
    else await directory.release(code);
  }

  private async storePin(pin: RoomState["pin"]): Promise<void> {
    if (this.room) await this.store(rules.withPin(this.room, pin, Date.now()));
  }

  // -------------------------------------------------------------------------
  // Persistence and broadcast

  /** Persist first, then cache, then notify every connected socket with its own view. */
  private async store(next: RoomState, departedCloseCode = CLOSE_LEFT_ROOM): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, next);
    this.room = next;
    await this.scheduleAlarm();
    this.broadcast(departedCloseCode);
  }

  private async commit(next: RoomState, departedCloseCode = CLOSE_LEFT_ROOM): Promise<void> {
    await this.store(next, departedCloseCode);
    await this.updatePin();
  }

  private broadcast(departedCloseCode: number): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const { playerId } = attachmentOf(ws);
      // A socket that has not said who it is hears nothing about the room.
      if (playerId === null) continue;
      if (rules.player(this.room, playerId)) this.sendView(ws, playerId);
      else closeQuietly(ws, departedCloseCode, "left_room");
    }
  }

  /** Each socket receives only its own player's filtered view. */
  private sendView(ws: WebSocket, playerId: string): void {
    if (!this.room) return;
    const message: ServerMessage = { type: "state", view: rules.view(this.room, playerId, Date.now()) };
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket is closing; its close handler updates presence.
    }
  }

  private closeSockets(playerId: string, code: number, reason: string): void {
    for (const ws of this.playerSockets(playerId)) closeQuietly(ws, code, reason);
  }

  private async destroy(): Promise<void> {
    const code = this.room?.code;
    for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, CLOSE_ROOM_EXPIRED, "room_closed");
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (code) await this.enqueuePinWork(() => this.pinDirectory().release(code));
  }

  /** A removed player may have missed the socket close, so they are told here too. */
  private denied(roomId: string, playerId: string): RpcFailure {
    const room = this.room;
    if (room?.roomId === roomId && room.removedPlayerIds?.includes(playerId)) {
      return { ok: false, error: "removed", message: "The host removed you from this game." };
    }
    return unauthorized();
  }

  private authorized(roomId: string, playerId: string): RoomState | null {
    const room = this.room;
    if (!room || room.roomId !== roomId || !rules.player(room, playerId)) return null;
    return room;
  }
}

function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

function parseHello(message: string) {
  if (message.length > 2048) return null;
  try {
    const parsed = ClientHelloSchema.safeParse(JSON.parse(message));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function notFound(): RpcFailure {
  return { ok: false, error: "not_found", message: "This room does not exist or has expired." };
}

function unauthorized(): RpcFailure {
  return { ok: false, error: "unauthorized", message: "Your session for this room is no longer valid." };
}

/** A minimal view for a player who just left: no identities, no opponent data. */
function leftView(room: RoomState, playerId: string, now: number): RoomView {
  return {
    code: room.code,
    pin: null,
    version: room.version,
    serverNow: now,
    status: "lobby",
    settings: room.settings,
    pack: { id: room.settings.packId, name: "", description: "", size: 0 },
    youId: playerId,
    hostPlayerId: room.hostPlayerId,
    players: [],
    roundIndex: 0,
    firstPlayerId: null,
    turn: null,
    turnResults: {},
    opponentIdentity: null,
    roundSummary: null,
    matchSummary: null,
    rematchVotes: [],
    rematchFirstPlayerId: null,
    notices: [],
  };
}
