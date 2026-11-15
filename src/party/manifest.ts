// What a site that hosts Who Am I? reads about it: the party kit's manifest
// (party-kit/GAME-CONTRACT.md in n8watkins/n8-party-games), and the settings a party room's host
// may pick after the vote. Plain data: no identity content, nothing from the Workers runtime.
import { PACK_META, PACK_ORDER } from "../shared/packs";
import { DIFFICULTIES, type Difficulty, type Mode, type QuestionMode, type TurnFormat } from "../shared/protocol";

/**
 * How long a match runs in a party room. The game's own site offers first to 5 points or the best
 * after 10 rounds; a party room adds first to 3, its default, so one game does not hold the room
 * for the whole night.
 */
export const MATCH_LENGTHS = ["first_to_3", "first_to_5", "rounds_10"] as const;
export type MatchLength = (typeof MATCH_LENGTHS)[number];

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "twenty_questions", label: "Ask" },
  { value: "describe_it", label: "Clues" },
];
const TURN_FORMAT_OPTIONS: { value: TurnFormat; label: string }[] = [
  { value: "trade", label: "Trade turns" },
  { value: "keep_going", label: "Keep going" },
];
const QUESTION_OPTIONS: { value: QuestionMode; label: string }[] = [
  { value: "both", label: "Out loud or typed" },
  { value: "spoken", label: "Out loud" },
  { value: "app", label: "Typed" },
];
const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/**
 * The host's choices in a party room, in the shape the party kit's settings step reads
 * (`manifest.settings`): a key, a label, the options and the default. They are the game's own
 * settings, with two differences: the match length is one choice (with first to 3), and who
 * guesses first is not offered, because the party room's host need not be playing. The first
 * match starts with a random guesser and a rematch with the loser (`game.carry`).
 */
export const SETTING_FIELDS = [
  { key: "packId", label: "Category", options: PACK_ORDER.map((id) => ({ value: id, label: PACK_META[id].name })), default: "mixed" },
  { key: "mode", label: "Mode", options: MODE_OPTIONS, default: "twenty_questions" },
  { key: "turnFormat", label: "Turns", options: TURN_FORMAT_OPTIONS, default: "trade" },
  { key: "questions", label: "Questions", options: QUESTION_OPTIONS, default: "both" },
  {
    key: "timerSeconds",
    label: "Turn timer",
    options: [
      { value: 0, label: "No timer" },
      { value: 60, label: "60 seconds" },
      { value: 90, label: "90 seconds" },
    ],
    default: 0,
  },
  {
    key: "hints",
    label: "Hints",
    options: [
      { value: true, label: "On" },
      { value: false, label: "Off" },
    ],
    default: true,
  },
  { key: "difficulty", label: "Difficulty", options: DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })), default: "medium" },
  {
    key: "match",
    label: "Match",
    options: [
      { value: "first_to_3", label: "First to 3" },
      { value: "first_to_5", label: "First to 5" },
      { value: "rounds_10", label: "Best of 10 rounds" },
    ],
    default: "first_to_3",
  },
] as const;

export const manifest = {
  id: "who-am-i",
  name: "Who Am I?",
  blurb: "Guess the secret identity only your friend can see",
  /** The same on every site, so a link works on any host. */
  path: "/who-am-i/",
  players: { min: 2, max: 2, solo: false },
  /**
   * A party larger than two may vote for it: the room chooses its two players on spots, and
   * everyone else in the party watches as its audience, who see both identities (KR-12).
   */
  audience: true,
  // A phone each: your phone holds the other player's identity, so it is not a game for one
  // shared laptop (the room's badge says "A phone each"; a laptop's browser still plays). A big
  // screen may join: it only ever shows whose turn it is, the timer and the question count. Laid
  // out for a phone held upright: the room stops asking for sideways while it is played (KR-14).
  devices: { phone: true, desktop: false, sharedScreen: true, sideways: false, upright: true },
  /**
   * For a party room: the module, under `path`, whose mount() shows a match the room has already
   * started for its two seats. It shows the game's own page (index.html beside it) in a frame.
   */
  lobby: { view: "party-view/view.js" },
  /** The choices for a party room's settings step (the kit's `manifest.settings`). */
  settings: SETTING_FIELDS,
  /**
   * What a browser loads, relative to this package, copied under `path` by the host's build:
   * the built room view (`npm run build:party`), and nothing else. It holds no identity
   * content (scripts/check-bundle.mjs).
   */
  public: [{ from: "party-view", to: "party-view" }],
};
