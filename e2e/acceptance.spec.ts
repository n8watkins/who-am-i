// PRD section 16 acceptance scenario, end to end against `wrangler dev`, with two separate
// browser contexts (two "phones"), plus a capture of everything each browser receives to
// prove neither player's own identity reaches them before the round summary.
import { expect, test } from "@playwright/test";
import { packIdentities } from "../src/worker/content";
import { assertHintsOnlyAfterRequest, assertNoLeakBeforeReveal, createGame, joinGame, newPlayer, startMatch, scoreOf } from "./support";

const ACTOR_NAMES = new Set(packIdentities("actors").map((i) => i.canonicalName));

test("two players complete an Actors match without seeing their own identities, then rematch", async ({ browser }) => {
  const alice = await newPlayer(browser, { mobile: true });
  const bob = await newPlayer(browser, { mobile: true });
  const A = alice.page;
  const B = bob.page;

  // A creates an Actors game; B joins from their own "phone" via the invite link.
  const { code, link } = await createGame(A, { nickname: "Alice", pack: "actors" });
  expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  await B.goto(link);
  await expect(B.getByRole("heading", { name: "Join Alice's game" })).toBeVisible();
  await expect(B.getByText("Actors", { exact: true })).toBeVisible();
  await joinGame(B, link, "Bob");
  await expect(A.getByTestId("slot-B")).toContainText("Bob");
  await expect(A.getByTestId("first-player")).toContainText("You go first");
  await expect(B.getByTestId("first-player")).toContainText("Alice goes first");

  // A starts.
  await startMatch(A, B);

  const seenIdentities = new Set<string>();
  const totalChecked = { alice: 0, bob: 0 };
  const hintMarks: number[] = [];
  const POINTS_TO_WIN = 5;

  for (let round = 1; round <= POINTS_TO_WIN; round++) {
    await expect(A.getByRole("heading", { name: `Round ${round}` })).toBeVisible();
    await expect(B.getByRole("heading", { name: `Round ${round}` })).toBeVisible();

    // The server assigned A and B different actors. Each sees the other's, and never their own.
    const aSees = (await A.getByTestId("opponent-identity").textContent())!.trim();
    const bSees = (await B.getByTestId("opponent-identity").textContent())!.trim();
    expect(aSees).not.toBe(bSees);
    expect(ACTOR_NAMES.has(aSees), `${aSees} is an actor`).toBe(true);
    expect(ACTOR_NAMES.has(bSees), `${bSees} is an actor`).toBe(true);
    // Two new, unused actors every round.
    expect(seenIdentities.has(aSees)).toBe(false);
    expect(seenIdentities.has(bSees)).toBe(false);
    seenIdentities.add(aSees);
    seenIdentities.add(bSees);

    // The first guesser alternates: Alice starts odd rounds (host chose "Me"), Bob even rounds.
    const aliceFirst = round % 2 === 1;
    await expect(A.getByTestId("round-starter")).toHaveText(aliceFirst ? "You go first this round." : "Bob goes first this round.");
    await expect(B.getByTestId("round-starter")).toHaveText(aliceFirst ? "Alice goes first this round." : "You go first this round.");

    const aliceTurn = async () => {
      await expect(A.getByTestId("turn-headline")).toHaveText("Your turn to guess");
      await expect(B.getByTestId("turn-headline")).toHaveText("Alice is guessing");
      // Snapshot the rendered page and localStorage mid-round for the leak check.
      await alice.capture.snapshot(`round ${round} Alice turn`);
      await bob.capture.snapshot(`round ${round} Alice turn`);
      // Round 1: Alice asks for two hints. Each appears on both phones only after she asks.
      if (round === 1) {
        for (let k = 1; k <= 2; k++) {
          hintMarks.push(alice.capture.mark());
          await A.getByRole("button", { name: "Get a hint" }).click();
          await expect(A.getByTestId("log-hint")).toHaveCount(k);
          await expect(B.getByTestId("log-hint")).toHaveCount(k);
        }
        await expect(A.getByRole("button", { name: "Get a hint, 1 of 3 left" })).toBeVisible();
      }
      // Round 1: Alice also asks an in-app question and Bob answers it on his phone.
      if (round === 1) {
        await A.getByRole("button", { name: "Am I a real person?" }).click();
        await expect(B.getByTestId("pending-question")).toHaveText("Am I a real person?");
        await B.getByRole("button", { name: "Yes", exact: true }).click();
        await expect(A.getByTestId("log-question")).toContainText("Yes");
      }
      // B counts a spoken question (Ask), A guesses correctly, B confirms (double-clicked on purpose).
      await B.getByRole("button", { name: "Count one more question" }).click();
      await expect(A.getByTestId("question-count")).toHaveText(round === 1 ? "2" : "1");
      await A.getByRole("button", { name: "I Guessed It" }).click();
      await expect(A.getByText("Waiting for Bob to confirm your guess...")).toBeVisible();
      await expect(B.getByText(`Did they say ${bSees}?`)).toBeVisible();
      await B.getByRole("button", { name: "Yes, correct" }).dblclick();
      // A's score increases exactly once, on both devices.
      await expect.poll(() => scoreOf(A, "A")).toBe(String(round));
      await expect.poll(() => scoreOf(B, "A")).toBe(String(round));
    };
    const bobTurn = async () => {
      await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");
      await expect(A.getByTestId("turn-headline")).toHaveText("Bob is guessing");
      await alice.capture.snapshot(`round ${round} Bob turn`);
      await bob.capture.snapshot(`round ${round} Bob turn`);
      // B takes their turn and skips.
      await B.getByRole("button", { name: "Skip" }).click();
    };
    if (aliceFirst) {
      await aliceTurn();
      await bobTurn();
    } else {
      await bobTurn();
      await aliceTurn();
    }

    // Both see the round summary revealing both identities.
    await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
    await expect(B.getByRole("heading", { name: "The big reveal" })).toBeVisible();
    await expect(A.getByTestId("reveal-self")).toHaveText(bSees);
    await expect(A.getByTestId("reveal-opponent")).toHaveText(aSees);
    await expect(B.getByTestId("reveal-self")).toHaveText(aSees);
    await expect(B.getByTestId("reveal-opponent")).toHaveText(bSees);
    expect(await scoreOf(A, "A")).toBe(String(round));
    expect(await scoreOf(A, "B")).toBe("0");

    // Neither player's own identity reached their browser before this reveal.
    totalChecked.alice += await assertNoLeakBeforeReveal(alice.capture, round, 0);
    totalChecked.bob += await assertNoLeakBeforeReveal(bob.capture, round, 0);
    if (round === 1) {
      await expect(A.getByTestId("hints-self")).toHaveText("2 hints used");
      await expect(B.getByTestId("hints-opponent")).toHaveText("2 hints used");
      // Hints 1 and 2 only after Alice asked; hint 3 (never asked) not at all. Bob's own hints never.
      expect(await assertHintsOnlyAfterRequest(alice.capture, 1, 0, hintMarks)).toBeGreaterThan(0);
      expect(await assertHintsOnlyAfterRequest(bob.capture, 1, 0, [])).toBeGreaterThan(0);
    }

    if (round < POINTS_TO_WIN) {
      await A.getByRole("button", { name: "Next round" }).click();
    } else {
      await B.getByRole("button", { name: "See final results" }).click();
    }
  }

  // After the configured match length the app announces a winner on both devices.
  await expect(A.getByTestId("match-headline")).toHaveText("You win!");
  await expect(B.getByTestId("match-headline")).toHaveText("Alice wins!");
  await expect(B.getByText("5 rounds played in Actors.")).toBeVisible();

  // Positive control: Bob's browser did receive Alice's identities (he was meant to see them).
  await bob.capture.settle();
  const bobReceived = bob.capture.items.map((i) => i.text).join("\n");
  const aliceRevealOne = alice.capture.revealOf(1)!;
  const aliceOwnRoundOne = JSON.parse(aliceRevealOne.text).view.roundSummary.entries.find(
    (e: { playerId: string }) => e.playerId === JSON.parse(aliceRevealOne.text).view.youId,
  ).identity.canonicalName as string;
  expect(bobReceived).toContain(aliceOwnRoundOne);

  // One-tap rematch in the same room: both tap Rematch and the next match starts directly.
  const rematchStart = { alice: alice.capture.mark(), bob: bob.capture.mark() };
  await expect(A.getByTestId("rematch-starter")).toContainText("Bob goes first (loser starts).");
  await A.getByRole("button", { name: "Rematch" }).click();
  await expect(A.getByRole("button", { name: "Waiting for Bob..." })).toBeDisabled();
  await expect(B.getByText("Alice wants a rematch.")).toBeVisible();
  await B.getByRole("button", { name: "Accept rematch" }).click();
  await expect(A.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(B.getByRole("heading", { name: "Round 1" })).toBeVisible();
  // The loser of the previous match guesses first.
  await expect(B.getByTestId("round-starter")).toHaveText("You go first this round.");
  await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");
  expect(await scoreOf(A, "A")).toBe("0");
  expect(await scoreOf(B, "B")).toBe("0");
  await alice.capture.snapshot("rematch round 1");
  await bob.capture.snapshot("rematch round 1");
  await B.getByRole("button", { name: "Skip" }).click();
  await A.getByRole("button", { name: "Skip" }).click();
  await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  await expect(B.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  totalChecked.alice += await assertNoLeakBeforeReveal(alice.capture, 1, rematchStart.alice);
  totalChecked.bob += await assertNoLeakBeforeReveal(bob.capture, 1, rematchStart.bob);

  // Sanity: the leak check covered a meaningful amount of traffic, including WebSocket frames.
  expect(totalChecked.alice).toBeGreaterThan(50);
  expect(totalChecked.bob).toBeGreaterThan(50);
  expect(alice.capture.items.some((i) => i.kind === "ws")).toBe(true);
  test.info().annotations.push({
    type: "secrecy",
    description: `Checked ${totalChecked.alice} items for Alice and ${totalChecked.bob} for Bob across 6 rounds; no own-identity leaks.`,
  });

  await alice.context.close();
  await bob.context.close();
});
