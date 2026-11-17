// A test-only Worker entry: the real Worker, with a deck cut down to a few names and the rules'
// randomness pinned to 0, so an end-to-end test can deal one chosen pair the way a real room does.
// The forced-deal Playwright project runs `wrangler dev` on this file (playwright.config.ts);
// the live site never loads it.
//
// With every random draw at 0, a room deals the first dealable name of its pool to the first
// guesser (the host, who goes first in these tests) and the first name the rules allow beside it
// to the other player. The kept names are in the packs' own order, so:
// - Video Games deals Link first; Princess Zelda is next in line, Pikachu after her.
// - Mixed deals Jennifer Lawrence first (Actors is the first pack); Katniss Everdeen is next in
//   line, then the Video Games names.
import { cryptoSources } from "../../src/party/game";
import { ALL_PACK_IDENTITIES } from "../../src/worker/content";

const keep = new Set([
  "actors.jennifer-lawrence",
  "movie-characters.katniss-everdeen",
  "video-games.link",
  "video-games.princess-zelda",
  "video-games.pikachu",
]);
for (const identity of ALL_PACK_IDENTITIES) identity.active = keep.has(identity.id);
cryptoSources.random = () => 0;

export * from "../../src/worker/index";
export { default } from "../../src/worker/index";
