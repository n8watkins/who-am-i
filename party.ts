// What Who Am I? gives a site that hosts it in a party room (n8watkins/n8-party-games): the
// server game and its manifest, per the party kit's GAME-CONTRACT.md. The package's "." export.
//
// It is TypeScript on purpose: a host's bundler (wrangler's esbuild) and test runner (Vitest)
// compile it as they find it, with no build step (README, "In the party room"). Nothing here, or
// in anything it imports, names the kit or the Workers runtime, so a host's bundle holds one copy
// of the kit, its own.

/** The server game definition for the party room. */
export { game } from "./src/party/room-game";
/** id, name, path, players, devices, the room view (`lobby.view`), the settings fields and the public files. */
export { manifest } from "./src/party/manifest";
