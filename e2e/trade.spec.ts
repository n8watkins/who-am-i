// Trade turns: one question and one guess per move, on two phones, with the secrecy capture.
import { expect, test } from "@playwright/test";
import { assertNoLeakBeforeReveal, createGame, joinGame, newPlayer, startMatch } from "./support";

test("players trade moves until the first correct guess wins the round", async ({ browser }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  const A = alice.page;
  const B = bob.page;
  const { link } = await createGame(A, { nickname: "Alice", turns: "Trade turns", difficulty: "Easy" });
  await joinGame(B, link, "Bob");
  await expect(B.getByTestId("settings-summary")).toContainText("Trade turns");
  const windowStart = alice.capture.mark();
  await startMatch(A, B);

  // Alice asks one question, and Bob answers.
  await A.getByRole("button", { name: "Am I a real person?" }).click();
  await expect(A.getByRole("button", { name: "Pass" })).toBeDisabled();
  await B.getByRole("button", { name: "Yes", exact: true }).click();

  // That was her one question: the composer is gone until her next move.
  await expect(A.getByTestId("move-prompt")).toContainText("pass to Bob");
  await expect(A.getByLabel("Type your own yes/no question")).toHaveCount(0);

  // A wrong guess ends her move.
  await A.getByRole("button", { name: "I Guessed It" }).click();
  await B.getByRole("button", { name: "Not quite" }).click();
  await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");

  // Bob passes without asking, and Alice's question is still in her log.
  await B.getByRole("button", { name: "Pass" }).click();
  await expect(A.getByTestId("turn-headline")).toHaveText("Your turn to guess");
  await expect(A.getByTestId("log-question")).toContainText("Am I a real person?");
  await expect(A.getByLabel("Type your own yes/no question")).toBeVisible();

  // A correct guess takes the round at once.
  await A.getByRole("button", { name: "I Guessed It" }).click();
  await B.getByRole("button", { name: "Yes, correct" }).click();
  await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  await expect(B.getByText("Beaten to it")).toBeVisible();
  expect(await assertNoLeakBeforeReveal(alice.capture, 1, windowStart)).toBeGreaterThan(0);
  for (const c of [alice, bob]) await c.context.close();
});

test("each player can set their own difficulty in the lobby", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const { link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");
  await bob.page.getByLabel("Your difficulty").selectOption("easy");
  await expect(bob.page.getByLabel("Your difficulty")).toHaveValue("easy");
  await expect(alice.page.getByLabel("Your difficulty")).toHaveValue("");
  await bob.page.reload();
  await expect(bob.page.getByLabel("Your difficulty")).toHaveValue("easy");
  for (const c of [alice, bob]) await c.context.close();
});
