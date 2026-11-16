// Who is ahead, and who won a decided match, from the scores every viewer already has. Plain
// functions, so the room view's pages and their tests read them the same way.

export interface ScoreRow<K> {
  key: K;
  score: number;
}

/** The leader, or null on a tie, and the score as "3 to 1" (the leader's first). */
export function outcomeOf<K>(rows: readonly ScoreRow<K>[]): { winner: K | null; line: string } {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const [first, second] = sorted;
  if (!first) return { winner: null, line: "" };
  const tie = !!second && second.score === first.score;
  return { winner: tie ? null : first.key, line: second ? `${first.score} to ${second.score}` : String(first.score) };
}
