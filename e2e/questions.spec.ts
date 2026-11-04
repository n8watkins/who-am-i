// In-app yes/no questions: suggested and typed questions, answers on the other phone, the
// shared log, the question counter, and the room's Questions setting.
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

/** Each named button is fully inside the viewport at the current scroll position (no scrolling needed). */
async function expectInView(page: Page, names: string[]) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const viewport = page.viewportSize()!;
  for (const name of names) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box, `${name} is rendered`).not.toBeNull();
    expect(box!.y >= 0 && box!.y + box!.height <= viewport.height, `${name} is visible without scrolling`).toBe(true);
  }
}

test("the guesser asks in the app and the opponent answers on their phone", async ({ browser }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  const A = alice.page;
  const B = bob.page;
  const { link } = await createGame(A, { nickname: "Alice" });
  await joinGame(B, link, "Bob");
  await startMatch(A, B);

  // Suggestions sit in one scrollable row.
  await expect(A.getByRole("group", { name: "Suggested questions" }).getByRole("button")).toHaveCount(8);
  // The turn's actions are reachable at 390x844 without scrolling, with the ask panel open.
  await expectInView(A, ["I Guessed It", "Skip", "Get a hint, 3 of 3 left"]);
  // A suggested question.
  await A.getByRole("button", { name: "Am I alive today?" }).click();
  await expect(A.getByText("Waiting for Bob to answer...")).toBeVisible();
  await expect(B.getByTestId("pending-question")).toHaveText("Am I alive today?");
  // The opponent can answer without scrolling.
  await expectInView(B, ["Yes", "No", "Sort of", "Don't know"]);
  await B.getByRole("button", { name: "Sort of" }).click();
  await expect(A.getByTestId("log-question").first()).toContainText("Sort of");
  await expect(B.getByTestId("log-question").first()).toContainText("Sort of");
  await expect(B.getByTestId("answer-panel")).toHaveCount(0);

  // A typed question is shown as plain text, never as HTML.
  await A.getByLabel("Type your own yes/no question").fill("  <b>Am I</b>   from a <i>cartoon</i>?  ");
  await A.getByRole("button", { name: "Send" }).click();
  await expect(B.getByTestId("pending-question")).toHaveText("<b>Am I</b> from a <i>cartoon</i>?");
  await expect(B.getByTestId("pending-question").locator("b, i")).toHaveCount(0);
  await B.getByRole("button", { name: "Don't know" }).click();
  await expect(A.getByTestId("log-question")).toHaveCount(2);

  // With the log filled, actions stay in view, and scrolling to the end never hides the log under the bar.
  await A.getByRole("button", { name: "Get a hint" }).click();
  await expect(A.getByTestId("log-hint")).toHaveCount(1);
  await expectInView(A, ["I Guessed It", "Skip", "Get a hint, 2 of 3 left"]);
  await A.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bar = await A.getByTestId("action-bar").boundingBox();
  const lastEntry = await A.getByTestId("turn-log").locator("li").last().boundingBox();
  expect(bar && lastEntry && lastEntry.y + lastEntry.height <= bar.y).toBe(true);

  // Sent questions count; the manual +1 still works for spoken ones.
  await expect(A.getByTestId("question-count")).toHaveText("2");
  await B.getByRole("button", { name: "Count one more question" }).click();
  await expect(A.getByTestId("question-count")).toHaveText("3");

  // The log resets for the next turn.
  await A.getByRole("button", { name: "Skip" }).click();
  await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");
  await expect(B.getByTestId("log-question")).toHaveCount(0);
  for (const c of [alice, bob]) await c.context.close();
});

test("a spoken-only room hides the in-app question panel, and leaving frees the seat", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const { link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");

  await alice.page.getByRole("button", { name: "Edit" }).click();
  await alice.page.getByRole("radio", { name: "Spoken", exact: true }).check();
  await alice.page.getByRole("button", { name: "Save" }).click();
  await startMatch(alice.page, bob.page);
  await expect(alice.page.getByRole("group", { name: "Suggested questions" })).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Count one more question" })).toBeVisible();
  await alice.page.getByRole("button", { name: "Skip" }).click();
  await bob.page.getByRole("button", { name: "Skip" }).click();
  await alice.page.getByRole("button", { name: "Next round" }).click();
  await alice.page.getByRole("button", { name: "Leave room" }).first().click();
  await alice.page.getByRole("dialog").getByRole("button", { name: "Leave room" }).click();
  await expect(bob.page.getByText("Your opponent left.")).toBeVisible();
  for (const c of [alice, bob]) await c.context.close();
});
