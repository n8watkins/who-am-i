// Dark mode: follows the phone's setting by default, and Auto / Light / Dark in the footer
// overrides it per device.
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

const SHOTS = process.env.COMFORT_SHOTS;
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("the theme follows the system, and the footer switch overrides it per device", async ({ browser }) => {
  const { page, context } = await newPlayer(browser, { mobile: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await theme(page)).toBe("dark");
  expect(await background(page)).toBe("rgb(22, 20, 31)");
  const radio = (name: string) => page.getByTestId("theme-switch").getByRole("radio", { name });
  await expect(radio("Auto")).toHaveAttribute("aria-checked", "true");

  // Auto follows a live change of the system setting.
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
  expect(await background(page)).toBe("rgb(255, 248, 239)");

  // Dark sticks across a reload, even with a light system.
  await radio("Dark").click();
  await expect(radio("Dark")).toHaveAttribute("aria-checked", "true");
  expect(await theme(page)).toBe("dark");
  await page.reload();
  expect(await theme(page)).toBe("dark");
  await expect(radio("Dark")).toHaveAttribute("aria-checked", "true");

  // Light sticks with a dark system; Auto hands control back.
  await page.emulateMedia({ colorScheme: "dark" });
  await radio("Light").click();
  expect(await theme(page)).toBe("light");
  await radio("Auto").click();
  expect(await theme(page)).toBe("dark");
  await context.close();
});

test("the theme is set before the app draws, so there is no light flash", async ({ browser }) => {
  const { page, context } = await newPlayer(browser, { mobile: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __themeAtLoad: string | undefined }).__themeAtLoad = document.documentElement.dataset.theme;
    });
  });
  await page.goto("/");
  expect(await page.evaluate(() => (window as unknown as { __themeAtLoad: string | undefined }).__themeAtLoad)).toBe("dark");
  await context.close();
});

test("dark screens on a phone", async ({ browser }) => {
  test.skip(!SHOTS, "Screenshots only: set COMFORT_SHOTS to a folder.");
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  for (const p of [alice.page, bob.page]) await p.emulateMedia({ colorScheme: "dark" });
  await alice.page.goto("/");
  await alice.page.screenshot({ path: `${SHOTS}/dark-landing-390.png`, fullPage: true });
  const { link } = await createGame(alice.page, { nickname: "Alice", timer: "60 s", turns: "Trade turns" });
  await alice.page.screenshot({ path: `${SHOTS}/dark-lobby-390.png` });
  await joinGame(bob.page, link, "Bob");
  await startMatch(alice.page, bob.page);
  await alice.page.getByRole("button", { name: "Am I a real person?" }).click().catch(() => undefined);
  await alice.page.screenshot({ path: `${SHOTS}/dark-game-guesser-390.png` });
  await bob.page.screenshot({ path: `${SHOTS}/dark-game-answerer-390.png` });
  for (const c of [alice, bob]) await c.context.close();
});

test("dark screens on a desktop", async ({ browser }) => {
  test.skip(!SHOTS, "Screenshots only: set COMFORT_SHOTS to a folder.");
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  for (const p of [alice.page, bob.page]) await p.emulateMedia({ colorScheme: "dark" });
  await alice.page.goto("/new");
  await expect(alice.page.getByTestId("pack-actors")).toBeVisible();
  await alice.page.screenshot({ path: `${SHOTS}/dark-new-game-1280.png` });
  const { link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");
  await startMatch(alice.page, bob.page);
  await alice.page.getByRole("button", { name: "Hint" }).click();
  await expect(alice.page.getByTestId("log-hint")).toBeVisible();
  await alice.page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await alice.page.screenshot({ path: `${SHOTS}/dark-game-1280.png` });
  await alice.page.getByRole("button", { name: "Give up" }).click();
  await bob.page.getByRole("button", { name: "Give up" }).click();
  await expect(alice.page.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  await alice.page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await alice.page.screenshot({ path: `${SHOTS}/dark-reveal-1280.png` });
  for (const c of [alice, bob]) await c.context.close();
});
