// One Durable Object per room: the authoritative game server.
// It owns the room state, applies commands through the pure engine, persists every change
// before it becomes visible, and pushes a per-player filtered view to each WebSocket.
import { DurableObject } from "cloudflare:workers";
import {
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

/** Rooms are deleted after this long without any player activity. */
export const ROOM_IDLE_TTL_MS = ROOM_IDLE_MS;
const STORAGE_KEY = "room";
const CLOSE_ROOM_EXPIRED = 4000;
const CLOSE_LEFT_ROOM = 4001;
const CLOSE_REMOVED = 4002;
/** The host's open lobby refreshes the PIN this long before it would expire. */
const PIN_REFRESH_MARGIN_MS = 60_000;

export const PLAYER_ID_HEADER = "X-WhoAmI-Player";
export const ROOM_ID_HEADER = "X-WhoAmI-Room";

interface SocketAttachment {
  playerId: string;
  /** The page behind this socket is hidden. Missing on sockets accepted before away existed. */
  away?: boolean;
}

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

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const playerId = request.headers.get(PLAYER_ID_HEADER) ?? "";
    const roomId = request.headers.get(ROOM_ID_HEADER) ?? "";
    if (!this.authorized(roomId, playerId)) return new Response("Unauthorized", { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId } satisfies SocketAttachment);

    await this.expireIfDue();
    // Connecting never changes away by itself: a new page starts visible and reports otherwise.
    const away = rules.player(this.room!, playerId)?.away ?? false;
    const updated = rules.presence(this.room!, playerId, { connected: true, away }, Date.now());
    if (updated) await this.commit(updated);
    else {
      // Another tab was already connected: this visible one may end their away state.
      this.sendView(server, playerId);
      await this.syncAway(playerId);
    }

    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_PROTOCOL } });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment;
    const { playerId } = attachment;
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

  /** A player is away when every one of their open sockets reports a hidden page. */
  private async syncAway(playerId: string, except?: WebSocket): Promise<void> {
    if (!this.room) return;
    const sockets = this.ctx
      .getWebSockets(playerId)
      .filter((s) => s !== except && s.readyState === WebSocket.OPEN)
      .map((s) => ({ away: (s.deserializeAttachment() as SocketAttachment).away ?? false }));
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
    const { playerId } = ws.deserializeAttachment() as SocketAttachment;
    if (!this.room || !rules.player(this.room, playerId)) return;
    const stillOpen = this.ctx
      .getWebSockets(playerId)
      .some((s) => s !== ws && s.readyState === WebSocket.OPEN);
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
      const { playerId } = ws.deserializeAttachment() as SocketAttachment;
      if (rules.player(this.room, playerId)) this.sendView(ws, playerId);
      else ws.close(departedCloseCode, "left_room");
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
    for (const ws of this.ctx.getWebSockets(playerId)) {
      try {
        ws.close(code, reason);
      } catch {
        // Already closed.
      }
    }
  }

  private async destroy(): Promise<void> {
    const code = this.room?.code;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_ROOM_EXPIRED, "room_closed");
      } catch {
        // Already closed.
      }
    }
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
