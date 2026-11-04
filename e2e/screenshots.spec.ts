// Captures every screen at desktop (1280x800) and mobile (390x844) for design review.
// Run with SCREENSHOTS=1 npx playwright test screenshots (after vite build); skipped otherwise.
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer } from "./support";

const OUT = "docs/screenshots";

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to regenerate docs/screenshots");

/** Plays one round where Alice guesses correctly and Bob skips, in whichever order the server chose. */
async function playRound(A: Page, B: Page) {
  await expect(A.getByTestId("turn-headline")).not.toBeEmpty();
  const aliceFirst = (await A.getByTestId("turn-headline").textContent()) === "Your turn to guess";
  const aliceTurn = async () => {
    await expect(A.getByTestId("turn-headline")).toHaveText("Your turn to guess");
    await A.getByRole("button", { name: "I Guessed It" }).click();
    await B.getByRole("button", { name: "Yes, correct" }).click();
  };
  const bobTurn = async () => {
    await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");
    await B.getByRole("button", { name: "Give up" }).click();
  };
  if (aliceFirst) {
    await aliceTurn();
    await bobTurn();
  } else {
    await bobTurn();
    await aliceTurn();
  }
  await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
}

for (const device of ["desktop", "mobile"] as const) {
  test(`screens on ${device}`, async ({ browser }) => {
    const mobile = device === "mobile";
    const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${device}-${name}.png`, fullPage: true, animations: "disabled" });
    // What a phone actually shows without scrolling (390x844), where the sticky action bar matters.
    const fold = async (page: Page, name: string) => {
      if (!mobile) return;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${OUT}/mobile-fold-${name}.png`, animations: "disabled" });
    };
    const alice = await newPlayer(browser, { mobile });
    const bob = await newPlayer(browser, { mobile });
    const A = alice.page;
    const B = bob.page;

    await A.goto("/");
    await expect(A.getByRole("button", { name: "Create game" })).toBeVisible();
    await shot(A, "01-landing");

    await A.getByRole("button", { name: "Create game" }).click();
    await A.getByLabel("Your nickname").fill("Alice");
    await A.getByTestId("pack-actors").click();
    await shot(A, "02-create-setup");

    const { link } = await createGame(A, { nickname: "Alice", pack: "actors", first: "Random" });
    await shot(A, "03-lobby-host-waiting");

    await B.goto(link);
    await expect(B.getByRole("heading", { name: "Join Alice's game" })).toBeVisible();
    await B.getByLabel("Your nickname").fill("Bob");
    await shot(B, "04-join");
    await joinGame(B, link, "Bob");

    // The host's turn-order picker in the lobby.
    await A.getByRole("button", { name: "Edit" }).click();
    await A.getByRole("radio", { name: "Me", exact: true }).check();
    await shot(A, "05-lobby-host-turn-order-picker");
    await A.getByRole("button", { name: "Save" }).click();
    await expect(B.getByTestId("first-player")).toContainText("Alice goes first");
    await shot(A, "06-lobby-host");
    await shot(B, "07-lobby-guest");

    await A.getByRole("button", { name: "Start game" }).click();
    await expect(A.getByTestId("opponent-identity")).not.toBeEmpty();
    await expect(B.getByTestId("opponent-identity")).not.toBeEmpty();
    await shot(A, "08-game-alice-guessing");
    await shot(B, "09-game-bob-answering");
    await fold(A, "08-alice-guessing-panel-open");

    // In-app question: Alice asks, Bob answers on his phone, both logs update.
    await A.getByRole("button", { name: "Am I a real person?" }).click();
    await expect(B.getByTestId("pending-question")).toBeVisible();
    await shot(A, "10-question-alice-waiting");
    await shot(B, "11-question-bob-answer-buttons");
    await fold(A, "10-alice-pending-question");
    await fold(B, "11-bob-answer-buttons");
    await B.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(A.getByTestId("log-question")).toContainText("Yes");

    // A hint, shown on both phones.
    await A.getByRole("button", { name: "Get a hint" }).click();
    await expect(B.getByTestId("log-hint")).toHaveCount(1);
    await shot(A, "12-hint-and-log-alice");
    await shot(B, "13-hint-and-log-bob");
    await fold(A, "12-alice-log-filled");
    await A.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    if (mobile) await A.screenshot({ path: `${OUT}/mobile-fold-12b-alice-log-filled-scrolled.png`, animations: "disabled" });

    await A.getByRole("button", { name: "I Guessed It" }).click();
    await expect(B.getByRole("button", { name: "Yes, correct" })).toBeVisible();
    await shot(B, "14-game-bob-confirm");
    await fold(B, "14-bob-confirm");
    await B.getByRole("button", { name: "Yes, correct" }).click();
    await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");
    await shot(B, "15-game-bob-guessing");
    await B.getByRole("button", { name: "Give up" }).click();
    await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
    await shot(A, "16-round-summary-alice");
    await shot(B, "17-round-summary-bob");

    for (let round = 2; round <= 5; round++) {
      await A.getByRole("button", { name: "Next round" }).click();
      await expect(A.getByRole("heading", { name: `Round ${round}` })).toBeVisible();
      if (round === 2) await shot(A, "18-round-2-bob-goes-first");
      await playRound(A, B);
    }
    await A.getByRole("button", { name: "See final results" }).click();
    await expect(A.getByTestId("match-headline")).toBeVisible();
    await expect(B.getByTestId("match-headline")).toBeVisible();
    await shot(A, "19-match-summary-alice");

    // One-tap rematch: Alice asks, Bob sees the request and accepts, and the next match starts.
    await A.getByRole("button", { name: "Rematch" }).click();
    await expect(B.getByText("Alice wants a rematch.")).toBeVisible();
    await shot(A, "20-rematch-alice-waiting");
    await shot(B, "21-rematch-bob-accept");
    await B.getByRole("button", { name: "Accept rematch" }).click();
    await expect(B.getByTestId("round-starter")).toHaveText("You go first this round.");
    await shot(B, "22-rematch-started-loser-first");

    await alice.context.close();
    await bob.context.close();
  });
}
