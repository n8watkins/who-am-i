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

/** What the screen and a watching member see: whose turn, the timer and the question count. */
export type RoomScreenView = ScreenView & { match: MatchLength };

/**
 * What a watching phone in the audience may see, once the room can say so (`{role: "audience"}`):
 * the screen's view and both identities while a round is on. Never sent to a player or a screen.
 */
export type AudienceView = Omit<ScreenView, "role"> & {
  role: "audience";
  match: MatchLength;
  scores: { seat: number; score: number }[];
  /** Both identities while a round is on; empty between rounds. */
  identities: { seat: number; identity: PublicIdentity }[];
  /** Between rounds (and after the last): the round's reveal, each seat's identity and how it went. */
  reveal: { roundIndex: number; matchOver: boolean; entries: { seat: number; identity: PublicIdentity; result: TurnResult }[] } | null;
};

export type RoomSnapshot = PlayerSnapshot | RoomScreenView | AudienceView;
