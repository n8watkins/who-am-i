import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CARD_TTL_MS, type CreatedCard, type PublicCard } from "../src/kit/shared/share-cards";
import { checkCardPng, handleShareApi } from "../src/kit/worker/share-cards";
import { getIdentity, packIdentities } from "../src/worker/content";
import type { RoomState } from "../src/worker/engine";
import type { RoomDurableObject } from "../src/worker/room";
import { DEFAULT_SETTINGS, type SessionResponse } from "../src/shared/protocol";

const BASE = "http://who-am-i.test";
let ip = 0;

/** The smallest bytes the card check accepts: a PNG signature and an IHDR of the given size. */
function fakePng(width = 1200, height = 630, extra = 64): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", `10.9.0.${++ip}`);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  return SELF.fetch(`${BASE}${path}`, { ...init, headers });
}

/** A two-player room whose match just ended, Alice 5 - Bob 3. */
async function finishedMatch() {
  const host = (await (
    await call("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "Alice", settings: { ...DEFAULT_SETTINGS, packId: "actors" } }),
    })
  ).json()) as SessionResponse;
  const code = host.view.code;
  const guest = (await (
    await call(`/api/rooms/${code}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: "Bob" }) })
  ).json()) as SessionResponse;
  const stub = env.ROOMS.getByName(code) as DurableObjectStub<RoomDurableObject>;
  const finish = async () =>
    runInDurableObject(stub, async (instance) => {
      const room = (instance as unknown as { room: RoomState }).room;
      room.status = "match_summary";
      room.roundIndex = 8;
      room.match = { winnerId: host.playerId, tie: false, rounds: 8 };
      room.usedIdentityIds = packIdentities("actors").slice(0, 16).map((i) => i.id);
      room.players.find((p) => p.id === host.playerId)!.score = 5;
      room.players.find((p) => p.id === guest.playerId)!.score = 3;
    });
  return { code, host, guest, finish };
}

const share = (code: string, token: string, body: Uint8Array) => call(`/api/rooms/${code}/share`, { method: "POST", token, body, headers: { "Content-Type": "image/png" } });
const setPublic = (id: string, ownerKey: string, value: boolean) =>
  call(`/api/share/${id}/visibility`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerKey, public: value }) });

describe("party kit card check", () => {
  it("accepts only a 1200x630 PNG under the size cap", () => {
    expect(checkCardPng(fakePng())).toBeNull();
    expect(checkCardPng(fakePng(1200, 1200))).toMatch(/1200x630/);
    expect(checkCardPng(new TextEncoder().encode("<svg onload=alert(1)>".padEnd(64)))).toMatch(/PNG/);
    expect(checkCardPng(fakePng(1200, 630, 500_000))).toMatch(/too large/);
  });
});

describe("shared result cards", () => {
  it("can only be made by a player, once the match is over", async () => {
    const { code, host, finish } = await finishedMatch();
    expect((await share(code, "not-a-token", fakePng())).status).toBe(401);
    const early = await share(code, host.token, fakePng());
    expect(early.status).toBe(409);
    await finish();
    expect((await share(code, host.token, fakePng(800, 600))).status).toBe(400);
    expect((await share(code, host.token, fakePng())).status).toBe(201);
  });

  it("stays private until shared, goes public while shared, and private again when stopped", async () => {
    const { code, guest, finish } = await finishedMatch();
    await finish();
    const created = (await (await share(code, guest.token, fakePng())).json()) as CreatedCard;
    expect(created.url).toBe(`${BASE}/s/${created.id}`);
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // Private: nothing is visible, except the image to its owner for the preview.
    expect((await call(`/api/share/${created.id}`)).status).toBe(404);
    expect((await call(`/api/share/${created.id}/image.png`)).status).toBe(404);
    const preview = await call(`/api/share/${created.id}/image.png?key=${created.ownerKey}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Cache-Control")).toBe("private, no-store");
    const privatePage = await call(`/s/${created.id}`);
    expect(privatePage.status).toBe(404);
    const privateHtml = await privatePage.text();
    expect(privateHtml).not.toContain("beat");
    expect(privateHtml).toContain('content="noindex"');

    // Only the owner key can publish.
    expect((await setPublic(created.id, "wrong-key", true)).status).toBe(404);
    expect((await setPublic(created.id, created.ownerKey, true)).status).toBe(200);

    const details = (await (await call(`/api/share/${created.id}`)).json()) as PublicCard;
    expect(details.title).toBe("Alice beat Bob 5-3 at Who Am I?");
    expect(details.description).toBe("Actors, 8 rounds. A two-player guessing game: you each get a secret identity, and only your friend can see yours.");
    const image = await call(`/api/share/${created.id}/image.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(fakePng());

    const page = await call(`/s/${created.id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<title>Alice beat Bob 5-3 at Who Am I?</title>");
    expect(html).toContain(`<meta property="og:image" content="${BASE}/api/share/${created.id}/image.png"`);
    expect(html).toContain(`<meta property="og:url" content="${BASE}/s/${created.id}"`);
    expect(html).toContain('<div id="root">');

    expect((await setPublic(created.id, created.ownerKey, false)).status).toBe(200);
    expect((await call(`/api/share/${created.id}`)).status).toBe(404);
    expect((await call(`/s/${created.id}`)).status).toBe(404);
  });

  it("never names an identity", async () => {
    const { code, host, finish } = await finishedMatch();
    const stub = env.ROOMS.getByName(code) as DurableObjectStub<RoomDurableObject>;
    await finish();
    const created = (await (await share(code, host.token, fakePng())).json()) as CreatedCard;
    await setPublic(created.id, created.ownerKey, true);
    const used = await runInDurableObject(stub, async (instance) => (instance as unknown as { room: RoomState }).room.usedIdentityIds);
    expect(used.length).toBe(16);
    const text = await (await call(`/api/share/${created.id}`)).text();
    for (const id of used) expect(text).not.toContain(getIdentity(id).canonicalName);
  });

  it("expires after 90 days", async () => {
    const { code, host, finish } = await finishedMatch();
    await finish();
    const created = (await (await share(code, host.token, fakePng())).json()) as CreatedCard;
    await setPublic(created.id, created.ownerKey, true);
    const later = Date.now() + CARD_TTL_MS + 1;
    const url = new URL(`${BASE}/api/share/${created.id}`);
    const res = await handleShareApi(new Request(url), env, url, later);
    expect(res!.status).toBe(404);
  });

  it("rejects unknown and malformed ids the same way", async () => {
    for (const id of ["AAAAAAAAAAAAAAAAAAAAAA", "x", "%3Cscript%3E", "AAAAAAAAAAAAAAAAAAAAAA%00"]) {
      expect((await call(`/api/share/${id}`)).status).toBe(404);
    }
  });
});
