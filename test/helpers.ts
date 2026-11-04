import { DEFAULT_SETTINGS, type Command, type Settings } from "../src/shared/protocol";
import { applyCommand, createRoom, joinRoom, setPresence, type EngineContext, type RoomState } from "../src/worker/engine";

let counter = 0;

/** A deterministic engine context with a seeded PRNG (mulberry32) and a controllable clock. */
export function testContext(seed = 1, now = 1_000_000): EngineContext & { advance(ms: number): void } {
  let state = seed >>> 0;
  const ctx = {
    now,
    random: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    newId: () => `player-${++counter}`,
    advance(ms: number) {
      ctx.now += ms;
    },
  };
  return ctx;
}

export function cmd<T extends Command["type"]>(
  room: RoomState,
  type: T,
  extra: Omit<Extract<Command, { type: T }>, "type" | "commandId" | "expectedVersion"> = {} as never,
): Extract<Command, { type: T }> {
  return { type, commandId: `cmd-${++counter}`, expectedVersion: room.version, ...extra } as Extract<
    Command,
    { type: T }
  >;
}

export function mustApply(room: RoomState, playerId: string, command: Command, ctx: EngineContext): RoomState {
  const result = applyCommand(room, playerId, command, ctx);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.error} ${result.message}`);
  return result.room;
}

/** Creates a two-player room (both connected) and optionally starts the match. */
export function setupRoom(
  opts: { settings?: Partial<Settings>; start?: boolean; seed?: number } = {},
): { room: RoomState; a: string; b: string; ctx: ReturnType<typeof testContext> } {
  const ctx = testContext(opts.seed ?? 7);
  const created = createRoom(
    { roomId: "room-1", code: "ABCDEF", nickname: "Alice", settings: { ...DEFAULT_SETTINGS, ...opts.settings } },
    ctx,
  );
  const a = created.playerId;
  const joined = joinRoom(created.room, "Bob", ctx);
  if (!joined.ok) throw new Error("join failed");
  const b = joined.playerId;
  let room = joined.room;
  room = setPresence(room, a, true, ctx)!;
  room = setPresence(room, b, true, ctx)!;
  if (opts.start !== false) {
    room = mustApply(room, a, cmd(room, "player.ready", { ready: true }), ctx);
    room = mustApply(room, b, cmd(room, "player.ready", { ready: true }), ctx);
    room = mustApply(room, a, cmd(room, "match.start"), ctx);
  }
  return { room, a, b, ctx };
}
