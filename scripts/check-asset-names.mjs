// Fails the build if a file that is served as immutable could change under the same name.
// public/_headers makes everything under /assets/ cache for a year, which is only safe while
// every file there carries a content hash in its name (Vite does that for its own output).
// Usage: node scripts/check-asset-names.mjs [distClientDir] [publicDir]
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? new URL("../dist/client/", import.meta.url).pathname;
const publicDir = process.argv[3] ?? new URL("../public/", import.meta.url).pathname;
const HASHED = /-[A-Za-z0-9_-]{8}\./;

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const problems = [];
if (existsSync(join(publicDir, "assets"))) {
  problems.push("public/assets exists: copied as-is into /assets/, which is served immutable but is not hashed");
}
const assetsDir = join(dist, "assets");
if (existsSync(assetsDir)) {
  for (const path of files(assetsDir)) {
    if (!HASHED.test(path.slice(assetsDir.length + 1))) problems.push(`${path}: no content hash in its name`);
  }
}
if (problems.length) {
  console.error("check-asset-names: files under /assets/ are served immutable and must be content-hashed:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("check-asset-names: every file under dist/client/assets has a content hash in its name.");
