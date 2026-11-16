// Secrecy across a pair: what a phone shows about the opponent's identity (name, id, picture,
// hints) must never let that player read their own name. The scan below is written apart from the
// rule it checks (src/worker/content/pairing.ts): it reads the opponent's identity as a view sends
// it, splits it into words, and looks for any word of the viewer's own name.
import { describe, expect, it } from "vitest";
import { PACK_IDS, type PackId } from "../src/shared/protocol";
import { ALL_PACK_IDENTITIES, getIdentity, MIXED_WEIGHTS, packIdentities, type Identity, type SourcePackId } from "../src/worker/content";
import { REVEALING_PAIRS } from "../src/worker/content/pairing";
import { DIFFICULTY_POOLS, drawPair, identitiesClash, pairable, type RoomState } from "../src/worker/engine";
import { cmd, mustApply, setupRoom, testContext } from "./helpers";

const LEVELS = ["easy", "medium", "hard"] as const;
const FILLER = new Set(["the", "of", "a", "an", "and", "from", "in", "on", "to"]);

function words(text: string): string[] {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // Not URI-encoded: read as it is.
  }
  return decoded
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every word the opponent's phone can read about `identity` during a round. */
function readable(identity: Identity): Set<string> {
  const shown = { id: identity.id, canonicalName: identity.canonicalName, picture: identity.picture ?? null, hints: identity.hints };
  const texts = [identity.id, identity.canonicalName, ...identity.hints];
  if (identity.picture) texts.push(identity.picture.imageUrl, identity.picture.filePage, identity.picture.author ?? "", identity.picture.license);
  return new Set([...words(JSON.stringify(shown)), ...texts.flatMap(words)]);
}

/** The words of an identity's name and aliases that would tell its player who they are. */
function own(identity: Identity): string[] {
  return [...new Set([identity.canonicalName, ...identity.aliases].flatMap(words))].filter((w) => w.length > 1 && !FILLER.has(w));
}

/** The words of `viewer`'s own name that `viewer`'s phone shows while `opponent` is the card. */
function leak(viewer: Identity, opponent: Identity): string[] {
  const seen = readable(opponent);
  return own(viewer).filter((w) => seen.has(w));
}

const byId = (id: string) => getIdentity(id);

describe("the deck scan", () => {
  it("never lets a pair be dealt when either phone could read its own name in the other's card", () => {
    const dealtAnyway: string[] = [];
    for (const a of ALL_PACK_IDENTITIES) {
      for (const b of ALL_PACK_IDENTITIES) {
        if (a === b) continue;
        const words = leak(a, b);
        if (words.length && pairable(a, b)) dealtAnyway.push(`${a.canonicalName} reads "${words.join(", ")}" on ${b.canonicalName}'s card`);
      }
    }
    expect(dealtAnyway).toEqual([]);
  });

  it("never deals the pairs found giving each other away", () => {
    const known = [
      ["video-games.link", "video-games.princess-zelda"],
      ["actors.jennifer-lawrence", "movie-characters.katniss-everdeen"],
      ["movie-characters.batman", "movie-characters.the-joker"],
      ["video-games.donkey-kong", "movie-characters.king-kong"],
      ["brand-mascots.burger-king", "movie-characters.king-kong"],
      ["historical-figures.napoleon-bonaparte", "historical-figures.nikola-tesla"],
      ["movie-characters.dorothy-gale", "brand-mascots.gerber-baby"],
      ["video-games.creeper", "video-games.minecraft-steve"],
      ["anime-cartoons.mickey-mouse", "anime-cartoons.minnie-mouse"],
    ];
    for (const [x, y] of known) {
      expect(pairable(byId(x!), byId(y!)), `${x} / ${y}`).toBe(false);
      expect(pairable(byId(y!), byId(x!)), `${y} / ${x}`).toBe(false);
    }
  });

  it("never deals a pair listed as pointing at each other, and lists only real identities", () => {
    for (const [x, y, why] of REVEALING_PAIRS) {
      expect(why.trim(), `${x} / ${y}`).not.toBe("");
      expect(pairable(byId(x), byId(y)), `${x} / ${y}`).toBe(false);
      expect(pairable(byId(y), byId(x)), `${y} / ${x}`).toBe(false);
    }
  });

  it("still deals ordinary pairs, including two names from one franchise", () => {
    expect(pairable(byId("video-games.mario"), byId("video-games.princess-zelda"))).toBe(true);
    expect(pairable(byId("movie-characters.luke-skywalker"), byId("movie-characters.yoda"))).toBe(true);
    expect(pairable(byId("actors.tom-hanks"), byId("historical-figures.albert-einstein"))).toBe(true);
    // Tails gave Sonic away only through his picture's file name, a Sonic game; with that picture
    // pulled, nothing on either card names the other.
    expect(pairable(byId("video-games.sonic"), byId("video-games.tails"))).toBe(true);
  });

  it("gives no picture an address or file page that names another identity", () => {
    const problems: string[] = [];
    for (const identity of ALL_PACK_IDENTITIES) {
      if (!identity.picture) continue;
      const inAddress = new Set([...words(identity.picture.imageUrl), ...words(identity.picture.filePage)]);
      // "King_Kong_1933.png" is King Kong's own name, not The Burger King's.
      const itsOwn = new Set(own(identity));
      for (const other of ALL_PACK_IDENTITIES) {
        if (other === identity) continue;
        for (const name of [other.canonicalName, ...other.aliases]) {
          const nameWords = words(name).filter((w) => !FILLER.has(w) && !itsOwn.has(w));
          if (nameWords.length && nameWords.every((w) => inAddress.has(w))) problems.push(`${identity.id}'s picture names "${name}" (${other.id})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("fair dealing", () => {
  it("leaves every name dealable beside many others, in every pack, at every pair of levels", () => {
    const thin: string[] = [];
    let fewest = Infinity;
    for (const packId of PACK_IDS) {
      for (const first of LEVELS) {
        for (const second of LEVELS) {
          const pool = (level: (typeof LEVELS)[number]) => packIdentities(packId).filter((i) => DIFFICULTY_POOLS[level].includes(i.difficulty));
          const others = pool(second);
          for (const identity of pool(first)) {
            const partners = others.filter((o) => pairable(identity, o)).length;
            // The rule takes some partners from a name, never most of them. Names made of common
            // words lose the most: Mr. Monopoly keeps 9 of the 14 easy Brand Mascots, since "Mr.",
            // "Man" and "Uncle" are on other mascots' cards.
            const before = others.filter((o) => !identitiesClash(identity, o)).length;
            fewest = Math.min(fewest, partners);
            if (partners < 5 || partners < 0.6 * before) thin.push(`${packId} ${first}/${second}: ${identity.id} has ${partners} of ${before}`);
          }
        }
      }
    }
    expect(thin).toEqual([]);
    expect(fewest).toBeGreaterThanOrEqual(5);
  });

  it("keeps the Mixed weights: each source pack's share of dealt names matches its weight", () => {
    const { room } = setupRoom({ start: false });
    const ctx = testContext(2024);
    const draws = 20_000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < draws; i++) {
      const { pair } = drawPair(room, ctx.random);
      for (const identity of pair) counts[identity.categoryId] = (counts[identity.categoryId] ?? 0) + 1;
    }
    const total = Object.values(MIXED_WEIGHTS).reduce((s, w) => s + w, 0);
    for (const [packId, weight] of Object.entries(MIXED_WEIGHTS) as [SourcePackId, number][]) {
      const share = (counts[packId] ?? 0) / (2 * draws);
      expect(Math.abs(share - weight / total), `${packId}: ${share.toFixed(3)} vs ${(weight / total).toFixed(3)}`).toBeLessThan(0.01);
    }
  });
});

describe("dealing over many matches", () => {
  it("never deals a pair where either phone could read its own name, over many seeded matches", () => {
    const problems: string[] = [];
    let rounds = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const pick = testContext(seed + 10_000).random;
      const packId = PACK_IDS[Math.floor(pick() * PACK_IDS.length)] as PackId;
      const levelA = LEVELS[Math.floor(pick() * 3)]!;
      const levelB = LEVELS[Math.floor(pick() * 3)]!;
      let { room, a, b, ctx } = setupRoom({ seed, settings: { packId, difficulty: "medium", matchType: "rounds" }, start: false });
      room = mustApply(room, a, cmd(room, "player.difficulty", { difficulty: levelA }), ctx);
      room = mustApply(room, b, cmd(room, "player.difficulty", { difficulty: levelB }), ctx);
      room = mustApply(room, a, cmd(room, "player.ready", { ready: true }), ctx);
      room = mustApply(room, b, cmd(room, "player.ready", { ready: true }), ctx);
      room = mustApply(room, a, cmd(room, "match.start"), ctx);
      for (let round = 1; round <= 10; round++) {
        problems.push(...check(room, `seed ${seed} ${packId} round ${round}`));
        rounds++;
        for (let turn = 0; turn < 2; turn++) room = mustApply(room, room.turn!.playerId, cmd(room, "turn.skip"), ctx);
        if (room.status === "match_summary") break;
        room = mustApply(room, a, cmd(room, "round.next"), ctx);
      }
    }
    expect(problems).toEqual([]);
    expect(rounds).toBe(1500);
  });

  it("never deals such a pair in a single pack, over many draws from a fresh and a used deck", () => {
    const problems: string[] = [];
    for (const packId of PACK_IDS) {
      const { room } = setupRoom({ settings: { packId }, start: false });
      const ctx = testContext(99);
      for (let i = 0; i < 1_000; i++) {
        const { pair } = drawPair(room, ctx.random);
        const [x, y] = pair;
        if (leak(x, y).length || leak(y, x).length) problems.push(`${packId}: ${x.id} / ${y.id}`);
        room.usedIdentityIds = i % 15 === 14 ? [] : [...room.usedIdentityIds, x.id, y.id];
      }
    }
    expect(problems).toEqual([]);
  });
});

function check(room: RoomState, label: string): string[] {
  const [x, y] = Object.values(room.round!.assignments).map(byId) as [Identity, Identity];
  const out: string[] = [];
  if (leak(x, y).length) out.push(`${label}: ${x.canonicalName} reads ${leak(x, y).join(", ")} on ${y.canonicalName}`);
  if (leak(y, x).length) out.push(`${label}: ${y.canonicalName} reads ${leak(y, x).join(", ")} on ${x.canonicalName}`);
  return out;
}
