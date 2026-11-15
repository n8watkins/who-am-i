// Who Am I? as a game the party room hosts (n8watkins/n8-party-games, party-kit/GAME-CONTRACT.md):
// the `game` a party site imports from this package (party.ts) and runs in its party room.
//
// It is built on the adapter (./game.ts), which is built on the rules engine
// (src/worker/engine.ts); neither changes. What this layer adds is what the party room needs and
// the adapter did not have: the room's settings (first to 3 by default), a viewer the room may
// pass that the adapter does not know (a watcher's seat, a future audience), ending early when a
// player leaves, a carry the room can keep, and a save that holds all of it.
//
// Secrecy is the point of the game, and holds here too:
// - A player's snapshot never names their own identity, or a hint for it they did not ask for,
//   until their round is over. The screen, a member who is watching, and anyone the game does
//   not recognise get the screen's view: whose turn, the timer and the question count.
// - Identities are drawn with crypto.getRandomValues inside the adapter. The room's `seed` is
//   never read.
// - `result`, `standings` and events go to everyone, so none of them names an identity. `carry`
//   names identities, and the room never sends it to a page.
import { z } from "zod";
import {
  DIFFICULTIES,
  HOST_OVERRIDE_AFTER_MS,
  MODES,
  NicknameSchema,
  PACK_IDS,
  QUESTION_MODES,
  TURN_FORMATS,
  type RoomView,
  type Settings,
} from "../shared/protocol";
import { absentSince } from "../kit/shared/presence";
import { getIdentity } from "../worker/content";
import { playerById } from "../worker/engine";
import {
  ROOM_IDLE_MS,
  game as adapter,
  cryptoSources,
  type Carry,
  type GameState as Match,
  type InputResult,
  type PresenceReport,
  type ScreenView,
  type Sources,
} from "./game";
import { MATCH_LENGTHS, SETTING_FIELDS, manifest } from "./manifest";
import type { AudienceView, PlayerSnapshot, RoomScreenView, RoomSnapshot } from "./snapshots";

export { cryptoSources, type Carry, type Sources };

/** The host's choices in a party room, as the settings step hands them over. Every field has a default. */
export const RoomSettingsSchema = z.object({
  packId: z.enum(PACK_IDS).default("mixed"),
  mode: z.enum(MODES).default("twenty_questions"),
  turnFormat: z.enum(TURN_FORMATS).default("trade"),
  questions: z.enum(QUESTION_MODES).default("both"),
  timerSeconds: z.union([z.literal(0), z.literal(60), z.literal(90)]).default(0),
  hints: z.boolean().default(true),
  difficulty: z.enum(DIFFICULTIES).default("medium"),
  match: z.enum(MATCH_LENGTHS).default("first_to_3"),
});
export type RoomSettings = z.infer<typeof RoomSettingsSchema>;

/** How long a dropped phone's seat is held before the room gives up on it (`game.reconnectGraceMs`). */
export const RECONNECT_GRACE_MS = 10 * 60_000;

/**
 * How long a player must have been gone (dropped, or their page hidden) before the other leaving
 * the party no longer hands them the win: the same 30 seconds after which the guesser may confirm
 * their own guess without them.
 */
const ABSENT_MS = HOST_OVERRIDE_AFTER_MS;

/** The longest a carry may be as JSON. The party room keeps at most 4 KB; this leaves room to spare. */
export const CARRY_MAX_BYTES = 3_500;

/** The game's state in a party room. Server-only: it holds both identities. */
export interface RoomGameState {
  /** The match, as the adapter keeps it. */
  match: Match;
  settings: RoomSettings;
  /** First to this many points ends the match; null leaves it to the engine (first to 5, or 10 rounds). */
  pointsToWin: number | null;
}

/** The game's own settings and the match target for a room's choices. */
function engineSettings(settings: RoomSettings): { settings: Settings; pointsToWin: number | null } {
  const { match, ...rest } = settings;
  return {
    settings: {
      ...rest,
      matchType: match === "rounds_10" ? "rounds" : "points",
      // The party's host may not be playing, so "host" and "opponent" mean nothing here.
      firstPlayer: "random",
    },
    pointsToWin: match === "first_to_3" ? 3 : null,
  };
}

export type { AudienceView, PlayerSnapshot, RoomScreenView, RoomSnapshot };

export type Viewer = { role?: unknown; seat?: unknown } | null | undefined;

/**
 * The result the room sends everyone at the end, in the contract's shape for a game that keeps
 * score: one row per seat, best first, so the room's end card shows each score beside the place.
 * No identity. Who won is in the places (`standings`), and why a match ended early in the room's
 * own card (`last.early`).
 */
export type RoomResult = { seat: number; score: number }[];

const playerOf = (seat: number) => `seat-${seat}`;

/** A party name as the engine's own nickname rule has it; a name it refuses becomes "Player". */
function nicknameOf(name: unknown): string {
  const parsed = NicknameSchema.safeParse(typeof name === "string" ? name : "");
  return parsed.success ? parsed.data : "Player";
}

/** A carry as this game writes it, or null for anything else (it comes back from the room's storage). */
function carryOf(value: unknown): Carry | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<Carry>;
  const seat = (s: unknown): s is number => Number.isInteger(s);
  if (!Array.isArray(c.seats) || c.seats.length !== 2 || !c.seats.every(seat)) return null;
  if (!Array.isArray(c.usedIdentityIds) || !c.usedIdentityIds.every((id) => typeof id === "string")) return null;
  if (!(c.winnerSeat === null || seat(c.winnerSeat)) || typeof c.tie !== "boolean" || !seat(c.firstSeat)) return null;
  return { seats: [c.seats[0]!, c.seats[1]!], usedIdentityIds: c.usedIdentityIds, winnerSeat: c.winnerSeat, tie: c.tie, firstSeat: c.firstSeat };
}

/**
 * The engine ends a points match at 5. A party room's first to 3 ends it at the end of the round
 * that reaches 3, the same way the engine ends one at 5: the round's summary says the match is
 * over, and the next tap there shows the match summary, where the room takes over.
 */
function applyTarget(state: RoomGameState): void {
  const room = state.match.room;
  const target = state.pointsToWin;
  if (target === null || room.settings.matchType !== "points") return;
  if (room.status !== "round_summary" || !room.lastRoundSummary || room.lastRoundSummary.matchOver) return;
  if (Math.max(...room.players.map((p) => p.score)) < target) return;
  const next = structuredClone(room);
  next.lastRoundSummary!.matchOver = true;
  const [first, second] = [...next.players].sort((x, y) => y.score - x.score);
  const tie = !!first && !!second && first.score === second.score;
  next.match = { winnerId: tie || !first ? null : first.id, tie, rounds: next.roundIndex };
  state.match.room = next;
}

function seatList(state: RoomGameState): readonly number[] {
  return state.match.seats;
}

/**
 * Whether the match is decided: its last round's summary says the match is over (the engine's
 * own end, or first to 3), or the match summary is showing. From then on its result and places
 * are final, whoever leaves; only the tap to the match summary is still to come.
 */
function decided(state: RoomGameState): boolean {
  const room = state.match.room;
  if (!room.match) return false;
  return room.status === "match_summary" || (room.status === "round_summary" && !!room.lastRoundSummary?.matchOver);
}

/** The scores of both seats, from the match as it stands. */
function scoresOf(state: RoomGameState): { seat: number; score: number }[] {
  const room = state.match.room;
  return seatList(state).map((seat) => ({ seat, score: playerById(room, playerOf(seat))?.score ?? 0 }));
}

/** Both seats' scores, best first (seat order on a tie). */
function bestFirst(state: RoomGameState): RoomResult {
  return [...scoresOf(state)].sort((x, y) => y.score - x.score);
}

/** The final result of a decided match, or null while it is still being played. */
function decidedResult(state: RoomGameState): RoomResult | null {
  return decided(state) ? bestFirst(state) : null;
}

/** Places for a decided match: the winner first, both first after a tie. */
function decidedStandings(state: RoomGameState): { seat: number; place: number }[] {
  if (!decided(state)) return [];
  const sorted = bestFirst(state);
  return sorted.map((row) => ({ seat: row.seat, place: 1 + sorted.filter((other) => other.score > row.score).length }));
}

function screenOf(state: RoomGameState, now: number): RoomScreenView {
  const view = adapter.snapshot(state.match, now, { role: "screen" }) as ScreenView;
  return { ...view, match: state.settings.match };
}

function audienceOf(state: RoomGameState, now: number): AudienceView {
  const { role: _role, ...screen } = screenOf(state, now);
  const room = state.match.room;
  const round = room.round;
  return {
    ...screen,
    role: "audience",
    scores: seatList(state).map((seat) => ({ seat, score: playerById(room, playerOf(seat))?.score ?? 0 })),
    identities: round
      ? seatList(state).flatMap((seat) => {
          const id = round.assignments[playerOf(seat)];
          if (!id) return [];
          const identity = getIdentity(id);
          return [{ seat, identity: { id: identity.id, canonicalName: identity.canonicalName, categoryId: identity.categoryId } }];
        })
      : [],
  };
}

export const game = {
  id: manifest.id,
  minSeats: 2,
  maxSeats: 2,
  /** Turn-based: the room never ticks it on a timer, and wakes for an input or `nextDeadline`. */
  tickHz: 0,
  /**
   * A dropped phone keeps its seat for ten minutes (a locked phone, a lost signal, a reload), and
   * the turn timer pauses meanwhile. A phone that has not come back by then is gone for good: the
   * room ends the match through `abandon`, and the player who stayed wins it. Without a limit the
   * player left behind could do nothing but leave, and leaving would hand the win to the one who
   * vanished. A hidden page whose socket stays open is not a drop: the room closes such a socket
   * only once it has been silent this long, so a ghost is given up on the same way.
   */
  reconnectGraceMs: RECONNECT_GRACE_MS,
  /** A match is people talking, with a tap now and then: two locked phones must not lose it. */
  idleShutdownMs: ROOM_IDLE_MS,
  staleRoomMs: ROOM_IDLE_MS,

  /**
   * Checks the host's choices (the party room's settings step) and returns them clean, with the
   * defaults filled in, or refuses them. Missing settings are the defaults: a match first to 3.
   */
  settings(value: unknown): RoomSettings | { ok: false; error: string; message: string } {
    const parsed = RoomSettingsSchema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;
    const issue = parsed.error.issues[0];
    return { ok: false, error: "bad_settings", message: issue ? `${issue.path.join(".") || "settings"}: ${issue.message}` : "Those settings cannot be used." };
  },

  /**
   * A match begins with the party's two seats, both here (they just voted). `seed` is not read:
   * the identities come from a secure random source inside the game. `settings` and `carry` are
   * what the party room passes once it has a settings step and keeps a rematch's carry; without
   * them the match is the defaults, with a random first guesser.
   */
  create(input: { seed?: unknown; seats: readonly { seat: number; name?: unknown }[]; now: number; round?: unknown; settings?: unknown; carry?: unknown; sources?: Sources }): RoomGameState {
    if (input.seats.length !== 2) throw new Error("Who Am I? takes exactly two seats");
    const checked = game.settings(input.settings);
    if ("ok" in checked) throw new Error(checked.message);
    const { settings, pointsToWin } = engineSettings(checked);
    const match = adapter.create({
      seats: input.seats.map((s) => ({ seat: s.seat, name: nicknameOf(s.name) })),
      settings,
      now: input.now,
      carry: carryOf(input.carry),
      ...(input.sources ? { sources: input.sources } : {}),
    });
    return { match, settings: checked, pointsToWin };
  },

  /**
   * One command from a seat: the engine's own commands, with `commandId` and `expectedVersion`,
   * answered `{ok: true}` or `{ok: false, error, message}`. A turn whose deadline has passed ends
   * first. The lobby's, settings' and rematch commands are refused: the room owns those.
   */
  input(state: RoomGameState, seat: number, data: unknown, now: number, sources: Sources = cryptoSources): InputResult {
    const result = adapter.input(state.match, seat, data, now, sources);
    applyTarget(state);
    return result;
  },

  /** What this viewer may see. Anyone who is not one of the two players, or not known, gets the screen's view. */
  snapshot(state: RoomGameState, now: number, viewer?: Viewer): RoomSnapshot {
    const role = viewer && typeof viewer === "object" ? viewer.role : undefined;
    const seat = viewer && typeof viewer === "object" ? viewer.seat : undefined;
    if (role === "player" && typeof seat === "number" && seatList(state).includes(seat)) {
      const view = adapter.snapshot(state.match, now, { role: "player", seat }) as RoomView;
      return { ...view, role: "player", seat, match: state.settings.match };
    }
    if (role === "audience") return audienceOf(state, now);
    return screenOf(state, now);
  },

  /** The turn timer's end, or null when there is none or it is paused. */
  nextDeadline(state: RoomGameState): number | null {
    return adapter.nextDeadline(state.match);
  },

  /** The room's alarm at `nextDeadline`: the turn ends as timed out, and the next one starts with its own deadline. */
  tick(state: RoomGameState, now: number, sources: Sources = cryptoSources): { k: "timed_out"; seat: number }[] {
    const events = adapter.tick(state.match, now, sources);
    applyTarget(state);
    return events;
  },

  /** Who is here changed: a phone gone or hidden pauses the timer, and counts towards the host's override. */
  presence(state: RoomGameState, seat: number, report: PresenceReport, now: number, sources: Sources = cryptoSources): boolean {
    return adapter.presence(state.match, seat, report, now, sources);
  },

  /**
   * A player left the party, or their phone's grace ran out: the match ends. A match already
   * decided (its last round's summary is up) ends as it was decided, whoever leaves. Otherwise the
   * player who stayed wins it and the one who left gets no place, unless the one who stayed is
   * not here either (dropped, or their page hidden, for 30 seconds or more): then nobody wins,
   * so leaving a match whose other phone vanished does not hand the vanished player the win.
   */
  abandon(state: RoomGameState, seat: number, now: number): { standings: { seat: number; place: number }[]; result: RoomResult | null; events: { k: "abandoned"; seat: number }[] } {
    const seats = seatList(state);
    const stayed = seats.find((s) => s !== seat);
    if (!seats.includes(seat) || stayed === undefined) return { standings: [], result: null, events: [] };
    if (decided(state)) return { standings: decidedStandings(state), result: decidedResult(state), events: [] };
    const room = state.match.room;
    const other = playerById(room, playerOf(stayed));
    const since = other ? absentSince(other) : null;
    const otherGone = since !== null && now - since >= ABSENT_MS;
    const rows = bestFirst(state);
    return {
      standings: otherGone ? [] : [{ seat: stayed, place: 1 }],
      // The scores as they stood; the one who stayed first when they win it.
      result: otherGone ? rows : [...rows.filter((r) => r.seat === stayed), ...rows.filter((r) => r.seat !== stayed)],
      events: [{ k: "abandoned", seat }],
    };
  },

  isOver(state: RoomGameState): boolean {
    return adapter.isOver(state.match);
  },

  /** Sent to everyone with the end: each seat's score, best first. No identity. */
  result(state: RoomGameState): RoomResult | null {
    return decidedResult(state);
  },

  /** Places for the night: the winner first, both first after a tie. */
  standings(state: RoomGameState): { seat: number; place: number }[] {
    return decidedStandings(state);
  },

  /**
   * What a rematch between the same two seats starts from: the identities this match used, so the
   * next draw avoids them, and who lost, so they guess first. Server-only: the room keeps it for
   * `create` and never sends it. Kept under the room's 4 KB by dropping the oldest identities.
   */
  carry(state: RoomGameState): Carry | null {
    const carry = adapter.carry(state.match);
    if (!carry) return null;
    const used = [...carry.usedIdentityIds];
    while (used.length && JSON.stringify({ ...carry, usedIdentityIds: used }).length > CARRY_MAX_BYTES) used.shift();
    return { ...carry, usedIdentityIds: used };
  },

  /** The whole state, for the room's save after every input. `input` sees `restore(serialize(state))`. */
  serialize(state: RoomGameState): string {
    return JSON.stringify({ shape: "who-am-i/party-room/1", state });
  },

  restore(text: string): RoomGameState {
    const saved = JSON.parse(text) as { shape?: unknown; state?: Partial<RoomGameState> };
    if (saved?.shape !== "who-am-i/party-room/1" || !saved.state) throw new Error("Not a saved Who Am I? party game");
    const { match, settings, pointsToWin } = saved.state;
    const restoredMatch = adapter.restore(JSON.stringify(match ?? null));
    const checked = RoomSettingsSchema.safeParse(settings);
    if (!checked.success) throw new Error("Not a saved Who Am I? party game");
    if (!(pointsToWin === null || (typeof pointsToWin === "number" && Number.isInteger(pointsToWin) && pointsToWin > 0))) {
      throw new Error("Not a saved Who Am I? party game");
    }
    return { match: restoredMatch, settings: checked.data, pointsToWin };
  },
};

/** The settings fields, for a test that keeps the manifest and the check in step. */
export { SETTING_FIELDS };
