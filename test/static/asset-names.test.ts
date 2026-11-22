// The build refuses an unhashed file under /assets (it would be served immutable for a year).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = new URL("../../scripts/check-asset-names.mjs", import.meta.url).pathname;

function run(assets: string[], publicAssets = false) {
  const root = mkdtempSync(join(tmpdir(), "asset-names-"));
  mkdirSync(join(root, "dist/assets"), { recursive: true });
  mkdirSync(join(root, "public"), { recursive: true });
  if (publicAssets) mkdirSync(join(root, "public/assets"));
  for (const name of assets) writeFileSync(join(root, "dist/assets", name), "x");
  return spawnSync(process.execPath, [script, join(root, "dist"), join(root, "public")], { encoding: "utf8" });
}

describe("check-asset-names", () => {
  it("accepts Vite's hashed names", () => {
    expect(run(["index-BE1P51ec.js", "nunito-latin-wght-normal-BzFMHfZw.woff2", "app-a_b-c-D1.css"]).status).toBe(0);
  });

  it("fails on an unhashed file", () => {
    const result = run(["index-BE1P51ec.js", "logo.png"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("logo.png");
  });

  it("fails when public/assets exists", () => {
    expect(run(["index-BE1P51ec.js"], true).status).toBe(1);
  });
});
