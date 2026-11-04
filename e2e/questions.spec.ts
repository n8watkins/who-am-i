// In-app yes/no questions: suggested and typed questions, answers on the other phone, the
// shared log, the question counter, and the room's Questions setting.
import { expect, test } from "@playwright/test";
import { createGame, joinGame, newPlayer, readyAndStart } from "./support";

test("the guesser asks in the app and the opponent answers on their phone", async ({ browser }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  const A = alice.page;
  const B = bob.page;
  const { link } = await createGame(A, { nickname: "Alice" });
  await joinGame(B, link, "Bob");
  await readyAndStart(A, B);

  // A suggested question.
  await expect(A.getByRole("group", { name: "Suggested questions" }).getByRole("button")).toHaveCount(8);
  await A.getByRole("button", { name: "Am I alive today?" }).click();
  await expect(A.getByText("Waiting for Bob to answer...")).toBeVisible();
  await expect(B.getByTestId("pending-question")).toHaveText("Am I alive today?");
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

  // Sent questions count toward 20 Questions; the manual +1 still works for spoken ones.
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

  await alice.page.getByRole("button", { name: "Change" }).click();
  await alice.page.getByRole("radio", { name: "Spoken", exact: true }).check();
  await alice.page.getByRole("button", { name: "Save settings" }).click();
  await readyAndStart(alice.page, bob.page);
  await expect(alice.page.getByText("Ask in the app")).toHaveCount(0);
  await expect(bob.page.getByRole("button", { name: "Count one more question" })).toBeVisible();
  await alice.page.getByRole("button", { name: "Skip" }).click();
  await bob.page.getByRole("button", { name: "Skip" }).click();
  await alice.page.getByRole("button", { name: "Next round" }).click();
  await alice.page.getByRole("button", { name: "Leave room" }).first().click();
  await alice.page.getByRole("dialog").getByRole("button", { name: "Leave room" }).click();
  await expect(bob.page.getByText("Your opponent left.")).toBeVisible();
  for (const c of [alice, bob]) await c.context.close();
});
