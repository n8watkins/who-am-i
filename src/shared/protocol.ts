// Shared protocol between the Worker and the browser client.
// Nothing in this file (or anything the client imports) may contain identity content.
import { z } from "zod";

export const PACK_IDS = [
  "actors",
  "movie-characters",
  "historical-figures",
  "video-games",
  "brand-mascots",
  "anime-cartoons",
  "mixed",
] as const;
export type PackId = (typeof PACK_IDS)[number];

export const MODES = ["twenty_questions", "describe_it"] as const;
export type Mode = (typeof MODES)[number];

export const TIMER_OPTIONS = [0, 60, 90] as const;
export type TimerSeconds = (typeof TIMER_OPTIONS)[number];

export const MATCH_TYPES = ["points", "rounds"] as const;

/** Who guesses first in round 1 of a match started from the lobby. Rematches use the loser rule. */
/** Where yes/no questions happen: out loud, typed in the app, or both. */
export const QUESTION_MODES = ["spoken", "app", "both"] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

export const ANSWERS = ["yes", "no", "sort_of", "dont_know"] as const;
export type Answer = (typeof ANSWERS)[number];
export const ANSWER_LABELS: Record<Answer, string> = { yes: "Yes", no: "No", sort_of: "Sort of", dont_know: "Don't know" };

/** Longest in-app question, in characters. */
export const QUESTION_MAX_LENGTH = 140;
/** Per-player limit on sending in-app questions. */
export const QUESTION_RATE_LIMIT = { limit: 6, windowMs: 60_000 } as const;

/** Trade turns: one question, one guess, then the other player's move. Keep going: a turn lasts until you solve it or give up. */
export const TURN_FORMATS = ["trade", "keep_going"] as const;
export type TurnFormat = (typeof TURN_FORMATS)[number];

/** How hard the identities are. Tiers overlap on the server because hard identities are scarce. */
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const FIRST_PLAYER_OPTIONS = ["host", "opponent", "random"] as const;
export type FirstPlayerOption = (typeof FIRST_PLAYER_OPTIONS)[number];
export type MatchType = (typeof MATCH_TYPES)[number];

/** First to this many points wins (points mode). */
export const POINTS_TO_WIN = 5;
/** Highest score after this many rounds wins (rounds mode). */
export const ROUNDS_PER_MATCH = 10;
/** How long the confirming player must be disconnected before the host may override. */
export const HOST_OVERRIDE_AFTER_MS = 30_000;
/** Hints a guesser may reveal per turn (every identity has exactly this many). */
export const HINTS_PER_TURN = 3;

export const SettingsSchema = z.object({
  packId: z.enum(PACK_IDS),
  mode: z.enum(MODES),
  timerSeconds: z.union([z.literal(0), z.literal(60), z.literal(90)]),
  matchType: z.enum(MATCH_TYPES),
  firstPlayer: z.enum(FIRST_PLAYER_OPTIONS),
  hints: z.boolean(),
  questions: z.enum(QUESTION_MODES),
  turnFormat: z.enum(TURN_FORMATS).default("keep_going"),
  difficulty: z.enum(DIFFICULTIES).default("medium"),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  packId: "mixed",
  mode: "twenty_questions",
  timerSeconds: 0,
  matchType: "points",
  firstPlayer: "random",
  hints: true,
  questions: "both",
  turnFormat: "trade",
  difficulty: "medium",
};

// Remove control characters and collapse whitespace so names render predictably.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]", "g");
export const NicknameSchema = z
  .string()
  .transform((s) => s.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Enter a nickname").max(20, "Nicknames are at most 20 characters"));

/** In-app question text: plain text, control characters removed, whitespace collapsed, 1 to 140 characters. */
export const QuestionTextSchema = z
  .string()
  .max(QUESTION_MAX_LENGTH * 4)
  .transform((s) => s.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Type a question")
      .max(QUESTION_MAX_LENGTH, `Questions are at most ${QUESTION_MAX_LENGTH} characters`),
  );

export const CreateRoomRequestSchema = z.object({
  nickname: NicknameSchema,
  settings: SettingsSchema,
});
export type CreateRoomRequest = z.input<typeof CreateRoomRequestSchema>;

export const JoinRoomRequestSchema = z.object({ nickname: NicknameSchema });
export type JoinRoomRequest = z.input<typeof JoinRoomRequestSchema>;

/** Room codes use an unambiguous alphabet (no 0/O, 1/I/L). 31^6 is about 887 million codes. */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 6;
export const RoomCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`), "Invalid room code"));

/** A short-lived alias for a lobby, for typing on a phone while looking at a TV. */
export const PIN_LENGTH = 4;
export const PinSchema = z.string().regex(new RegExp(`^[0-9]{${PIN_LENGTH}}$`), "Invalid PIN");

const base = {
  /** Client-generated id; a repeated id is answered with the canonical state and never re-applied. */
  commandId: z.string().min(8).max(64),
  /** The state version the client was looking at. Stale versions are rejected. */
  expectedVersion: z.number().int().nonnegative(),
};

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("player.ready"), ready: z.boolean() }),
  z.object({ ...base, type: z.literal("settings.update"), settings: SettingsSchema }),
  z.object({ ...base, type: z.literal("match.start") }),
  z.object({ ...base, type: z.literal("turn.correct.request") }),
  z.object({ ...base, type: z.literal("turn.correct.confirm") }),
  z.object({ ...base, type: z.literal("turn.correct.reject") }),
  z.object({ ...base, type: z.literal("turn.correct.override") }),
  z.object({ ...base, type: z.literal("turn.skip") }),
  z.object({ ...base, type: z.literal("turn.question") }),
  z.object({ ...base, type: z.literal("turn.hint") }),
  z.object({ ...base, type: z.literal("turn.ask"), text: QuestionTextSchema }),
  z.object({ ...base, type: z.literal("turn.answer"), questionId: z.string().min(1).max(64), answer: z.enum(ANSWERS) }),
  z.object({ ...base, type: z.literal("round.next") }),
  z.object({ ...base, type: z.literal("match.rematch") }),
  z.object({ ...base, type: z.literal("match.change_settings") }),
  z.object({ ...base, type: z.literal("player.leave") }),
  z.object({ ...base, type: z.literal("player.remove"), playerId: z.string().min(1).max(64) }),
  z.object({ ...base, type: z.literal("player.difficulty"), difficulty: z.enum(DIFFICULTIES).nullable() }),
  z.object({ ...base, type: z.literal("turn.pass") }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command["type"];

export type Seat = "A" | "B";
export type RoomStatus =
  | "lobby"
  | "assigning"
  | "guessing_first"
  | "guessing_second"
  | "round_summary"
  | "match_summary";
export type TurnResult = "correct" | "skipped" | "timed_out" | "beaten";
export type TurnPhase = "asking" | "pending_confirm";

/** What a client may see of an identity. Sent only for identities the viewer is allowed to see. */
export interface PublicIdentity {
  id: string;
  canonicalName: string;
  categoryId: string;
}

export interface PlayerView {
  playerId: string;
  seat: Seat;
  nickname: string;
  ready: boolean;
  connected: boolean;
  /** Server timestamp (ms) when the player's last connection closed, if disconnected. */
  disconnectedAt: number | null;
  isHost: boolean;
  score: number;
  correct: number;
  skips: number;
  /** Hints revealed for this player in the current match. */
  hintsUsed: number;
  /** This player's own difficulty, or null to follow the room's. */
  difficulty: Difficulty | null;
}

/** One entry in a turn's log, shown to both players. */
export type TurnLogEntry =
  | { id: string; kind: "hint"; index: number; text: string; at: number }
  | { id: string; kind: "question"; text: string; answer: Answer | null; at: number };

export interface TurnView {
  playerId: string;
  phase: TurnPhase;
  /** Server timestamp (ms) when the turn times out, or null if untimed or paused. */
  deadline: number | null;
  /** Remaining ms while paused, or null. */
  pausedRemainingMs: number | null;
  questionCount: number;
  hintsUsed: number;
  log: TurnLogEntry[];
  /** Trade turns: this move's one question has been asked. */
  moveAsked: boolean;
}

export interface RoundSummaryEntry {
  playerId: string;
  identity: PublicIdentity;
  result: TurnResult;
  hintsUsed: number;
}

export interface RoundSummaryView {
  roundIndex: number;
  entries: RoundSummaryEntry[];
  matchOver: boolean;
}

export interface MatchSummaryView {
  winnerId: string | null;
  tie: boolean;
  rounds: number;
}

export interface PackInfo {
  id: PackId;
  name: string;
  description: string;
  size: number;
}

export type Notice = "pack_reshuffled" | "opponent_left" | "turn_timed_out";

/**
 * The per-player filtered view of a room. It contains the public state plus only the
 * identity the viewer's opponent is guessing. The viewer's own identity is present only
 * inside `roundSummary` after the round has been completed.
 */
export interface RoomView {
  code: string;
  /** The 4-digit PIN, while the lobby has a free seat and the directory has room for one. */
  pin: string | null;
  version: number;
  serverNow: number;
  status: RoomStatus;
  settings: Settings;
  pack: PackInfo;
  youId: string;
  hostPlayerId: string;
  players: PlayerView[];
  roundIndex: number;
  /** Who guesses first in the current round (alternates every round). */
  firstPlayerId: string | null;
  turn: TurnView | null;
  /** Result of each player's turn in the current round, by player id. */
  turnResults: Record<string, TurnResult>;
  /** The identity the viewer's opponent is trying to guess (visible to the viewer). */
  opponentIdentity: PublicIdentity | null;
  roundSummary: RoundSummaryView | null;
  matchSummary: MatchSummaryView | null;
  /** Players who tapped Rematch on the match summary. When both have, the next match starts. */
  rematchVotes: string[];
  /** On the match summary: who will guess first if both tap Rematch (the loser, or after a tie the previous second guesser). */
  rematchFirstPlayerId: string | null;
  notices: Notice[];
}

export interface RoomPreview {
  code: string;
  status: RoomStatus;
  settings: Settings;
  pack: PackInfo;
  hostNickname: string | null;
  playerCount: number;
  full: boolean;
}

/** What a PIN or code lookup returns: the room preview and nothing else. */
export interface JoinLookupResponse {
  ok: true;
  preview: RoomPreview;
}

/** The public profile of a signed-in player. */
export interface AccountUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MeResponse {
  ok: true;
  /** False until GitHub sign-in is configured, so the app can hide it. */
  signInAvailable: boolean;
  user: AccountUser | null;
}

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "not_found"
  | "room_full"
  | "rate_limited"
  | "version_conflict"
  | "invalid_transition"
  | "forbidden"
  | "removed"
  | "internal";

export interface ApiError {
  ok: false;
  error: ErrorCode;
  message: string;
  view?: RoomView;
}

export interface SessionResponse {
  ok: true;
  token: string;
  playerId: string;
  view: RoomView;
}

export interface CommandResponse {
  ok: true;
  duplicate: boolean;
  view: RoomView;
}

export interface ViewResponse {
  ok: true;
  view: RoomView;
}

export type ServerMessage = { type: "state"; view: RoomView } | { type: "closed"; reason: string };

/** WebSocket subprotocol used to carry the session token (browsers cannot set headers). */
export const WS_PROTOCOL = "whoami.v1";
export const WS_TOKEN_PREFIX = "token.";
