// FR-03 and FR-09: the two-player cap, and refresh/reconnect restoring the right seat.
import { expect, test } from "@playwright/test";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

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
  await startMatch(alice.page, bob.page);
  const bobSees = (await bob.page.getByTestId("opponent-identity").textContent())!.trim();
  await bob.page.reload();
  await expect(bob.page.getByTestId("turn-headline")).toHaveText("Alice is guessing");
  await expect(bob.page.getByTestId("opponent-identity")).toHaveText(bobSees);

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
  await page.getByLabel("PIN or room code").fill("abc");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter the 4-digit PIN or the 6-character room code.")).toBeVisible();
});

test("a timed turn ends when the timer runs out", async ({ browser }) => {
  test.slow();
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const { link } = await createGame(alice.page, { nickname: "Alice", timer: "60 s" });
  await joinGame(bob.page, link, "Bob");
  await startMatch(alice.page, bob.page);
  await expect(alice.page.getByTestId("turn-timer")).toBeVisible();
  // Wait out the 60 s turn: the server alarm ends it exactly once and Bob's turn starts.
  await expect(bob.page.getByTestId("turn-headline")).toHaveText("Your turn to guess", { timeout: 75_000 });
  await expect(alice.page.getByText("Time ran out")).toBeVisible();
  for (const c of [alice, bob]) await c.context.close();
});

test("the host can let the opponent go first from the lobby", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const { link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");
  await alice.page.getByRole("button", { name: "Edit" }).click();
  await alice.page.getByRole("radio", { name: "My opponent", exact: true }).check();
  await alice.page.getByRole("button", { name: "Save" }).click();
  await expect(alice.page.getByTestId("first-player")).toContainText("Bob goes first");
  await expect(bob.page.getByTestId("first-player")).toContainText("You go first");
  await startMatch(alice.page, bob.page);
  await expect(bob.page.getByTestId("turn-headline")).toHaveText("Your turn to guess");
  await expect(alice.page.getByTestId("round-starter")).toHaveText("Bob goes first this round.");
  for (const c of [alice, bob]) await c.context.close();
});

test("leaving right after another tap still leaves on a slow connection", async ({ browser }) => {
  const alice = await newPlayer(browser);
  const bob = await newPlayer(browser);
  const { link } = await createGame(alice.page, { nickname: "Alice" });
  await joinGame(bob.page, link, "Bob");
  await startMatch(alice.page, bob.page);
  // Alice's phone is slow: each command takes 500 ms to reach the server.
  await alice.page.route("**/commands", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  // She skips and immediately leaves, before the skip's response has arrived.
  await alice.page.getByRole("button", { name: "Give up" }).click();
  await alice.page.getByRole("button", { name: "Leave room" }).first().click();
  await alice.page.getByRole("dialog").getByRole("button", { name: "Leave room" }).click();
  await expect(bob.page.getByText("Your opponent left.")).toBeVisible();
  await expect(alice.page.getByRole("button", { name: "Create game" })).toBeVisible();
  for (const c of [alice, bob]) await c.context.close();
});
