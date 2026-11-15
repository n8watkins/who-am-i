// Fails when what a party site takes from this package is not what its source builds to: the
// server game (party.js, from party.ts and src/party) and the room view (party-view/, from
// src/party-view and the game's screens it uses). Both are committed, because a party site runs
// no build of a game's: change the source, run `npm run build:party` and commit the result.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const fresh = mkdtempSync(join(tmpdir(), "who-am-i-party-"));

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = (dir) => (existsSync(dir) ? walk(dir).map((path) => relative(dir, path)).sort() : []);

const vite = (config, env) =>
  execFileSync(join(repo, "node_modules/.bin/vite"), ["build", "--config", config, "--logLevel", "error"], {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });

/** Compares a fresh build with the committed copy, file by file and byte for byte. */
function compare(label, built, committed, only = null) {
  const problems = [];
  const want = files(built).filter((p) => !only || only.includes(p));
  const have = only ? only.filter((p) => existsSync(join(committed, p))) : files(committed);
  for (const path of want) if (!have.includes(path)) problems.push(`missing: ${label}${path}`);
  for (const path of have) if (!want.includes(path)) problems.push(`not built from the source: ${label}${path}`);
  for (const path of want) {
    if (have.includes(path) && !readFileSync(join(built, path)).equals(readFileSync(join(committed, path)))) problems.push(`differs: ${label}${path}`);
  }
  return { problems, count: want.length };
}

try {
  vite("vite.party.config.ts", { PARTY_OUT: join(fresh, "server") });
  vite("vite.party-view.config.ts", { PARTY_VIEW_OUT: join(fresh, "party-view") });
  const server = compare("", join(fresh, "server"), repo, ["party.js"]);
  const view = compare("party-view/", join(fresh, "party-view"), join(repo, "party-view"));
  const problems = [...server.problems, ...view.problems];
  if (problems.length) {
    console.error(`check-party-build: the committed build is not what the source builds to. Run npm run build:party and commit it.\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`check-party-build: party.js and party-view/ (${view.count} files) match their source.`);
} finally {
  rmSync(fresh, { recursive: true, force: true });
}
