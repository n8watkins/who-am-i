// Pins the caching rules in public/_headers and the routing in wrangler.jsonc so they cannot
// regress: hashed /assets/* are immutable, nothing else is, and /assets/* goes through the Worker
// first (so a missing hashed file is a 404, see src/worker/assets.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headersFile = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");

type Rule = { pattern: string; headers: Map<string, string> };

/** Parses the Cloudflare `_headers` format: an unindented path line, then indented `Name: value` lines. */
function parse(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: new Map() });
      continue;
    }
    const [name, ...value] = raw.trim().split(":");
    rules[rules.length - 1]!.headers.set(name!.trim().toLowerCase(), value.join(":").trim());
  }
  return rules;
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return re.test(path);
}

/** The Cache-Control values that apply to a path (every matching rule adds one; none means the default). */
function cacheControl(path: string): string[] {
  return parse(headersFile)
    .filter((rule) => matches(rule.pattern, path))
    .flatMap((rule) => rule.headers.get("cache-control") ?? []);
}

describe("public/_headers", () => {
  it("makes Vite's hashed files under /assets immutable for a year", () => {
    for (const path of ["/assets/index-BE1P51ec.js", "/assets/index-CkbegL7M.css", "/assets/nunito-latin-wght-normal-BzFMHfZw.woff2"]) {
      expect(cacheControl(path)).toEqual(["public, max-age=31536000, immutable"]);
    }
  });

  it("leaves HTML and every unhashed file on the default short cache", () => {
    for (const path of ["/", "/index.html", "/join/ABCD", "/favicon.svg", "/og-image.png", "/theme-init.js", "/api/version", "/assetsx/a.js"]) {
      expect(cacheControl(path)).toEqual([]);
    }
  });

  it("still sets the security headers on everything", () => {
    const all = parse(headersFile).find((rule) => rule.pattern === "/*");
    expect(all?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(all?.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("wrangler.jsonc", () => {
  it("runs the Worker first for /assets/* so a missing file is a 404, not the SPA fallback", () => {
    expect(wrangler).toMatch(/"run_worker_first":\s*\[[^\]]*"\/assets\/\*"/);
    expect(wrangler).toMatch(/"not_found_handling":\s*"single-page-application"/);
  });
});
