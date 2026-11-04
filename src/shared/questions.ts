// Suggested yes/no questions, ordered from most to least useful for narrowing down an identity.
// The UI always offers the first few and shuffles a few more from the rest each time.
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "Am I a real person?",
  "Am I alive today?",
  "Am I a man?",
  "Am I a woman?",
  "Am I fictional?",
  "Am I animated?",
  "Am I known for movies?",
  "Am I from a video game?",
  "Am I American?",
  "Am I human?",
  "Am I an animal?",
  "Am I a mascot for a product?",
  "Am I from before 1900?",
  "Am I from the 20th century?",
  "Am I a hero?",
  "Am I a villain?",
  "Am I known for comedy?",
  "Am I from a book?",
  "Am I British?",
  "Am I from Japan?",
  "Am I a scientist or inventor?",
  "Am I a political leader?",
  "Am I an artist or musician?",
  "Do I have superpowers or magic?",
  "Am I from a space or sci-fi story?",
  "Am I aimed at kids?",
  "Do I wear a costume or uniform?",
  "Am I connected to food or drink?",
  "Am I royalty?",
  "Do I have a famous catchphrase?",
];

/** How many of the most useful questions are always shown. */
export const TOP_SUGGESTIONS = 5;
/** How many extra questions are shuffled in from the rest. */
export const SHUFFLED_SUGGESTIONS = 3;

/** The top questions plus a few random others, given a random source. */
export function pickSuggestions(random: () => number = Math.random): string[] {
  const rest = SUGGESTED_QUESTIONS.slice(TOP_SUGGESTIONS);
  const picked: string[] = [];
  const pool = [...rest];
  while (picked.length < SHUFFLED_SUGGESTIONS && pool.length > 0) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return [...SUGGESTED_QUESTIONS.slice(0, TOP_SUGGESTIONS), ...picked];
}
