// Fails when the committed room view (party-view/) is not what its source (src/party-view, and
// the game's screens it uses) builds to. A party site serves party-view/ as it is from this
// package, so a change to the screens must be rebuilt (npm run build:party-view) and committed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const committed = join(repo, "party-view");
const fresh = mkdtempSync(join(tmpdir(), "who-am-i-party-view-"));

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = (dir) => walk(dir).map((path) => relative(dir, path)).sort();

try {
  execFileSync(join(repo, "node_modules/.bin/vite"), ["build", "--config", "vite.party-view.config.ts", "--logLevel", "error"], {
    cwd: repo,
    env: { ...process.env, PARTY_VIEW_OUT: fresh },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const want = files(fresh);
  const have = files(committed);
  const problems = [];
  for (const path of want) if (!have.includes(path)) problems.push(`missing: party-view/${path}`);
  for (const path of have) if (!want.includes(path)) problems.push(`not built from the source: party-view/${path}`);
  for (const path of want) {
    if (have.includes(path) && !readFileSync(join(fresh, path)).equals(readFileSync(join(committed, path)))) problems.push(`differs: party-view/${path}`);
  }
  if (problems.length) {
    console.error(`check-party-view: party-view/ is not what src/party-view builds to. Run npm run build:party-view and commit it.\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`check-party-view: party-view/ matches its source (${want.length} files).`);
} finally {
  rmSync(fresh, { recursive: true, force: true });
}
