// Fails the build if any identity name or id from the server-only packs appears in the client
// bundle. Identity content must reach a browser only through the per-player filtered API views.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The same holds for the room view a party room shows (party-view/, built from src/party-view):
// a phone there gets identities only in its own snapshots.
import { existsSync } from "node:fs";

const contentDir = new URL("../src/worker/content/", import.meta.url);
// `--party-view`: only the room view (npm run build:party), otherwise the site and the room view.
const bundles = (process.argv.includes("--party-view") ? ["party-view"] : ["dist/client", "party-view"]).map((dir) => new URL(`../${dir}/`, import.meta.url));
for (const dir of bundles) {
  if (!existsSync(dir)) {
    console.error(`check-bundle: ${dir.pathname} does not exist. Build it first.`);
    process.exit(1);
  }
}

const identities = [];
for (const file of readdirSync(contentDir)) {
  const source = readFileSync(new URL(file, contentDir), "utf8");
  const pack = /definePack\("([a-z-]+)"/.exec(source)?.[1];
  if (!pack) continue;
  for (const m of source.matchAll(/\[\s*"([^"]+)",\s*"([^"]+)",\s*"(?:easy|medium|hard)"/g)) {
    identities.push({ id: `${pack}.${m[1]}`, name: m[2] });
  }
}
if (identities.length < 200) {
  console.error(`check-bundle: expected 200+ identities, parsed ${identities.length}. Did the content format change?`);
  process.exit(1);
}

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const leaks = [];
for (const path of bundles.flatMap((dir) => files(dir.pathname))) {
  const text = readFileSync(path, "latin1");
  for (const { id, name } of identities) {
    if (text.includes(id)) leaks.push(`${path}: id ${id}`);
    if (text.includes(name)) leaks.push(`${path}: name "${name}"`);
  }
}
if (leaks.length) {
  console.error("check-bundle: identity content found in the client bundle:\n" + leaks.join("\n"));
  process.exit(1);
}
const scanned = bundles.map((dir) => dir.pathname.replace(/^.*\/([^/]+\/[^/]+|[^/]+)\/$/, "$1")).join(" and ");
console.log(`check-bundle: ${identities.length} identities, none present in ${scanned}.`);
