// Creates .dev.vars with a random SESSION_SECRET for local development if it does not exist.
// The secret is never printed.
import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const path = new URL("../.dev.vars", import.meta.url);
if (!existsSync(path)) {
  writeFileSync(path, `SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  console.log("Created .dev.vars with a random local SESSION_SECRET.");
}
