// The shapes of what a party room's viewers are sent of a Who Am I? match. Types only, safe for
// the browser: the room view (src/party-view) imports them, and nothing here reaches the content.
import type { PublicIdentity, RoomStatus, RoomView, TurnPhase, TurnResult } from "../shared/protocol";
import type { MatchLength } from "./manifest";

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

/** What a player sees: their own view of the match, as on the game's own site, and the match length. */
export type PlayerSnapshot = RoomView & { role: "player"; seat: number; match: MatchLength };

/**
 * A round's reveal, once it is over: each seat's identity and how it went. Both players have seen
 * both identities on their own round summary by then, so nothing in it is secret any more.
 */
export interface RoundReveal {
  roundIndex: number;
  matchOver: boolean;
  entries: { seat: number; identity: PublicIdentity; result: TurnResult }[];
}

/**
 * What the screen and a watching member see: whose turn, the timer, the question count and the
 * scores; between rounds (and after the last), the round's reveal. Never an identity while its
 * round is on, a hint or a question.
 */
export type RoomScreenView = ScreenView & {
  match: MatchLength;
  scores: { seat: number; score: number }[];
  /** Between rounds (and after the last) only; null while a round is on. */
  reveal: RoundReveal | null;
};

/**
 * What a watching phone in the audience sees (the room's `{role: "audience", seat}`, for a member
 * of a larger party who is not playing): the screen's view, and both identities while a round is
 * on. Never sent to a player or a screen.
 */
export type AudienceView = Omit<RoomScreenView, "role"> & {
  role: "audience";
  /** Both identities while a round is on; empty between rounds. */
  identities: { seat: number; identity: PublicIdentity }[];
};

export type RoomSnapshot = PlayerSnapshot | RoomScreenView | AudienceView;
