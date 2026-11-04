// Captures every screen at desktop (1280x800) and mobile (390x844) for design review.
// Run with SCREENSHOTS=1 npm run e2e -- screenshots; skipped otherwise.
import { expect, test, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer } from "./support";

const OUT = "docs/screenshots";

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to regenerate docs/screenshots");

for (const device of ["desktop", "mobile"] as const) {
  test(`screens on ${device}`, async ({ browser }) => {
    const mobile = device === "mobile";
    const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${device}-${name}.png`, fullPage: true, animations: "disabled" });
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

    const { link } = await createGame(A, { nickname: "Alice", pack: "actors" });
    await shot(A, "03-lobby-host-waiting");

    await B.goto(link);
    await expect(B.getByRole("heading", { name: "Join Alice's game" })).toBeVisible();
    await B.getByLabel("Your nickname").fill("Bob");
    await shot(B, "04-join");
    await joinGame(B, link, "Bob");
    await A.getByRole("button", { name: "I'm ready" }).click();
    await expect(B.getByTestId("slot-A")).toContainText("Ready");
    await shot(A, "05-lobby-host");
    await shot(B, "06-lobby-guest");

    await B.getByRole("button", { name: "I'm ready" }).click();
    await A.getByRole("button", { name: "Start game" }).click();
    await expect(A.getByTestId("opponent-identity")).not.toBeEmpty();
    await expect(B.getByTestId("opponent-identity")).not.toBeEmpty();
    await shot(A, "07-game-alice-guessing");
    await shot(B, "08-game-bob-answering");

    await A.getByRole("button", { name: "I Guessed It" }).click();
    await expect(B.getByRole("button", { name: "Yes, correct" })).toBeVisible();
    await shot(B, "09-game-bob-confirm");
    await B.getByRole("button", { name: "Yes, correct" }).click();
    await expect(B.getByTestId("turn-headline")).toHaveText("Your turn to guess");
    await shot(B, "10-game-bob-guessing");
    await B.getByRole("button", { name: "Skip" }).click();
    await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
    await shot(A, "11-round-summary-alice");
    await shot(B, "12-round-summary-bob");

    for (let round = 2; round <= 5; round++) {
      await A.getByRole("button", { name: "Next round" }).click();
      await A.getByRole("button", { name: "I Guessed It" }).click();
      await B.getByRole("button", { name: "Yes, correct" }).click();
      await B.getByRole("button", { name: "Skip" }).click();
      await expect(A.getByRole("heading", { name: "The big reveal" })).toBeVisible();
    }
    await A.getByRole("button", { name: "See final results" }).click();
    await expect(A.getByTestId("match-headline")).toBeVisible();
    await expect(B.getByTestId("match-headline")).toBeVisible();
    await shot(A, "13-match-summary-alice");
    await shot(B, "14-match-summary-bob");

    await alice.context.close();
    await bob.context.close();
  });
}
