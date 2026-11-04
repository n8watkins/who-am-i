// Desktop comes first: each main screen must fit a 1280x800 window without page scrolling.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

/** Fits without page scrolling, and has no accessibility violations. */
async function checkScreen(page: Page, screen: string) {
  const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, view: window.innerHeight }));
  expect(scroll, `${screen} is ${scroll}px tall in a ${view}px window`).toBeLessThanOrEqual(view);
  // Cards fade in, and a half-faded card would read as low contrast.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`), `${screen} accessibility`).toEqual([]);
}

test("the main screens fit a desktop window and pass accessibility checks", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const A = alice.page;
  const B = bob.page;

  await A.goto("/");
  await expect(A.getByRole("button", { name: "Create game" })).toBeVisible();
  await checkScreen(A, "landing");
  await A.getByRole("button", { name: "Create game" }).click();
  await expect(A.getByTestId("pack-actors")).toBeVisible();
  await checkScreen(A, "new game");

  const { link } = await createGame(A, { nickname: "Alice" });
  await checkScreen(A, "lobby waiting");
  await B.goto(link);
  await expect(B.getByLabel("Your nickname")).toBeVisible();
  await checkScreen(B, "join");
  await joinGame(B, link, "Bob");
  await expect(A.getByTestId("slot-B")).toContainText("Bob");
  await checkScreen(A, "lobby full");

  await startMatch(A, B);
  await expect(A.getByTestId("turn-headline")).toHaveText("Your turn to guess");
  await checkScreen(A, "guesser");
  await checkScreen(B, "answerer");

  await A.getByRole("button", { name: "Give up" }).click();
  await B.getByRole("button", { name: "Give up" }).click();
  await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  await checkScreen(A, "reveal");
  for (const c of [alice, bob]) await c.context.close();
});
