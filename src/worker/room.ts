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
import {
  applyCommand,
  createRoom,
  expireTurn,
  joinRoom,
  nextDeadline,
  playerById,
  setPresence,
  type EngineContext,
  type RoomState,
} from "./engine";
import { previewOf, viewFor } from "./view";

/** Rooms are deleted after this long without any player activity. */
export const ROOM_IDLE_TTL_MS = 60 * 60 * 1000;
const STORAGE_KEY = "room";
const CLOSE_ROOM_EXPIRED = 4000;
const CLOSE_LEFT_ROOM = 4001;

export const PLAYER_ID_HEADER = "X-WhoAmI-Player";
export const ROOM_ID_HEADER = "X-WhoAmI-Room";

interface SocketAttachment {
  playerId: string;
}

export type RpcFailure = { ok: false; error: ErrorCode; message: string; view?: RoomView };
export type CreateResult = { ok: true; roomId: string; playerId: string; view: RoomView } | RpcFailure;
export type JoinResult = { ok: true; playerId: string; view: RoomView } | RpcFailure;
export type CommandResult = { ok: true; duplicate: boolean; view: RoomView } | RpcFailure;
export type ViewResult = { ok: true; view: RoomView } | RpcFailure;

function engineContext(): EngineContext {
  return {
    now: Date.now(),
    random: () => {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0]! / 2 ** 32;
    },
    newId: () => crypto.randomUUID(),
  };
}

export class RoomDurableObject extends DurableObject<Env> {
  private room: RoomState | null = null;

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
    const ctx = engineContext();
    const { room, playerId } = createRoom({ roomId: crypto.randomUUID(), ...input }, ctx);
    await this.commit(room);
    return { ok: true, roomId: room.roomId, playerId, view: viewFor(room, playerId, ctx.now) };
  }

  async preview(): Promise<RoomPreview | null> {
    return this.room ? previewOf(this.room) : null;
  }

  /** The room id is checked so tokens from an expired room with a reused code are rejected. */
  async roomId(): Promise<string | null> {
    return this.room?.roomId ?? null;
  }

  async join(nickname: string): Promise<JoinResult> {
    const room = this.room;
    if (!room) return notFound();
    const ctx = engineContext();
    const result = joinRoom(room, nickname, ctx);
    if (!result.ok) return result;
    await this.commit(result.room);
    return { ok: true, playerId: result.playerId, view: viewFor(result.room, result.playerId, ctx.now) };
  }

  async getView(roomId: string, playerId: string): Promise<ViewResult> {
    const room = this.authorized(roomId, playerId);
    if (!room) return unauthorized();
    await this.expireIfDue();
    return { ok: true, view: viewFor(this.room!, playerId, Date.now()) };
  }

  async command(roomId: string, playerId: string, command: Command): Promise<CommandResult> {
    if (!this.authorized(roomId, playerId)) return unauthorized();
    // A turn whose deadline passed ends before any command is considered (first valid transition wins).
    await this.expireIfDue();
    const ctx = engineContext();
    const result = applyCommand(this.room!, playerId, command, ctx);
    if (!result.ok) {
      const stillPlayer = playerById(this.room!, playerId);
      return stillPlayer ? { ...result, view: viewFor(this.room!, playerId, ctx.now) } : result;
    }
    if (!result.duplicate) await this.commit(result.room);
    if (command.type === "player.leave") {
      this.closeSockets(playerId, CLOSE_LEFT_ROOM, "left_room");
      if (result.room.players.length === 0) await this.destroy();
      // The leaver gets no further view of the room.
      return { ok: true, duplicate: result.duplicate, view: leftView(result.room, playerId, ctx.now) };
    }
    return { ok: true, duplicate: result.duplicate, view: viewFor(this.room!, playerId, ctx.now) };
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
    const updated = setPresence(this.room!, playerId, true, engineContext());
    if (updated) await this.commit(updated);
    else this.sendView(server, playerId);

    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": WS_PROTOCOL } });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // The only client message is a request to resend the current state.
    if (message !== "sync") return;
    const { playerId } = ws.deserializeAttachment() as SocketAttachment;
    if (this.room && playerById(this.room, playerId)) this.sendView(ws, playerId);
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
    if (!this.room || !playerById(this.room, playerId)) return;
    const stillOpen = this.ctx
      .getWebSockets(playerId)
      .some((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (stillOpen) return;
    const updated = setPresence(this.room, playerId, false, engineContext());
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
    if (!(await this.expireIfDue())) await this.scheduleAlarm();
  }

  /** Applies a due turn timeout exactly once. Returns true if the state changed. */
  private async expireIfDue(): Promise<boolean> {
    if (!this.room) return false;
    const updated = expireTurn(this.room, engineContext());
    if (!updated) return false;
    await this.commit(updated);
    return true;
  }

  private async scheduleAlarm(): Promise<void> {
    if (!this.room) return;
    const expiry = this.room.lastActivityAt + ROOM_IDLE_TTL_MS;
    const deadline = nextDeadline(this.room);
    await this.ctx.storage.setAlarm(deadline !== null ? Math.min(deadline, expiry) : expiry);
  }

  // -------------------------------------------------------------------------
  // Persistence and broadcast

  /** Persist first, then cache, then notify every connected socket with its own view. */
  private async commit(next: RoomState): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, next);
    this.room = next;
    await this.scheduleAlarm();
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const { playerId } = ws.deserializeAttachment() as SocketAttachment;
      if (playerById(this.room, playerId)) this.sendView(ws, playerId);
      else ws.close(CLOSE_LEFT_ROOM, "left_room");
    }
  }

  /** Each socket receives only its own player's filtered view. */
  private sendView(ws: WebSocket, playerId: string): void {
    if (!this.room) return;
    const message: ServerMessage = { type: "state", view: viewFor(this.room, playerId, Date.now()) };
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
  }

  private authorized(roomId: string, playerId: string): RoomState | null {
    const room = this.room;
    if (!room || room.roomId !== roomId || !playerById(room, playerId)) return null;
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
    version: room.version,
    serverNow: now,
    status: "lobby",
    settings: room.settings,
    pack: { id: room.settings.packId, name: "", description: "", size: 0 },
    youId: playerId,
    hostPlayerId: room.hostPlayerId,
    players: [],
    roundIndex: 0,
    turn: null,
    turnResults: {},
    opponentIdentity: null,
    roundSummary: null,
    matchSummary: null,
    notices: [],
  };
}
