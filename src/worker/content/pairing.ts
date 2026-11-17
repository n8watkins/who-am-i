// Which two identities may be dealt in the same round. Server-only, like the packs.
//
// During a round each phone shows the opponent's identity: its name, its id, its picture (address,
// file page and credit) and, once the opponent asks for them, its hints. If any of that carries the
// viewer's own name, the viewer can read who they are: "Link from The Legend of Zelda" says "Zelda"
// to the player who is Princess Zelda. So a pair is dealt only when neither side's shown text gives
// the other away (`pairable`), checked two ways:
// - by words: the shown text never contains a word of the other's name or aliases, other than
//   COMMON_WORDS ("King Kong" never faces "Donkey Kong", "Minnie Mouse" never faces "Mickey Mouse");
// - by meaning: REVEALING_PAIRS lists pairs where one plainly points at the other without sharing a
//   word (an actor and a role they played, a hint that describes the other character).
// A pair is also never dealt when the two names clash (`identitiesClash`).
import { ALL_PACK_IDENTITIES } from "./index";
import type { Identity } from "./types";

/** Normalizes a display name for matching: case, accents, punctuation, leading "the". */
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

/** Each identity's normalized name (padded with spaces) and its name and aliases, worked out once. */
const NAMES = new WeakMap<Identity, { padded: string; keys: Set<string> }>();

function names(identity: Identity): { padded: string; keys: Set<string> } {
  let entry = NAMES.get(identity);
  if (!entry) {
    entry = {
      padded: ` ${normalizeName(identity.canonicalName)} `,
      keys: new Set([identity.canonicalName, ...identity.aliases].map(normalizeName).filter(Boolean)),
    };
    NAMES.set(identity, entry);
  }
  return entry;
}

/**
 * Two identities clash if either canonical name contains the other as whole words (after normalization),
 * or they share a normalized name or alias. Clashing identities are never drawn together
 * or repeated as "different" identities within a match.
 */
export function identitiesClash(a: Identity, b: Identity): boolean {
  if (a.id === b.id) return true;
  // Whole-word containment: "Mario" clashes with "Super Mario", "E.T." does not clash with "Tony the Tiger".
  const an = names(a);
  const bn = names(b);
  if (an.padded.includes(bn.padded) || bn.padded.includes(an.padded)) return true;
  for (const k of an.keys) if (bn.keys.has(k)) return true;
  return false;
}

/** Words of a name that say nothing on their own. Single letters ("Wile E. Coyote") count too. */
export const COMMON_WORDS: ReadonlySet<string> = new Set(["the", "of", "a", "an", "and", "from", "in", "on", "to"]);

/**
 * Pairs where one identity's shown text points at the other without sharing a word of its name.
 * [one id, other id, why]; the order does not matter.
 */
export const REVEALING_PAIRS: readonly (readonly [string, string, string])[] = [
  // An actor and a character they played or voiced: either card brings the other to mind.
  ["actors.daniel-radcliffe", "movie-characters.harry-potter", "played him; a hint describes the boy wizard"],
  ["actors.emma-watson", "movie-characters.hermione-granger", "played her"],
  ["actors.jennifer-lawrence", "movie-characters.katniss-everdeen", "played her; a hint names The Hunger Games"],
  ["actors.robert-downey-jr", "movie-characters.iron-man", "played him; a hint describes the armored suit"],
  ["actors.harrison-ford", "movie-characters.indiana-jones", "played him; a hint describes the archaeologist"],
  ["actors.tom-holland", "movie-characters.spider-man", "played him; a hint describes the web-slinger"],
  ["actors.tom-holland", "video-games.nathan-drake", "played him in Uncharted"],
  ["actors.keanu-reeves", "movie-characters.neo", "played him; a hint names The Matrix"],
  ["actors.tom-hanks", "movie-characters.forrest-gump", "played him"],
  ["actors.tom-hanks", "movie-characters.woody", "voices him"],
  ["actors.timothee-chalamet", "movie-characters.willy-wonka", "played him in Wonka"],
  ["actors.angelina-jolie", "video-games.lara-croft", "played her in Tomb Raider"],
  ["actors.robin-williams", "anime-cartoons.popeye", "played him"],
  ["actors.jim-carrey", "video-games.dr-eggman", "played him in the Sonic films"],
  ["actors.idris-elba", "video-games.knuckles", "voiced him in the Sonic films"],
  ["actors.idris-elba", "historical-figures.nelson-mandela", "played him"],
  ["actors.george-clooney", "movie-characters.batman", "played him"],
  ["actors.ryan-reynolds", "video-games.pikachu", "voiced him in Detective Pikachu"],
  ["actors.cate-blanchett", "historical-figures.elizabeth-i", "played her"],
  ["actors.judi-dench", "historical-figures.elizabeth-i", "played her"],
  ["actors.judi-dench", "historical-figures.queen-victoria", "played her"],
  ["actors.judi-dench", "movie-characters.james-bond", "a hint names his chief, M"],
  // A character whose card describes the other.
  ["movie-characters.the-joker", "movie-characters.batman", "a hint names Gotham's caped crusader"],
  ["movie-characters.darth-vader", "movie-characters.luke-skywalker", "a hint names his son"],
  ["video-games.luigi", "video-games.mario", "a hint names the other plumber brother"],
  ["video-games.yoshi", "video-games.mario", "a hint names the famous plumber he carries"],
  ["video-games.bowser", "video-games.princess-peach", "a hint names the princess he kidnaps"],
  ["video-games.ganondorf", "video-games.link", "a hint names Hyrule's legends"],
  ["video-games.ganondorf", "video-games.princess-zelda", "a hint names Hyrule's legends"],
  ["video-games.dr-eggman", "video-games.sonic", "a hint names Sega's blue hedgehog"],
  ["anime-cartoons.patrick-star", "anime-cartoons.spongebob", "a hint names his sea sponge best friend"],
  ["anime-cartoons.ash-ketchum", "video-games.pikachu", "his partner; a hint names Pokémon"],
  ["anime-cartoons.wile-e-coyote", "anime-cartoons.road-runner", "each one's hint describes the other"],
];

/** The words of an identity's name and aliases that give it away. */
export function tellingWords(identity: Identity): string[] {
  const words = [...names(identity).keys].flatMap((k) => k.split(" "));
  return [...new Set(words)].filter((w) => w.length > 1 && !COMMON_WORDS.has(w));
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Everything of an identity that reaches the other phone during a round, normalized and padded
 * with spaces: the name, the id's slug, the picture's address, file page and credit (whether or
 * not pictures are switched on) and the hints.
 */
export function shownText(identity: Identity): string {
  const picture = identity.picture;
  const parts = [identity.canonicalName, identity.id.slice(identity.id.indexOf(".") + 1), ...identity.hints];
  if (picture) parts.push(decode(picture.imageUrl), decode(picture.filePage), picture.author ?? "", picture.license);
  return ` ${normalizeName(parts.join(" | "))} `;
}

/** The words of `hidden`'s name that `shown`'s card carries, as whole words. */
export function wordsGivenAway(shown: Identity, hidden: Identity): string[] {
  const text = shownText(shown);
  return tellingWords(hidden).filter((w) => text.includes(` ${w} `));
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const REVEALING = new Set(REVEALING_PAIRS.map(([a, b]) => pairKey(a, b)));

/** Whether either identity's shown text gives the other away. */
export function givesAway(a: Identity, b: Identity): boolean {
  return REVEALING.has(pairKey(a.id, b.id)) || wordsGivenAway(a, b).length > 0 || wordsGivenAway(b, a).length > 0;
}

function computePairable(a: Identity, b: Identity): boolean {
  return !identitiesClash(a, b) && !givesAway(a, b);
}

/** For each identity of the deck, the ids it may never be dealt beside (itself included). Built once. */
let blockedById: Map<string, Set<string>> | null = null;
let deck: Map<string, Identity> | null = null;

function getDeckIdentity(id: string): Identity | undefined {
  deck ??= new Map(ALL_PACK_IDENTITIES.map((i) => [i.id, i]));
  return deck.get(id);
}

function blockedFor(identity: Identity): Set<string> | undefined {
  if (!blockedById) {
    blockedById = new Map(ALL_PACK_IDENTITIES.map((i) => [i.id, new Set([i.id])]));
    for (let x = 0; x < ALL_PACK_IDENTITIES.length; x++) {
      for (let y = x + 1; y < ALL_PACK_IDENTITIES.length; y++) {
        const a = ALL_PACK_IDENTITIES[x]!;
        const b = ALL_PACK_IDENTITIES[y]!;
        if (!computePairable(a, b)) {
          blockedById.get(a.id)!.add(b.id);
          blockedById.get(b.id)!.add(a.id);
        }
      }
    }
  }
  // Only the deck's own objects: anything else (a test's stand-in) is worked out afresh.
  return getDeckIdentity(identity.id) === identity ? blockedById.get(identity.id) : undefined;
}

/** Whether two identities may be dealt in the same round: no clash, and neither gives the other away. */
export function pairable(a: Identity, b: Identity): boolean {
  const blocked = blockedFor(a);
  return blocked && getDeckIdentity(b.id) === b ? !blocked.has(b.id) : computePairable(a, b);
}

/** Whether `identity` may be dealt beside at least one of `others`. */
export function hasPartner(identity: Identity, others: readonly Identity[]): boolean {
  const blocked = blockedFor(identity);
  // Fewer blocked names than others: some other is surely free.
  if (blocked && others.length > blocked.size) return true;
  return others.some((o) => pairable(identity, o));
}
