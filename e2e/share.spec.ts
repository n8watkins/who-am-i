// The shareable result card: private until the player taps Share or Copy link, a real link preview
// once shared, private again if the share sheet is cancelled or the player stops sharing.
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

const SHOTS = process.env.COMFORT_SHOTS;

declare global {
  interface Window {
    __shared: ShareData[];
    __cancelShare: boolean;
  }
}

/** Plays a first-to-5 match quickly: Alice always guesses right, Bob always gives up. */
async function playToTheEnd(alice: Page, bob: Page) {
  const headline = alice.getByTestId("match-headline");
  const guess = alice.getByRole("button", { name: "I Guessed It" });
  const confirm = bob.getByRole("button", { name: "Yes, correct" });
  const giveUp = bob.getByRole("button", { name: "Give up" });
  const next = alice.getByRole("button", { name: /Next round|See final results/ });
  for (let step = 0; step < 80 && !(await headline.isVisible()); step++) {
    if (await next.isVisible()) await next.click();
    else if (await confirm.isVisible()) await confirm.click();
    else if ((await guess.isVisible()) && (await guess.isEnabled())) await guess.click();
    else if (await giveUp.isVisible()) await giveUp.click();
    await alice.waitForTimeout(100);
  }
  await expect(headline).toHaveText("You win!");
}

test("a result card is private until shared, previews as a link, and can be taken down", async ({ browser, baseURL }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  await alice.context.addInitScript(() => {
    window.__shared = [];
    window.__cancelShare = false;
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        window.__shared.push(data);
        if (window.__cancelShare) throw new DOMException("Share canceled", "AbortError");
      },
    });
  });
  const { link } = await createGame(alice.page, { nickname: "Alice", pack: "actors" });
  await joinGame(bob.page, link, "Bob");
  await startMatch(alice.page, bob.page);
  await playToTheEnd(alice.page, bob.page);

  // Opening the dialog paints the card and uploads it, private.
  const uploaded = alice.page.waitForResponse((r) => r.url().endsWith("/share") && r.request().method() === "POST");
  await alice.page.getByRole("button", { name: "Share result" }).click();
  const upload = await uploaded;
  const card = (await upload.json()) as { id: string; url: string; ownerKey: string };
  expect(upload.status(), JSON.stringify(card)).toBe(201);
  expect(card.url).toBe(`${baseURL}/s/${card.id}`);
  const dialog = alice.page.getByRole("dialog", { name: "Share your result" });
  await expect(dialog.getByTestId("share-preview")).toBeVisible();
  await expect(dialog.getByTestId("share-status")).toHaveText("Only you can see this card until you share it.");
  if (SHOTS) await alice.page.screenshot({ path: `${SHOTS}/share-dialog-390.png` });

  const details = () => alice.page.request.get(`${baseURL}/api/share/${card.id}`);
  expect((await details()).status()).toBe(404);
  expect((await alice.page.request.get(`${baseURL}/s/${card.id}`)).status()).toBe(404);

  // Cancelling the share sheet leaves it private.
  await alice.page.evaluate(() => (window.__cancelShare = true));
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(() => alice.page.evaluate(() => window.__shared.length)).toBe(1);
  await expect.poll(async () => (await details()).status()).toBe(404);
  await expect(dialog.getByRole("button", { name: "Stop sharing" })).toHaveCount(0);

  // Sharing makes it public, with the server's own words and a 1200x630 PNG.
  await alice.page.evaluate(() => (window.__cancelShare = false));
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByTestId("share-status")).toHaveText("Shared. Anyone with the link can see this card.");
  const sent = await alice.page.evaluate(() => window.__shared.at(-1)!);
  expect(sent.url).toBe(card.url);
  expect(sent.text).toBe("Alice wins! Our Who Am I? result:");
  const res = await details();
  expect(res.status()).toBe(200);
  expect((await res.json()).title).toBe("Alice beat Bob 5-0 at Who Am I?");
  const image = await alice.page.request.get(`${baseURL}/api/share/${card.id}/image.png`);
  expect(image.headers()["content-type"]).toBe("image/png");
  const png = await image.body();
  // Small enough for a phone on a slow connection.
  expect(png.byteLength).toBeLessThan(150_000);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  if (SHOTS) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${SHOTS}/share-card-1200x630.png`, png);
  }
  const html = await (await alice.page.request.get(`${baseURL}/s/${card.id}`)).text();
  expect(html).toContain(`<meta property="og:image" content="${baseURL}/api/share/${card.id}/image.png"`);
  expect(html).toContain("<title>Alice beat Bob 5-0 at Who Am I?</title>");

  // A friend opens the link.
  const friend = await newPlayer(browser, { mobile: true });
  await friend.page.goto(`/s/${card.id}`);
  await expect(friend.page.getByTestId("shared-title")).toHaveText("Alice beat Bob 5-0 at Who Am I?");
  await expect.poll(() => friend.page.getByTestId("shared-card").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200);
  await expect(friend.page.getByRole("button", { name: "Play Who Am I?" })).toBeVisible();
  if (SHOTS) await friend.page.screenshot({ path: `${SHOTS}/share-public-page-390.png`, fullPage: true });

  // Stop sharing: the link goes dark.
  await dialog.getByRole("button", { name: "Stop sharing" }).click();
  await expect.poll(async () => (await details()).status()).toBe(404);
  await friend.page.reload();
  await expect(friend.page.getByRole("heading", { name: "This result is not shared" })).toBeVisible();

  await friend.context.close();
  await alice.context.close();
  await bob.context.close();
});

test("without a share sheet, Copy link copies the card's link and makes it public", async ({ browser, baseURL }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  await bob.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await bob.context.addInitScript(() => {
    delete (Navigator.prototype as { share?: unknown }).share;
  });
  const { link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");
  await startMatch(alice.page, bob.page);
  await playToTheEnd(alice.page, bob.page);

  await bob.page.getByRole("button", { name: "Share result" }).click();
  const dialog = bob.page.getByRole("dialog", { name: "Share your result" });
  await expect(dialog.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  const copy = dialog.getByRole("button", { name: "Copy link" });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(dialog.getByTestId("share-status")).toHaveText("Link copied. Anyone with the link can see this card.");
  const copied = await bob.page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(new RegExp(`^${baseURL}/s/[A-Za-z0-9_-]{22}$`));
  expect((await bob.page.request.get(copied.replace("/s/", "/api/share/"))).status()).toBe(200);

  await alice.context.close();
  await bob.context.close();
});
