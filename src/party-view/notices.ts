// What the room view tells a person in a line above the game: things that happened that the
// game's own screens do not say. Plain functions over what the page already has (its snapshots
// and the room's events), so they are tested without a browser. None reads or names an identity.
import type { RoomView } from "../shared/protocol";
import type { Snapshot } from "./host";

export interface Notice {
  text: string;
  /** Stays until dismissed, or until the round it is about is over; otherwise it fades after a while. */
  sticky: boolean;
  /** The round it is about: it is put away once another round is on. */
  roundIndex: number;
}

const nameOf = (snap: Snapshot, seat: number): string => {
  if (snap.role === "player") return snap.players.find((p) => p.playerId === `seat-${seat}`)?.nickname ?? "The other player";
  return snap.players.find((p) => p.seat === seat)?.name ?? "A player";
};

/**
 * The room's events say a turn timed out (`{k: "timed_out", seat}`, from the turn timer): the
 * guesser is told their time ran out, and everyone else whose it did.
 */
export function timedOutNotice(events: readonly unknown[], you: { role: string; seat: number }, snap: Snapshot): Notice | null {
  const event = events.find((e): e is { k: "timed_out"; seat: number } => !!e && typeof e === "object" && (e as { k?: unknown }).k === "timed_out" && typeof (e as { seat?: unknown }).seat === "number");
  if (!event) return null;
  const roundIndex = snap.roundIndex;
  if (snap.role === "player" && you.seat === event.seat) {
    const other = snap.players.find((p) => p.playerId !== snap.youId)?.nickname ?? "the other player";
    const text = snap.settings.turnFormat === "trade" ? `Your time ran out, so it is ${other}'s move.` : "Your time ran out on this one.";
    return { text, sticky: false, roundIndex };
  }
  return { text: `${nameOf(snap, event.seat)}'s time ran out.`, sticky: false, roundIndex };
}

/**
 * The other player confirmed their own guess while this player's page was hidden (the guesser
 * may, once the other phone has been gone 30 seconds): their guess was waiting for this player,
 * and now it counts as right without this player having said so. `confirmedHere` is whether
 * this page sent the confirmation itself.
 */
export function confirmedWithoutYouNotice(prev: RoomView, next: RoomView, confirmedHere: boolean): Notice | null {
  const turn = prev.turn;
  if (confirmedHere || !turn || turn.playerId === prev.youId || turn.phase !== "pending_confirm") return null;
  if (prev.turnResults[turn.playerId] === "correct") return null;
  const sameRound = next.roundIndex === prev.roundIndex;
  const correct =
    (sameRound && next.turnResults[turn.playerId] === "correct") ||
    (next.roundSummary?.roundIndex === prev.roundIndex && next.roundSummary.entries.some((e) => e.playerId === turn.playerId && e.result === "correct"));
  if (!correct) return null;
  const name = prev.players.find((p) => p.playerId === turn.playerId)?.nickname ?? "The other player";
  return { text: `While you were away, ${name} confirmed their own guess.`, sticky: true, roundIndex: prev.roundIndex };
}
