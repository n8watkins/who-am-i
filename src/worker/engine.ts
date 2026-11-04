// Pure, deterministic room state machine. No I/O: the Durable Object persists and broadcasts.
//
// lobby -> assigning -> guessing_first -> guessing_second -> round_summary -> assigning ... -> match_summary
//                                                                                          |
//                          match_summary --(both tap Rematch)--> assigning (next match) <--+
//
// Turn order: the first guesser alternates every round. Round 1 of a match started from the
// lobby follows the host's setting (me, opponent, random). A rematch starts with the loser of
// the previous match; after a tie, with whoever went second in the previous match's round 1.
//
// Every mutation returns a new RoomState with `version` incremented exactly once.
import {
  HINTS_PER_TURN,
  HOST_OVERRIDE_AFTER_MS,
  QUESTION_RATE_LIMIT,
  POINTS_TO_WIN,
  ROUNDS_PER_MATCH,
  type Command,
  type ErrorCode,
  type RoomStatus,
  type Seat,
  type Settings,
  type TurnPhase,
  type TurnLogEntry,
  type TurnResult,
} from "../shared/protocol";
import { getIdentity, MIXED_WEIGHTS, packIdentities, type Identity, type SourcePackId } from "./content";

export const MAX_PLAYERS = 2;
const RECENT_COMMANDS_KEPT = 100;
const EVENTS_KEPT = 200;

export interface PlayerRecord {
  id: string;
  seat: Seat;
  nickname: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
  score: number;
  correct: number;
  skips: number;
  hintsUsed: number;
}

export interface TurnRecord {
  /** Unique per turn, so a late timer for an earlier turn can never end a later one. */
  id: string;
  playerId: string;
  phase: TurnPhase;
  deadline: number | null;
  pausedRemainingMs: number | null;
  questionCount: number;
  hintsUsed: number;
  /** Hints (and later questions) for this turn. Only already revealed hints are ever stored here. */
  log: TurnLogEntry[];
}

export interface RoundRecord {
  index: number;
  /** PRIVATE: player id -> id of the identity that player must guess. Never sent to that player. */
  assignments: Record<string, string>;
  results: Record<string, TurnResult>;
  /** Hints each player revealed in this round. */
  hintsUsed: Record<string, number>;
  reshuffled: boolean;
  /** [first guesser, second guesser] for this round. */
  order: [string, string];
}

export interface RoundSummaryRecord {
  roundIndex: number;
  entries: { playerId: string; identityId: string; result: TurnResult; hintsUsed: number }[];
  matchOver: boolean;
}

export type EventType =
  | "room.created"
  | "player.joined"
  | "player.ready"
  | "player.left"
  | "settings.updated"
  | "match.started"
  | "round.started"
  | "turn.correct.requested"
  | "turn.correct.rejected"
  | "turn.correct.confirmed"
  | "turn.skipped"
  | "turn.timed_out"
  | "turn.hint.revealed"
  | "turn.question.asked"
  | "turn.question.answered"
  | "round.completed"
  | "match.completed"
  | "match.rematched";

/** Event log entries carry no identity information. */
export interface RoomEvent {
  type: EventType;
  at: number;
  version: number;
  playerId?: string;
  roundIndex?: number;
}

export interface RoomState {
  schema: 1;
  roomId: string;
  code: string;
  hostPlayerId: string;
  settings: Settings;
  status: RoomStatus;
  version: number;
  players: PlayerRecord[];
  roundIndex: number;
  turn: TurnRecord | null;
  round: RoundRecord | null;
  /** Identities used in this match; cleared on reshuffle or a new match. */
  usedIdentityIds: string[];
  lastRoundSummary: RoundSummaryRecord | null;
  match: { winnerId: string | null; tie: boolean; rounds: number } | null;
  /** Who guessed first in round 1 of the current (or just finished) match. */
  matchFirstPlayerId: string | null;
  rematchVotes: string[];
  /** The lobby's 4-digit PIN, kept in step with the PIN directory by the room. */
  pin?: { value: string; expiresAt: number } | null;
  /** Recent in-app question send times per player, for rate limiting. */
  questionSends?: Record<string, number[]>;
  opponentLeft: boolean;
  recentCommands: { id: string; playerId: string }[];
  events: RoomEvent[];
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface EngineContext {
  now: number;
  /** Uniform random number in [0, 1). */
  random: () => number;
  newId: () => string;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: ErrorCode; message: string };

const fail = (error: ErrorCode, message: string): { ok: false; error: ErrorCode; message: string } => ({
  ok: false,
  error,
  message,
});

// ---------------------------------------------------------------------------
// Helpers

export function playerById(room: RoomState, playerId: string): PlayerRecord | undefined {
  return room.players.find((p) => p.id === playerId);
}

export function playerBySeat(room: RoomState, seat: Seat): PlayerRecord | undefined {
  return room.players.find((p) => p.seat === seat);
}

export function opponentOf(room: RoomState, playerId: string): PlayerRecord | undefined {
  return room.players.find((p) => p.id !== playerId);
}

export function isGuessing(status: RoomStatus): boolean {
  return status === "guessing_first" || status === "guessing_second";
}

function clone(room: RoomState): RoomState {
  return structuredClone(room);
}

function emit(room: RoomState, ctx: EngineContext, type: EventType, extra: Partial<RoomEvent> = {}): void {
  room.events.push({ type, at: ctx.now, version: room.version, ...extra });
  if (room.events.length > EVENTS_KEPT) room.events.splice(0, room.events.length - EVENTS_KEPT);
}

function touch(room: RoomState, ctx: EngineContext, activity = true): RoomState {
  room.version += 1;
  room.updatedAt = ctx.now;
  if (activity) room.lastActivityAt = ctx.now;
  syncTimer(room, ctx.now);
  return room;
}

/** Normalizes a display name for duplicate detection: case, accents, punctuation, leading "the". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

function nameKeys(identity: Identity): string[] {
  return [identity.canonicalName, ...identity.aliases].map(normalizeName).filter(Boolean);
}

/**
 * Two identities clash if either canonical name contains the other as whole words (after normalization),
 * or they share a normalized name or alias. Clashing identities are never drawn together
 * or repeated as "different" identities within a match.
 */
export function identitiesClash(a: Identity, b: Identity): boolean {
  if (a.id === b.id) return true;
  // Whole-word containment: "Mario" clashes with "Super Mario", "E.T." does not clash with "Tony the Tiger".
  const an = ` ${normalizeName(a.canonicalName)} `;
  const bn = ` ${normalizeName(b.canonicalName)} `;
  if (an.includes(bn) || bn.includes(an)) return true;
  const bKeys = new Set(nameKeys(b));
  return nameKeys(a).some((k) => bKeys.has(k));
}

// ---------------------------------------------------------------------------
// Timer

/**
 * The timer runs only while a timed turn is in the asking phase and both players are
 * connected. Otherwise the remaining time is frozen in `pausedRemainingMs`.
 */
function syncTimer(room: RoomState, now: number): void {
  const turn = room.turn;
  if (!turn || room.settings.timerSeconds === 0) return;
  const shouldRun =
    isGuessing(room.status) &&
    turn.phase === "asking" &&
    room.players.length === MAX_PLAYERS &&
    room.players.every((p) => p.connected);
  if (shouldRun && turn.deadline === null && turn.pausedRemainingMs !== null) {
    turn.deadline = now + turn.pausedRemainingMs;
    turn.pausedRemainingMs = null;
  } else if (!shouldRun && turn.deadline !== null) {
    turn.pausedRemainingMs = Math.max(0, turn.deadline - now);
    turn.deadline = null;
  }
}

// ---------------------------------------------------------------------------
// Identity draws

function pickUniform<T>(items: T[], random: () => number): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pickUniform on empty list");
  return item;
}

function pickOne(candidates: Identity[], settings: Settings, random: () => number): Identity {
  if (settings.packId !== "mixed") return pickUniform(candidates, random);
  const groups = new Map<SourcePackId, Identity[]>();
  for (const c of candidates) {
    const key = c.categoryId as SourcePackId;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const entries = [...groups.entries()];
  const total = entries.reduce((sum, [id]) => sum + MIXED_WEIGHTS[id], 0);
  let roll = random() * total;
  for (const [id, list] of entries) {
    roll -= MIXED_WEIGHTS[id];
    if (roll < 0) return pickUniform(list, random);
  }
  return pickUniform(entries[entries.length - 1]![1], random);
}

function drawFrom(pool: Identity[], used: Identity[], settings: Settings, random: () => number): [Identity, Identity] | null {
  const fresh = pool.filter((c) => !used.some((u) => identitiesClash(c, u)));
  if (fresh.length < 2) return null;
  const first = pickOne(fresh, settings, random);
  const rest = fresh.filter((c) => !identitiesClash(c, first));
  if (rest.length === 0) return null;
  return [first, pickOne(rest, settings, random)];
}

/** Draws two distinct identities not used earlier in the match, reshuffling when the pack runs out. */
export function drawPair(
  room: RoomState,
  random: () => number,
): { pair: [Identity, Identity]; reshuffled: boolean } {
  const pool = packIdentities(room.settings.packId);
  const used = room.usedIdentityIds.map(getIdentity);
  const pair = drawFrom(pool, used, room.settings, random);
  if (pair) return { pair, reshuffled: false };
  const reshuffledPair = drawFrom(pool, [], room.settings, random);
  if (!reshuffledPair) throw new Error(`Pack ${room.settings.packId} is too small to draw a pair`);
  return { pair: reshuffledPair, reshuffled: true };
}

// ---------------------------------------------------------------------------
// Room lifecycle

export function createRoom(
  input: { roomId: string; code: string; nickname: string; settings: Settings },
  ctx: EngineContext,
): { room: RoomState; playerId: string } {
  const playerId = ctx.newId();
  const room: RoomState = {
    schema: 1,
    roomId: input.roomId,
    code: input.code,
    hostPlayerId: playerId,
    settings: input.settings,
    status: "lobby",
    version: 1,
    players: [newPlayer(playerId, "A", input.nickname, ctx.now)],
    roundIndex: 0,
    turn: null,
    round: null,
    usedIdentityIds: [],
    lastRoundSummary: null,
    match: null,
    matchFirstPlayerId: null,
    rematchVotes: [],
    opponentLeft: false,
    recentCommands: [],
    events: [],
    createdAt: ctx.now,
    updatedAt: ctx.now,
    lastActivityAt: ctx.now,
  };
  emit(room, ctx, "room.created", { playerId });
  emit(room, ctx, "player.joined", { playerId });
  return { room, playerId };
}

function newPlayer(id: string, seat: Seat, nickname: string, now: number): PlayerRecord {
  return {
    id,
    seat,
    nickname,
    ready: false,
    connected: false,
    disconnectedAt: now,
    joinedAt: now,
    score: 0,
    correct: 0,
    skips: 0,
    hintsUsed: 0,
  };
}

/** Seats a new player. Enforces the two-player cap; joining is only possible in the lobby. */
export function joinRoom(
  current: RoomState,
  nickname: string,
  ctx: EngineContext,
): Result<{ room: RoomState; playerId: string }> {
  if (current.players.length >= MAX_PLAYERS) return fail("room_full", "This room already has two players.");
  if (current.status !== "lobby") return fail("room_full", "This match is already in progress.");
  const room = clone(current);
  const taken = new Set(room.players.map((p) => p.seat));
  const seat: Seat = taken.has("A") ? "B" : "A";
  const playerId = ctx.newId();
  room.players.push(newPlayer(playerId, seat, nickname, ctx.now));
  room.players.sort((a, b) => a.seat.localeCompare(b.seat));
  room.opponentLeft = false;
  touch(room, ctx);
  emit(room, ctx, "player.joined", { playerId });
  return { ok: true, room, playerId };
}

/** Records a connection change. Returns null when nothing changed. */
export function setPresence(current: RoomState, playerId: string, connected: boolean, ctx: EngineContext): RoomState | null {
  const existing = playerById(current, playerId);
  if (!existing || existing.connected === connected) return null;
  const room = clone(current);
  const player = playerById(room, playerId)!;
  player.connected = connected;
  player.disconnectedAt = connected ? null : ctx.now;
  return touch(room, ctx, false);
}

/** Ends the current turn as timed out if its deadline has passed. Returns null otherwise. */
export function expireTurn(current: RoomState, ctx: EngineContext): RoomState | null {
  const turn = current.turn;
  if (!turn || !isGuessing(current.status) || turn.phase !== "asking") return null;
  if (turn.deadline === null || ctx.now < turn.deadline) return null;
  const room = clone(current);
  room.round!.results[turn.playerId] = "timed_out";
  playerById(room, turn.playerId)!.skips += 1;
  room.turn = null;
  touch(room, ctx, false);
  emit(room, ctx, "turn.timed_out", { playerId: turn.playerId, roundIndex: room.roundIndex });
  advanceAfterTurn(room, ctx);
  return room;
}

/** The earliest time the room needs a timer callback (turn deadline), or null. */
/** A PIN only makes sense for an occupied lobby with a free seat. */
export function pinWanted(room: RoomState): boolean {
  return room.status === "lobby" && room.players.length > 0 && room.players.length < MAX_PLAYERS;
}

/** Records the room's PIN. Not player activity, so it never keeps an idle room alive. */
export function withPin(current: RoomState, pin: RoomState["pin"], ctx: EngineContext): RoomState {
  const room = clone(current);
  room.pin = pin;
  return touch(room, ctx, false);
}

export function nextDeadline(room: RoomState): number | null {
  return room.turn?.deadline ?? null;
}

// ---------------------------------------------------------------------------
// Commands

export function applyCommand(
  current: RoomState,
  playerId: string,
  command: Command,
  ctx: EngineContext,
): Result<{ room: RoomState; duplicate: boolean }> {
  if (!playerById(current, playerId)) return fail("forbidden", "You are not a player in this room.");

  // Idempotency: a repeated command id is answered with the canonical state, never re-applied.
  if (current.recentCommands.some((c) => c.id === command.commandId && c.playerId === playerId)) {
    return { ok: true, room: current, duplicate: true };
  }
  if (command.expectedVersion !== current.version) {
    return fail("version_conflict", "The game moved on. Showing the latest state.");
  }

  const room = clone(current);
  const outcome = handlers[command.type](room, playerId, command as never, ctx);
  if (outcome) return outcome;

  room.recentCommands.push({ id: command.commandId, playerId });
  if (room.recentCommands.length > RECENT_COMMANDS_KEPT) {
    room.recentCommands.splice(0, room.recentCommands.length - RECENT_COMMANDS_KEPT);
  }
  return { ok: true, room, duplicate: false };
}

type Failure = { ok: false; error: ErrorCode; message: string };
type Handler<T extends Command["type"]> = (
  room: RoomState,
  playerId: string,
  command: Extract<Command, { type: T }>,
  ctx: EngineContext,
) => Failure | undefined;

const invalid = (message: string): Failure => fail("invalid_transition", message);

function requireTurn(room: RoomState): TurnRecord | Failure {
  if (!isGuessing(room.status) || !room.turn || !room.round) return invalid("No turn is in progress.");
  return room.turn;
}

const handlers: { [K in Command["type"]]: Handler<K> } = {
  "player.ready": (room, playerId, cmd, ctx) => {
    if (room.status !== "lobby") return invalid("You can only change readiness in the lobby.");
    playerById(room, playerId)!.ready = cmd.ready;
    touch(room, ctx);
    emit(room, ctx, "player.ready", { playerId });
    return undefined;
  },

  "settings.update": (room, playerId, cmd, ctx) => {
    if (room.status !== "lobby") return invalid("Settings can only change between matches.");
    if (room.hostPlayerId !== playerId) return fail("forbidden", "Only the host can change settings.");
    room.settings = cmd.settings;
    // Both players must confirm the new settings by readying up again.
    for (const p of room.players) p.ready = false;
    touch(room, ctx);
    emit(room, ctx, "settings.updated", { playerId });
    return undefined;
  },

  "match.start": (room, playerId, _cmd, ctx) => {
    if (room.status !== "lobby") return invalid("The match has already started.");
    if (room.hostPlayerId !== playerId) return fail("forbidden", "Only the host can start the match.");
    if (room.players.length < MAX_PLAYERS) return invalid("Waiting for a second player.");
    if (!room.players.every((p) => p.ready)) return invalid("Both players must be ready.");
    touch(room, ctx);
    emit(room, ctx, "match.started", { playerId });
    startMatch(room, chooseFirstFromSettings(room, ctx), ctx);
    return undefined;
  },

  "turn.correct.request": (room, playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (turn.playerId !== playerId) return fail("forbidden", "It is not your turn.");
    if (turn.phase !== "asking") return invalid("Your guess is already waiting for confirmation.");
    turn.phase = "pending_confirm";
    touch(room, ctx);
    emit(room, ctx, "turn.correct.requested", { playerId, roundIndex: room.roundIndex });
    return undefined;
  },

  "turn.correct.confirm": (room, playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (turn.playerId === playerId) return fail("forbidden", "Your opponent confirms your guess.");
    if (turn.phase !== "pending_confirm") return invalid("There is no guess to confirm.");
    scoreCorrect(room, turn, ctx);
    return undefined;
  },

  "turn.correct.reject": (room, playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (turn.playerId === playerId) return fail("forbidden", "Your opponent judges your guess.");
    if (turn.phase !== "pending_confirm") return invalid("There is no guess to reject.");
    turn.phase = "asking";
    touch(room, ctx);
    emit(room, ctx, "turn.correct.rejected", { playerId: turn.playerId, roundIndex: room.roundIndex });
    return undefined;
  },

  "turn.correct.override": (room, playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (room.hostPlayerId !== playerId || turn.playerId !== playerId) {
      return fail("forbidden", "Only the host can override, on their own turn.");
    }
    if (turn.phase !== "pending_confirm") return invalid("Request confirmation first.");
    const opponent = opponentOf(room, playerId);
    if (opponent && (opponent.connected || ctx.now - (opponent.disconnectedAt ?? ctx.now) < HOST_OVERRIDE_AFTER_MS)) {
      return fail("forbidden", "Your opponent can still confirm.");
    }
    scoreCorrect(room, turn, ctx);
    return undefined;
  },

  "turn.skip": (room, playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (turn.playerId !== playerId) return fail("forbidden", "It is not your turn.");
    room.round!.results[playerId] = "skipped";
    playerById(room, playerId)!.skips += 1;
    room.turn = null;
    touch(room, ctx);
    emit(room, ctx, "turn.skipped", { playerId, roundIndex: room.roundIndex });
    advanceAfterTurn(room, ctx);
    return undefined;
  },

  "turn.question": (room, _playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (room.settings.mode !== "twenty_questions") return invalid("The question counter is for 20 Questions.");
    if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
    turn.questionCount = Math.min(turn.questionCount + 1, 99);
    touch(room, ctx);
    return undefined;
  },

  "turn.ask": (room, playerId, cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if ((room.settings.questions ?? "both") === "spoken") return invalid("This room asks questions out loud.");
    if (turn.playerId !== playerId) return fail("forbidden", "Only the guesser asks questions.");
    if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
    if (turn.log.some((e) => e.kind === "question" && e.answer === null)) {
      return invalid("Wait for the answer before asking another question.");
    }
    const sends = (room.questionSends ??= {});
    const recent = (sends[playerId] ?? []).filter((t) => ctx.now - t < QUESTION_RATE_LIMIT.windowMs);
    if (recent.length >= QUESTION_RATE_LIMIT.limit) return fail("rate_limited", "Slow down a little before the next question.");
    sends[playerId] = [...recent, ctx.now];
    turn.log.push({ id: ctx.newId(), kind: "question", text: cmd.text, answer: null, at: ctx.now });
    turn.questionCount = Math.min(turn.questionCount + 1, 99);
    touch(room, ctx);
    emit(room, ctx, "turn.question.asked", { playerId, roundIndex: room.roundIndex });
    return undefined;
  },

  "turn.answer": (room, playerId, cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (turn.playerId === playerId) return fail("forbidden", "Your opponent answers your questions.");
    const entry = turn.log.find((e) => e.id === cmd.questionId);
    if (!entry || entry.kind !== "question") return invalid("That question is not part of this turn.");
    if (entry.answer !== null) return invalid("That question was already answered.");
    entry.answer = cmd.answer;
    touch(room, ctx);
    emit(room, ctx, "turn.question.answered", { playerId, roundIndex: room.roundIndex });
    return undefined;
  },

  "turn.hint": (room, playerId, _cmd, ctx) => {
    const turn = requireTurn(room);
    if ("ok" in turn) return turn;
    if (room.settings.hints === false) return invalid("Hints are turned off in this room.");
    if (turn.playerId !== playerId) return fail("forbidden", "Only the guesser can ask for a hint.");
    if (turn.phase !== "asking") return invalid("A guess is waiting for confirmation.");
    if (turn.hintsUsed >= HINTS_PER_TURN) return invalid("No more hints this turn.");
    // The next hint for the guesser's own identity, revealed only now that they asked for it.
    const identity = getIdentity(room.round!.assignments[playerId]!);
    const index = turn.hintsUsed;
    turn.hintsUsed += 1;
    turn.log.push({ id: ctx.newId(), kind: "hint", index: index + 1, text: identity.hints[index]!, at: ctx.now });
    room.round!.hintsUsed[playerId] = (room.round!.hintsUsed[playerId] ?? 0) + 1;
    playerById(room, playerId)!.hintsUsed += 1;
    touch(room, ctx);
    emit(room, ctx, "turn.hint.revealed", { playerId, roundIndex: room.roundIndex });
    return undefined;
  },

  "round.next": (room, _playerId, _cmd, ctx) => {
    if (room.status !== "round_summary") return invalid("The round is not over yet.");
    if (room.lastRoundSummary?.matchOver) {
      room.status = "match_summary";
      touch(room, ctx);
      emit(room, ctx, "match.completed", { roundIndex: room.roundIndex });
      return undefined;
    }
    touch(room, ctx);
    startRound(room, ctx);
    return undefined;
  },

  "match.rematch": (room, playerId, _cmd, ctx) => {
    if (room.status !== "match_summary") return invalid("The match is not over.");
    if (room.rematchVotes.includes(playerId)) return invalid("You already asked for a rematch.");
    room.rematchVotes.push(playerId);
    touch(room, ctx);
    if (room.players.length === MAX_PLAYERS && room.players.every((p) => room.rematchVotes.includes(p.id))) {
      emit(room, ctx, "match.rematched", { playerId });
      // Keep the previous match's identities out of the draw so a rematch never reuses one just revealed.
      startMatch(room, rematchFirstPlayer(room), ctx, { keepUsedIdentities: true });
    }
    return undefined;
  },

  "match.change_settings": (room, playerId, _cmd, ctx) => {
    if (room.status !== "match_summary") return invalid("The match is not over.");
    resetToLobby(room);
    touch(room, ctx);
    emit(room, ctx, "settings.updated", { playerId });
    return undefined;
  },

  "player.leave": (room, playerId, _cmd, ctx) => {
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.hostPlayerId === playerId && room.players[0]) room.hostPlayerId = room.players[0].id;
    if (room.status !== "lobby") resetToLobby(room);
    for (const p of room.players) p.ready = false;
    room.opponentLeft = room.players.length > 0;
    touch(room, ctx);
    emit(room, ctx, "player.left", { playerId });
    return undefined;
  },

  "player.remove": (room, playerId, cmd, ctx) => {
    if (room.status !== "lobby") return invalid("Players can only be removed in the lobby.");
    if (room.hostPlayerId !== playerId) return fail("forbidden", "Only the host can remove a player.");
    if (cmd.playerId === playerId || !playerById(room, cmd.playerId)) return invalid("That player cannot be removed.");
    room.players = room.players.filter((p) => p.id !== cmd.playerId);
    for (const p of room.players) p.ready = false;
    touch(room, ctx);
    emit(room, ctx, "player.left", { playerId: cmd.playerId });
    return undefined;
  },
};

function resetToLobby(room: RoomState): void {
  room.status = "lobby";
  room.turn = null;
  room.round = null;
  room.roundIndex = 0;
  room.usedIdentityIds = [];
  room.lastRoundSummary = null;
  room.match = null;
  room.rematchVotes = [];
  for (const p of room.players) {
    p.ready = false;
    resetStats(p);
  }
}

function resetStats(p: PlayerRecord): void {
  p.score = 0;
  p.correct = 0;
  p.skips = 0;
  p.hintsUsed = 0;
}

function chooseFirstFromSettings(room: RoomState, ctx: EngineContext): string {
  const host = room.hostPlayerId;
  const other = opponentOf(room, host)!.id;
  switch (room.settings.firstPlayer ?? "random") {
    case "host":
      return host;
    case "opponent":
      return other;
    default:
      return ctx.random() < 0.5 ? host : other;
  }
}

/** The loser of the previous match goes first; after a tie, whoever went second in its round 1. */
export function rematchFirstPlayer(room: RoomState): string {
  const previous = room.match;
  const previousFirst = room.matchFirstPlayerId ?? room.hostPlayerId;
  if (previous && !previous.tie && previous.winnerId) return opponentOf(room, previous.winnerId)!.id;
  return opponentOf(room, previousFirst)!.id;
}

/** Resets scores and the shuffle, then starts round 1 with `firstPlayerId` guessing first. */
function startMatch(room: RoomState, firstPlayerId: string, ctx: EngineContext, opts: { keepUsedIdentities?: boolean } = {}): void {
  for (const p of room.players) resetStats(p);
  if (!opts.keepUsedIdentities) room.usedIdentityIds = [];
  room.roundIndex = 0;
  room.match = null;
  room.lastRoundSummary = null;
  room.opponentLeft = false;
  room.rematchVotes = [];
  room.matchFirstPlayerId = firstPlayerId;
  startRound(room, ctx);
}

/** First guesser of a round: the match starter in odd rounds, the other player in even rounds. */
export function firstGuesserOf(room: RoomState, roundIndex: number): string {
  const starter = room.matchFirstPlayerId ?? room.hostPlayerId;
  return roundIndex % 2 === 1 ? starter : opponentOf(room, starter)!.id;
}

function scoreCorrect(room: RoomState, turn: TurnRecord, ctx: EngineContext): void {
  const guesser = playerById(room, turn.playerId)!;
  guesser.score += 1;
  guesser.correct += 1;
  room.round!.results[guesser.id] = "correct";
  room.turn = null;
  touch(room, ctx);
  emit(room, ctx, "turn.correct.confirmed", { playerId: guesser.id, roundIndex: room.roundIndex });
  advanceAfterTurn(room, ctx);
}

function startRound(room: RoomState, ctx: EngineContext): void {
  room.status = "assigning";
  room.roundIndex += 1;
  const first = firstGuesserOf(room, room.roundIndex);
  const second = opponentOf(room, first)!.id;
  const { pair, reshuffled } = drawPair(room, ctx.random);
  if (reshuffled) room.usedIdentityIds = [];
  room.usedIdentityIds.push(pair[0].id, pair[1].id);
  room.round = {
    index: room.roundIndex,
    assignments: { [first]: pair[0].id, [second]: pair[1].id },
    results: {},
    hintsUsed: {},
    reshuffled,
    order: [first, second],
  };
  room.lastRoundSummary = null;
  emit(room, ctx, "round.started", { roundIndex: room.roundIndex, playerId: first });
  beginTurn(room, playerById(room, first)!, "guessing_first", ctx);
}

function beginTurn(room: RoomState, player: PlayerRecord, status: RoomStatus, ctx: EngineContext): void {
  room.status = status;
  room.turn = {
    id: `${room.roundIndex}-${player.seat}-${room.version}`,
    playerId: player.id,
    phase: "asking",
    deadline: null,
    pausedRemainingMs: room.settings.timerSeconds > 0 ? room.settings.timerSeconds * 1000 : null,
    questionCount: 0,
    hintsUsed: 0,
    log: [],
  };
  syncTimer(room, ctx.now);
}

function advanceAfterTurn(room: RoomState, ctx: EngineContext): void {
  if (room.status === "guessing_first") {
    beginTurn(room, playerById(room, room.round!.order[1])!, "guessing_second", ctx);
    return;
  }
  completeRound(room, ctx);
}

function completeRound(room: RoomState, ctx: EngineContext): void {
  const round = room.round!;
  const scores = room.players.map((p) => p.score);
  const matchOver =
    room.settings.matchType === "points"
      ? Math.max(...scores) >= POINTS_TO_WIN
      : room.roundIndex >= ROUNDS_PER_MATCH;
  room.lastRoundSummary = {
    roundIndex: round.index,
    entries: room.players.map((p) => ({
      playerId: p.id,
      identityId: round.assignments[p.id]!,
      result: round.results[p.id] ?? "skipped",
      hintsUsed: round.hintsUsed?.[p.id] ?? 0,
    })),
    matchOver,
  };
  if (matchOver) {
    const [first, second] = [...room.players].sort((x, y) => y.score - x.score);
    const tie = !!first && !!second && first.score === second.score;
    room.match = { winnerId: tie || !first ? null : first.id, tie, rounds: room.roundIndex };
  }
  room.status = "round_summary";
  room.turn = null;
  room.round = null;
  emit(room, ctx, "round.completed", { roundIndex: round.index });
}
