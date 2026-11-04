// FR-03 and FR-09: the two-player cap, and refresh/reconnect restoring the right seat.
import { expect, test } from "@playwright/test";
import { createGame, joinGame, newPlayer, readyAndStart } from "./support";

test("refresh restores each player's own seat and a third browser cannot join", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser, { mobile: true });
  const { link, code } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");

  // Refresh in the lobby: Bob is still seat B, Alice still seat A.
  await bob.page.reload();
  await expect(bob.page.getByTestId("slot-B")).toContainText("Bob (you)");
  await alice.page.reload();
  await expect(alice.page.getByTestId("slot-A")).toContainText("Alice (you)");

  // A third browser sees that the room is full.
  const eve = await newPlayer(browser);
  await eve.page.goto(link);
  await expect(eve.page.getByRole("heading", { name: "This room is full" })).toBeVisible();
  const direct = await eve.page.request.post(`/api/rooms/${code}/join`, { data: { nickname: "Eve" } });
  expect(direct.status()).toBe(409);
  expect(await direct.json()).toMatchObject({ error: "room_full" });

  // Mid-game refresh keeps the seat, turn and opponent identity view intact.
  await readyAndStart(alice.page, bob.page);
  const bobSees = (await bob.page.getByTestId("opponent-identity").textContent())!.trim();
  await bob.page.reload();
  await expect(bob.page.getByTestId("turn-headline")).toHaveText("Alice is guessing");
  await expect(bob.page.getByTestId("opponent-identity")).toHaveText(bobSees);
  await expect(bob.page.getByTestId("own-identity")).toHaveText("Hidden");

  // Disconnect: Bob's phone goes away; Alice sees it. Bob comes back in a new tab and resumes as B.
  await bob.page.close();
  await expect(alice.page.getByText("Bob lost connection.")).toBeVisible();
  const bobAgain = await bob.context.newPage();
  await bobAgain.goto(`/r/${code}`);
  await expect(bobAgain.getByTestId("turn-headline")).toHaveText("Alice is guessing");
  await expect(bobAgain.getByTestId("opponent-identity")).toHaveText(bobSees);
  await expect(alice.page.getByText("Bob lost connection.")).toBeHidden();

  // The game continues from the restored seat: Alice guesses, Bob confirms.
  await alice.page.getByRole("button", { name: "I Guessed It" }).click();
  await bobAgain.getByRole("button", { name: "Yes, correct" }).click();
  await expect(bobAgain.getByTestId("turn-headline")).toHaveText("Your turn to guess");

  for (const c of [alice, bob, eve]) await c.context.close();
});

test("unknown room codes show a friendly error", async ({ page }) => {
  await page.goto("/r/ZZZZZZ");
  await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
  await page.goto("/join");
  await page.getByLabel("Room code").fill("abc");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Room codes are 6 letters and numbers.")).toBeVisible();
});

test("a timed turn ends when the timer runs out", async ({ browser }) => {
  test.slow();
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const { link } = await createGame(alice.page, { nickname: "Alice", timer: "60 s" });
  await joinGame(bob.page, link, "Bob");
  await readyAndStart(alice.page, bob.page);
  await expect(alice.page.getByTestId("turn-timer")).toBeVisible();
  // Wait out the 60 s turn: the server alarm ends it exactly once and Bob's turn starts.
  await expect(bob.page.getByTestId("turn-headline")).toHaveText("Your turn to guess", { timeout: 75_000 });
  await expect(alice.page.getByText("Time ran out")).toBeVisible();
  for (const c of [alice, bob]) await c.context.close();
});
