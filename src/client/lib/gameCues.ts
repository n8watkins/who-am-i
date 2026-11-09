// Maps Who Am I? moments to the party kit's sound and haptic cues:
// - attention: your turn starts, a question waits for your answer, or a guess waits for your confirmation;
// - success: someone's guess is confirmed correct;
// - victory / defeat / draw: the match ends.
// Pure, so it is unit tested (test/game-cues.test.ts).
import type { Cue } from "../../kit/shared/cues";
import type { RoomView } from "../../shared/protocol";

/** What the viewer needs to act on right now, as a stable key; a new key means a new call to act. */
function attentionKey(view: RoomView): string | null {
  const turn = view.turn;
  if (!turn || (view.status !== "guessing_first" && view.status !== "guessing_second")) return null;
  const mine = turn.playerId === view.youId;
  if (!mine && turn.phase === "pending_confirm") return `confirm:${view.roundIndex}:${turn.playerId}:${view.status}:${turn.log.length}`;
  if (!mine) {
    const question = turn.log.find((e) => e.kind === "question" && e.answer === null);
    return question ? `answer:${question.id}` : null;
  }
  // Trade turns hand the move back and forth within a round; each new move is a new turn.
  return turn.phase === "asking" ? `turn:${view.roundIndex}:${turn.playerId}:${view.status}:${turn.moveAsked ? "asked" : "new"}` : null;
}

function correctKeys(view: RoomView): string[] {
  if (view.roundSummary && (view.status === "round_summary" || view.status === "match_summary")) {
    return view.roundSummary.entries.filter((e) => e.result === "correct").map((e) => `${view.roundSummary!.roundIndex}:${e.playerId}`);
  }
  return Object.entries(view.turnResults)
    .filter(([, result]) => result === "correct")
    .map(([playerId]) => `${view.roundIndex}:${playerId}`);
}

export function cuesFor(previous: RoomView, next: RoomView): Cue[] {
  if (next.status === "match_summary" && previous.status !== "match_summary" && next.matchSummary) {
    const { tie, winnerId } = next.matchSummary;
    return [tie ? "draw" : winnerId === next.youId ? "victory" : "defeat"];
  }
  const cues: Cue[] = [];
  const before = new Set(correctKeys(previous));
  if (correctKeys(next).some((k) => !before.has(k))) cues.push("success");
  const attention = attentionKey(next);
  // "Your move" only once a trade move starts, not again when its question is asked.
  const fresh = attention && attention !== attentionKey(previous) && !(attention.startsWith("turn:") && attention.endsWith(":asked"));
  if (fresh && !cues.includes("success")) cues.push("attention");
  return cues;
}
