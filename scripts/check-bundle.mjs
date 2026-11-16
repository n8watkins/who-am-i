// Fails the build if any identity name or id from the server-only packs appears in the client
// bundle. Identity content must reach a browser only through the per-player filtered API views.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const contentDir = new URL("../src/worker/content/", import.meta.url);
const distDir = new URL("../dist/client/", import.meta.url);

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

// Picture addresses travel only in per-player views too, never in the bundle.
const pictureSource = readFileSync(new URL("picture-data.ts", contentDir), "utf8");
const pictureUrls = [...pictureSource.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
if (pictureUrls.length < 100) {
  console.error(`check-bundle: expected 100+ picture addresses, parsed ${pictureUrls.length}. Did the picture data format change?`);
  process.exit(1);
}

const leaks = [];
for (const path of files(distDir.pathname)) {
  const text = readFileSync(path, "latin1");
  for (const { id, name } of identities) {
    if (text.includes(id)) leaks.push(`${path}: id ${id}`);
    if (text.includes(name)) leaks.push(`${path}: name "${name}"`);
  }
  for (const url of pictureUrls) if (text.includes(url)) leaks.push(`${path}: picture ${url}`);
}
if (leaks.length) {
  console.error("check-bundle: identity content found in the client bundle:\n" + leaks.join("\n"));
  process.exit(1);
}
console.log(`check-bundle: ${identities.length} identities and ${pictureUrls.length} picture addresses, none present in dist/client.`);
