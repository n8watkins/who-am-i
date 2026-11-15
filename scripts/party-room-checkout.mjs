// The party room's own code, at a pinned commit, for the harness test (test/party-room/): the
// real party room class (lobby/server/lobby-room.js) and the fake Durable Object runtime its own
// tests drive it with (lobby/test/fake-room.js), from n8watkins/n8-party-games.
//
// The party site's package does not ship the party room (its `files` list holds only the kit), so
// it cannot be a dependency; this fetches only the folders the harness needs, once, into
// .cache/ (ignored by git). Vitest's "party-room" project runs it as its global setup, and
// `node scripts/party-room-checkout.mjs` runs it by hand. Bump PARTY_ROOM_COMMIT to test against
// a newer party room.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * n8-party-games #32 (feat/party-room-audience): the party room with the settings step, spots and
 * an audience for a larger party, and the upright phone. `PARTY_ROOM_COMMIT=<sha>` in the
 * environment tests against another commit without editing this file.
 */
export const PARTY_ROOM_COMMIT = process.env.PARTY_ROOM_COMMIT || "9911f1cf31bf7c8bd03f975cd954ebdb21f49007";
const REPOSITORY = "https://github.com/n8watkins/n8-party-games.git";
const FOLDERS = ["lobby/server", "lobby/shared", "lobby/test", "party-kit/src", "party-kit/client"];

/** Where the checkout lives: a folder per commit, so a bumped pin never reads an older one. */
export const PARTY_ROOM_DIR = fileURLToPath(new URL(`../.cache/n8-party-games/${PARTY_ROOM_COMMIT}/`, import.meta.url));

const git = (...args) => execFileSync("git", args, { stdio: ["ignore", "ignore", "inherit"] });

export function ensurePartyRoom() {
  const done = `${PARTY_ROOM_DIR}.ready`;
  if (existsSync(done)) return PARTY_ROOM_DIR;
  rmSync(PARTY_ROOM_DIR, { recursive: true, force: true });
  mkdirSync(PARTY_ROOM_DIR, { recursive: true });
  git("-C", PARTY_ROOM_DIR, "init", "-q");
  git("-C", PARTY_ROOM_DIR, "remote", "add", "origin", REPOSITORY);
  git("-C", PARTY_ROOM_DIR, "sparse-checkout", "set", "--no-cone", ...FOLDERS.map((f) => `/${f}/`));
  git("-C", PARTY_ROOM_DIR, "fetch", "-q", "--depth=1", "--filter=blob:none", "origin", PARTY_ROOM_COMMIT);
  git("-C", PARTY_ROOM_DIR, "checkout", "-q", "--detach", "FETCH_HEAD");
  mkdirSync(done);
  return PARTY_ROOM_DIR;
}

/** Vitest global setup: fetch before the harness files are imported, and tell them where (`inject("partyRoomDir")`). */
export default function setup({ provide }) {
  provide("partyRoomDir", ensurePartyRoom());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(ensurePartyRoom());
