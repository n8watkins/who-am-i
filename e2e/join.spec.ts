import { expect, test } from "@playwright/test";
import { qrPath } from "../src/client/lib/qr";
import { assertNoLeakBeforeReveal, createGame, newPlayer, startMatch } from "./support";

test("a friend joins with just the PIN and a nickname, in under 10 seconds", async ({ browser, baseURL }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser, { mobile: true });
  await createGame(host.page, { nickname: "Alice" });
  const pin = (await host.page.getByTestId("room-pin").textContent())!.trim();
  expect(pin).toMatch(/^\d{4}$/);

  await guest.page.goto(baseURL!);
  const started = Date.now();
  await guest.page.getByRole("button", { name: "Join with PIN or code" }).click();
  await guest.page.getByLabel("PIN or room code").fill(pin);
  await guest.page.getByRole("button", { name: "Continue" }).click();
  await expect(guest.page.getByRole("heading", { name: "Join Alice's game?" })).toBeVisible();
  await guest.page.getByLabel("Your nickname").fill("Bob");
  await guest.page.getByRole("button", { name: "Join game" }).click();
  await expect(guest.page.getByTestId("slot-B")).toContainText("Bob");
  expect(Date.now() - started).toBeLessThan(10_000);

  // A full lobby has nothing left to invite to.
  await expect(host.page.getByTestId("room-pin")).toHaveCount(0);
  await expect(host.page.getByTestId("room-qr")).toHaveCount(0);

  // Joining by PIN keeps the secrecy guarantee.
  const windowStart = guest.capture.mark();
  await startMatch(host.page, guest.page);
  await guest.capture.snapshot("in game");
  await host.page.getByRole("button", { name: "Give up" }).click();
  await guest.page.getByRole("button", { name: "Give up" }).click();
  await expect(guest.page.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  expect(await assertNoLeakBeforeReveal(guest.capture, 1, windowStart)).toBeGreaterThan(0);

  await host.context.close();
  await guest.context.close();
});

test("something that is not a PIN or code gets a clear message", async ({ browser, baseURL }) => {
  const { page, context } = await newPlayer(browser, { mobile: true });
  await page.goto(`${baseURL}/join`);
  await page.getByLabel("PIN or room code").fill("abc");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter the 4-digit PIN or the 6-character room code.")).toBeVisible();
  await context.close();
});

test("the invite shows a QR of the room link, copies with confirmation and shortens the link", async ({ browser }) => {
  const { page, context } = await newPlayer(browser);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { code, link } = await createGame(page, { nickname: "Alice" });
  expect(link).toMatch(new RegExp(`^https?://[^/]+/r/${code}$`));

  const qr = page.getByTestId("room-qr");
  await expect(qr).toBeVisible();
  expect(await qr.locator("path").getAttribute("d")).toBe(qrPath(link).d);
  await expect(qr).toHaveAttribute("aria-label", /QR code/);

  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Code copied" })).toBeAttached();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible({ timeout: 4000 });

  await page.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  expect(await page.getByTestId("invite-link").textContent()).toBe(link.replace(/^https?:\/\//, ""));
  await context.close();
});

test("New PIN replaces the PIN, and the old one stops working", async ({ browser, baseURL }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);
  await createGame(host.page, { nickname: "Alice" });
  const pinCell = host.page.getByTestId("room-pin");
  const oldPin = (await pinCell.textContent())!.trim();
  await host.page.getByRole("button", { name: "New PIN" }).click();
  await expect(pinCell).not.toHaveText(oldPin);

  await guest.page.goto(`${baseURL}/join`);
  await guest.page.getByLabel("PIN or room code").fill(oldPin);
  await guest.page.getByRole("button", { name: "Continue" }).click();
  await expect(guest.page.getByText("No open game has that PIN.")).toBeVisible();
  await host.context.close();
  await guest.context.close();
});

test("the host can remove a player, who then cannot use the old PIN", async ({ browser, baseURL }) => {
  const host = await newPlayer(browser, { mobile: true });
  const guest = await newPlayer(browser);
  const { link } = await createGame(host.page, { nickname: "Alice" });
  const oldPin = (await host.page.getByTestId("room-pin").textContent())!.trim();

  await guest.page.goto(link);
  await guest.page.getByLabel("Your nickname").fill("Bob");
  await guest.page.getByRole("button", { name: "Join game" }).click();
  await expect(guest.page.getByTestId("room-code")).toBeVisible();
  // On a phone the Remove button must not squeeze the name out of the row.
  await expect(host.page.getByTestId("slot-B").getByText("Bob")).toBeVisible();

  await host.page.getByRole("button", { name: "Remove Bob" }).click();
  await expect(guest.page.getByRole("heading", { name: "You were removed from this game" })).toBeVisible();
  await expect(host.page.getByTestId("slot-B")).toContainText("Waiting for a player");
  const newPin = (await host.page.getByTestId("room-pin").textContent())!.trim();
  expect(newPin).not.toBe(oldPin);

  await guest.page.getByRole("button", { name: "Back to home" }).click();
  await guest.page.goto(`${baseURL}/join`);
  await guest.page.getByLabel("PIN or room code").fill(oldPin);
  await guest.page.getByRole("button", { name: "Continue" }).click();
  await expect(guest.page.getByText("No open game has that PIN.")).toBeVisible();
  await host.context.close();
  await guest.context.close();
});

test("a player removed before their connection opened is still told why", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);
  const { link } = await createGame(host.page, { nickname: "Alice" });
  await guest.page.goto(link);
  await guest.page.getByLabel("Your nickname").fill("Bob");
  await guest.page.getByRole("button", { name: "Join game" }).click();
  // Wait for the guest's own lobby: until then their browser has not saved its session.
  await expect(guest.page.getByTestId("room-code")).toBeVisible();
  await expect(host.page.getByTestId("slot-B")).toContainText("Bob");

  // The guest is gone when the host removes them, so no socket can carry the news.
  await guest.page.close();
  await host.page.getByRole("button", { name: "Remove Bob" }).click();
  await expect(host.page.getByTestId("slot-B")).toContainText("Waiting for a player");

  const back = await guest.context.newPage();
  await back.goto(link);
  await expect(back.getByRole("heading", { name: "You were removed from this game" })).toBeVisible();
  await host.context.close();
  await guest.context.close();
});
