// Who Am I? behind one edge: the rules in the shape the party kit will need to host them
// (docs/PARTY-KIT-MIGRATION.md, KR-1 to KR-8).
//
// It is a thin wrapper over the rules engine (src/worker/engine.ts) and the per-player views
// (src/worker/view.ts), and it changes neither. It imports nothing from Cloudflare or from the
// room, so it runs under plain Vitest (test/party/), and lint keeps it that way.
//
// Two layers:
// - `rules` addresses players by id and returns new states. The game's own room
//   (src/worker/room.ts) reaches the engine only through it.
// - `game` addresses players by the party room's seat numbers and keeps its state in a holder
//   the room may mutate, as the kit's games do. It is built on `rules`.
//
// Secrecy is the core rule and holds at this edge too: a player's snapshot never carries the
// identity they are guessing until their round is over, and a screen's snapshot carries no
// identity at all. Randomness comes from crypto.getRandomValues, never from the room's seed,
// which the kit sends to every client.
import {
  CommandSchema,
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Command,
  type CommandType,
  type ErrorCode,
  type RoomPreview,
  type RoomStatus,
  type RoomView,
  type Settings,
  type TurnPhase,
} from "../shared/protocol";
import { getIdentity } from "../worker/content";
import {
  applyCommand,
  createRoom,
  expireTurn,
  joinRoom,
  nextDeadline,
  pinWanted,
  playerById,
  setAway,
  setPresence,
  withPin,
  type EngineContext,
  type PlayerRecord,
  type Result,
  type RoomState,
} from "../worker/engine";
import { previewOf, viewFor } from "../worker/view";

export type { RoomState };

/** A room is deleted after this long without any player activity: two locked phones must not lose the game. */
export const ROOM_IDLE_MS = 60 * 60 * 1000;

/** Where randomness and new ids come from. Tests pass seeded ones; everything else uses `cryptoSources`. */
export interface Sources {
  /** Uniform in [0, 1). */
  random(): number;
  newId(): string;
}

export const cryptoSources: Sources = {
  random: () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0]! / 2 ** 32;
  },
  newId: () => crypto.randomUUID(),
};

function context(now: number, sources: Sources): EngineContext {
  return { now, random: () => sources.random(), newId: () => sources.newId() };
}

/** What a player's devices report: a live socket, and whether every open page is hidden. */
export interface PresenceReport {
  connected: boolean;
  away: boolean;
}

// ---------------------------------------------------------------------------
// rules: players by id, new state out. The game's own room uses these.

export const rules = {
  /** A new room with its host in the lobby. */
  open(input: { roomId: string; code: string; nickname: string; settings: Settings }, now: number, sources = cryptoSources) {
    return createRoom(input, context(now, sources));
  },

  /** Seats a second player in the lobby. */
  join(room: RoomState, nickname: string, now: number, sources = cryptoSources) {
    return joinRoom(room, nickname, context(now, sources));
  },

  /** Validates and applies one command. A repeated command id is answered, never applied again. */
  command(room: RoomState, playerId: string, command: Command, now: number, sources = cryptoSources) {
    return applyCommand(room, playerId, command, context(now, sources));
  },

  /** Ends the current turn if its deadline has passed. Null when nothing changed. */
  tick(room: RoomState, now: number, sources = cryptoSources): RoomState | null {
    return expireTurn(room, context(now, sources));
  },

  /** When the room next needs waking for the rules (a turn deadline), or null. */
  nextDeadline(room: RoomState): number | null {
    return nextDeadline(room);
  },

  /**
   * Records a player's connection and, while connected, whether they are away. Either pauses the
   * turn timer and counts towards the host override. Null when nothing changed.
   */
  presence(room: RoomState, playerId: string, report: PresenceReport, now: number, sources = cryptoSources): RoomState | null {
    const ctx = context(now, sources);
    const connected = setPresence(room, playerId, report.connected, ctx);
    if (!report.connected) return connected;
    return setAway(connected ?? room, playerId, report.away, ctx) ?? connected;
  },

  /** What one player may see: never the identity they are guessing before their round is over. */
  view(room: RoomState, playerId: string, now: number): RoomView {
    return viewFor(room, playerId, now);
  },

  /** What the join screen may see: no identities, no player ids. */
  preview(room: RoomState): RoomPreview {
    return previewOf(room);
  },

  player(room: RoomState, playerId: string): PlayerRecord | undefined {
    return playerById(room, playerId);
  },

  /** Own-site hosting only: a PIN makes sense for an occupied lobby with a free seat. */
  pinWanted(room: RoomState): boolean {
    return pinWanted(room);
  },

  /** Own-site hosting only: records the room's PIN, which is not player activity. */
  withPin(room: RoomState, pin: RoomState["pin"], now: number, sources = cryptoSources): RoomState {
    return withPin(room, pin, context(now, sources));
  },
};

// ---------------------------------------------------------------------------
// game: the party kit's shape. Players by seat number, state in a holder the room keeps.

/** A party seat as the room hands it over when the game wins the vote. */
export interface PartySeat {
  seat: number;
  name: string;
}

export type Viewer = { role: "player"; seat: number } | { role: "screen" };

/** The game's state inside a party room. Server-only: it holds both identities. */
export interface GameState {
  room: RoomState;
  /** The two party seats, in the engine's seat order (A, then B). */
  seats: [number, number];
}

/** What one match leaves for the next, so a rematch avoids its identities and the loser starts. Server-only. */
export interface Carry {
  seats: [number, number];
  usedIdentityIds: string[];
  winnerSeat: number | null;
  tie: boolean;
  /** Who guessed first in round 1 of the match that ended. */
  firstSeat: number;
}

export type InputResult = { ok: true; duplicate: boolean } | { ok: false; error: ErrorCode; message: string };

/** What a shared screen shows: turn, timer and question count. Never an identity, a hint or a question. */
export interface ScreenView {
  role: "screen";
  version: number;
  serverNow: number;
  status: RoomStatus;
  roundIndex: number;
  players: { seat: number; name: string }[];
  turn: { seat: number; phase: TurnPhase; deadline: number | null; pausedRemainingMs: number | null; questionCount: number } | null;
}

export type Snapshot = RoomView | ScreenView;

export interface MatchResult {
  winnerSeat: number | null;
  tie: boolean;
  rounds: number;
  scores: { seat: number; score: number }[];
}

/** In a party room the kit owns the lobby, settings, seats and rematches; the game takes only the match. */
const PARTY_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  "turn.correct.request",
  "turn.correct.confirm",
  "turn.correct.reject",
  "turn.correct.override",
  "turn.skip",
  "turn.pass",
  "turn.question",
  "turn.ask",
  "turn.answer",
  "turn.hint",
  "round.next",
]);

/** A party seat's player id. Seat numbers are public in the room, so the id carries nothing new. */
const playerOf = (seat: number) => `seat-${seat}`;

function seatOf(state: GameState, playerId: string | null | undefined): number | null {
  return state.seats.find((s) => playerOf(s) === playerId) ?? null;
}

function knownIdentity(id: string): boolean {
  try {
    getIdentity(id);
    return true;
  } catch {
    return false;
  }
}

function mustApply(room: RoomState, playerId: string, type: "match.start" | "match.rematch", ctx: EngineContext): RoomState {
  const result = applyCommand(room, playerId, { type, commandId: `party-${type}-${playerId}`, expectedVersion: room.version }, ctx);
  if (!result.ok) throw new Error(`${type} failed: ${result.message}`);
  return result.room;
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

export const manifest = {
  id: "who-am-i",
  name: "Who Am I?",
  blurb: "Guess the secret identity only your friend can see",
  path: "/who-am-i/",
  players: { min: 2, max: 2, solo: false },
  // Phones upright. A big screen may join, and it only ever shows turn, timer and question count.
  devices: { phone: true, desktop: true, sharedScreen: true, sideways: false },
  // The client is not packaged for the party site yet (docs/PARTY-KIT-MIGRATION.md).
  public: [] as { from: string; to: string }[],
} as const;

export const game = {
  id: manifest.id,
  minSeats: 2,
  maxSeats: 2,
  /** Turn-based: no tick loop. The room wakes at `nextDeadline` and calls `tick` (KR-2). */
  tickHz: 0,
  /** Nobody can stand in: a bot cannot see your identity and answer your questions (KR-4). */
  bots: false,
  /** A dropped or locked phone keeps its seat while the room lives; the timer pauses meanwhile (KR-4). */
  reconnectGraceMs: Infinity,
  /** KR-6. */
  idleShutdownMs: ROOM_IDLE_MS,
  staleRoomMs: ROOM_IDLE_MS,
  /** The room's seed must stay out of every client's view (KR-1). Identities never come from it anyway. */
  privateSeed: true,
  /** A screen may join: its snapshot holds no identity (KR-1). */
  screens: true,

  /** Checks the host's settings from the lobby (KR-8). Missing settings mean the defaults. */
  settings(value: unknown): { ok: true; settings: Settings } | { ok: false; error: ErrorCode; message: string } {
    const parsed = SettingsSchema.safeParse(value ?? DEFAULT_SETTINGS);
    return parsed.success
      ? { ok: true, settings: parsed.data }
      : { ok: false, error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid settings." };
  },

  /**
   * A match begins with the party's two seats, both connected (they just voted). The first seat
   * is the match's host: the one who may confirm their own guess when the other phone is gone.
   * With a carry from the same two seats it starts as a rematch: the loser guesses first and the
   * last match's identities stay out of the draw.
   */
  create(input: { seats: readonly PartySeat[]; settings?: unknown; now: number; carry?: Carry | null; sources?: Sources }): GameState {
    const { now, sources = cryptoSources } = input;
    if (input.seats.length !== 2) throw new Error("Who Am I? takes exactly two seats");
    const checked = game.settings(input.settings);
    if (!checked.ok) throw new Error(checked.message);
    const [first, second] = [...input.seats].sort((x, y) => x.seat - y.seat) as [PartySeat, PartySeat];
    const seats: [number, number] = [first.seat, second.seat];
    const ctx = context(now, sources);
    const host = playerOf(first.seat);
    const guest = playerOf(second.seat);

    let room = createRoom(
      { roomId: sources.newId(), code: "", nickname: first.name, settings: checked.settings },
      { ...ctx, newId: () => host },
    ).room;
    const joined = joinRoom(room, second.name, { ...ctx, newId: () => guest });
    if (!joined.ok) throw new Error(joined.message);
    room = setPresence(joined.room, host, true, ctx) ?? joined.room;
    room = setPresence(room, guest, true, ctx) ?? room;

    const carry = input.carry;
    if (carry && sameSeats(carry.seats, seats)) {
      // The engine's own rematch: both players asked for one at the end of the last match.
      room = structuredClone(room);
      room.status = "match_summary";
      room.match = { winnerId: carry.winnerSeat === null ? null : playerOf(carry.winnerSeat), tie: carry.tie, rounds: 0 };
      room.matchFirstPlayerId = playerOf(carry.firstSeat);
      room.usedIdentityIds = carry.usedIdentityIds.filter(knownIdentity);
      room = mustApply(room, host, "match.rematch", ctx);
      room = mustApply(room, guest, "match.rematch", ctx);
    } else {
      room = mustApply(room, host, "match.start", ctx);
    }
    return { room, seats };
  },

  /**
   * One command from a seat, answered ok or with a clear error (KR-7). A turn whose deadline has
   * passed ends first, so the first valid move wins; the room sends fresh snapshots after every
   * input, answered either way.
   */
  input(state: GameState, seat: number, data: unknown, now: number, sources = cryptoSources): InputResult {
    if (!state.seats.includes(seat)) return { ok: false, error: "forbidden", message: "That seat is not playing this game." };
    const parsed = CommandSchema.safeParse(data);
    if (!parsed.success) return { ok: false, error: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid command." };
    if (!PARTY_COMMANDS.has(parsed.data.type)) return { ok: false, error: "forbidden", message: "The party room does that, not the game." };
    game.tick(state, now, sources);
    const result: Result<{ room: RoomState; duplicate: boolean }> = rules.command(state.room, playerOf(seat), parsed.data, now, sources);
    if (!result.ok) return result;
    state.room = result.room;
    return { ok: true, duplicate: result.duplicate };
  },

  /** KR-1: a player sees their own filtered view; a screen, or a seat not in this game, sees the screen view. */
  snapshot(state: GameState, now: number, viewer: Viewer): Snapshot {
    if (viewer.role === "player" && state.seats.includes(viewer.seat)) return rules.view(state.room, playerOf(viewer.seat), now);
    return screenView(state, now);
  },

  nextDeadline(state: GameState): number | null {
    return rules.nextDeadline(state.room);
  },

  /** Called by the room's alarm at `nextDeadline`. Returns events for everyone; none carries an identity. */
  tick(state: GameState, now: number, sources = cryptoSources): { k: "timed_out"; seat: number }[] {
    const timedOut = state.room.turn?.playerId;
    const next = rules.tick(state.room, now, sources);
    if (!next) return [];
    state.room = next;
    const seat = seatOf(state, timedOut);
    return seat === null ? [] : [{ k: "timed_out", seat }];
  },

  /** KR-4 and KR-5. Returns whether anything changed. */
  presence(state: GameState, seat: number, report: PresenceReport, now: number, sources = cryptoSources): boolean {
    if (!state.seats.includes(seat)) return false;
    const next = rules.presence(state.room, playerOf(seat), report, now, sources);
    if (!next) return false;
    state.room = next;
    return true;
  },

  isOver(state: GameState): boolean {
    return state.room.status === "match_summary" && state.room.match !== null;
  },

  result(state: GameState): MatchResult | null {
    const { room } = state;
    if (!game.isOver(state) || !room.match) return null;
    return {
      winnerSeat: seatOf(state, room.match.winnerId),
      tie: room.match.tie,
      rounds: room.match.rounds,
      scores: state.seats.map((seat) => ({ seat, score: playerById(room, playerOf(seat))?.score ?? 0 })),
    };
  },

  /** Places for the party room's night score: the winner first, both first after a tie. */
  standings(state: GameState): { seat: number; place: number }[] {
    const result = game.result(state);
    if (!result) return [];
    const sorted = [...result.scores].sort((x, y) => y.score - x.score);
    return sorted.map((row) => ({ seat: row.seat, place: 1 + sorted.filter((other) => other.score > row.score).length }));
  },

  /** What the next match between the same two seats starts from (KR-8). Server-only: it names identities. */
  carry(state: GameState): Carry | null {
    const { room } = state;
    const result = game.result(state);
    const firstSeat = seatOf(state, room.matchFirstPlayerId);
    if (!result || firstSeat === null) return null;
    return { seats: [...state.seats], usedIdentityIds: [...room.usedIdentityIds], winnerSeat: result.winnerSeat, tie: result.tie, firstSeat };
  },

  /** KR-3: saved after every input and restored on wake. */
  serialize(state: GameState): string {
    return JSON.stringify(state);
  },

  restore(text: string): GameState {
    const state = JSON.parse(text) as Partial<GameState>;
    const seats = state.seats;
    if (!state.room || state.room.schema !== 1 || !Array.isArray(seats) || seats.length !== 2 || !seats.every(Number.isInteger)) {
      throw new Error("Not a saved Who Am I? game");
    }
    return { room: state.room, seats: [seats[0]!, seats[1]!] };
  },
};

function screenView(state: GameState, now: number): ScreenView {
  const { room } = state;
  const turn = room.turn;
  const turnSeat = seatOf(state, turn?.playerId);
  return {
    role: "screen",
    version: room.version,
    serverNow: now,
    status: room.status,
    roundIndex: room.roundIndex,
    players: state.seats.map((seat) => ({ seat, name: playerById(room, playerOf(seat))?.nickname ?? "" })),
    turn:
      turn && turnSeat !== null
        ? { seat: turnSeat, phase: turn.phase, deadline: turn.deadline, pausedRemainingMs: turn.pausedRemainingMs, questionCount: turn.questionCount }
        : null,
  };
}
