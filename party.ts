// What Who Am I? gives a site that hosts it in a party room (n8watkins/n8-party-games): the
// server game and its manifest, per the party kit's GAME-CONTRACT.md.
//
// This is the source. The package's "." export is party.js, built from it by `npm run
// build:party` and committed: the contract asks for plain JavaScript, and the party site's own
// build runs in plain Node, which refuses to load TypeScript from node_modules (README, "In the
// party room"). `npm run check:party` keeps the two the same. Nothing here, or in anything it
// imports, names the kit or the Workers runtime, so a host's bundle holds one copy of the kit.

/** The server game definition for the party room. */
export { game } from "./src/party/room-game";
/** id, name, path, players, devices, the room view (`lobby.view`), the settings fields and the public files. */
export { manifest } from "./src/party/manifest";
