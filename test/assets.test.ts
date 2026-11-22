import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { hashedAsset } from "../src/worker/assets";

const asset = (response: Response): { ASSETS: Fetcher } => ({ ASSETS: { fetch: async () => response } as unknown as Fetcher });
const request = new Request("https://whoami.n8builds.dev/assets/index-OLDHASH0.js");

describe("hashedAsset", () => {
  it("passes a real file through untouched", async () => {
    const real = new Response("export {}", { headers: { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable" } });
    const response = await hashedAsset(request, asset(real));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe("export {}");
  });

  it("turns the single-page-app fallback (200 text/html) into a 404", async () => {
    const fallback = new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const response = await hashedAsset(request, asset(fallback));
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps a 404 from the asset layer a 404", async () => {
    const response = await hashedAsset(request, asset(new Response("nope", { status: 404 })));
    expect(response.status).toBe(404);
  });
});

describe("the Worker", () => {
  it("answers a missing file under /assets/ with a 404, never HTML", async () => {
    const response = await SELF.fetch("https://whoami.n8builds.dev/assets/index-OLDHASH0.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).not.toMatch(/html/);
  });
});
