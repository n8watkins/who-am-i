// The built site's real caching: Vite's hashed files are immutable, pages are not, and a file that
// is gone (an old page asking for the previous release's chunk) is a 404 rather than the app's HTML.
import { expect, test } from "@playwright/test";

test("hashed assets are immutable, pages revalidate, and a missing asset is a 404", async ({ request }) => {
  const home = await request.get("/");
  expect(home.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  const html = await home.text();
  const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!);
  expect(scripts.length).toBeGreaterThan(0);
  for (const path of scripts) {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  }

  const deep = await request.get("/join/ABCD");
  expect(deep.status()).toBe(200);
  expect(deep.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");

  const gone = await request.get("/assets/index-OLDHASH0.js");
  expect(gone.status()).toBe(404);
  expect(gone.headers()["content-type"]).not.toContain("html");

  const version = await request.get("/api/version");
  expect(version.headers()["cache-control"]).toBe("no-store");
});
