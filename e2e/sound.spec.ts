// Sound and haptics on phones: cues for your turn, a correct guess and the match end, silent until
// the first tap, a mute switch each device remembers, and no vibration with "reduce motion".
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

interface Played {
  cue: string;
  sound: boolean;
  haptic: boolean;
}

declare global {
  interface Window {
    __cues: Played[];
    __vibrations: number;
    __audioContexts: number;
  }
}

/** Records every cue the kit plays, every vibration, and every AudioContext created. */
async function recordFeedback(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.__cues = [];
    window.__vibrations = 0;
    window.__audioContexts = 0;
    window.addEventListener("kit:feedback", (e) => window.__cues.push((e as CustomEvent<Played>).detail));
    Object.defineProperty(Navigator.prototype, "vibrate", {
      configurable: true,
      value: () => {
        window.__vibrations++;
        return true;
      },
    });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__audioContexts++;
      }
    };
  });
}

const cues = (page: Page) => page.evaluate(() => window.__cues);
const lastCue = async (page: Page) => (await cues(page)).at(-1);

async function twoPhones(browser: import("@playwright/test").Browser, guestOptions: { reducedMotion?: "reduce" } = {}) {
  const host = await newPlayer(browser, { mobile: true });
  const guest = await newPlayer(browser, { mobile: true });
  if (guestOptions.reducedMotion) await guest.page.emulateMedia({ reducedMotion: "reduce" });
  await recordFeedback(host.context);
  await recordFeedback(guest.context);
  return { host, guest };
}

test("your turn and a correct guess play a sound and a buzz, but only after the first tap", async ({ browser }) => {
  const { host, guest } = await twoPhones(browser);
  const { link } = await createGame(host.page, { nickname: "Alice", turns: "Trade turns" });
  await joinGame(guest.page, link, "Bob");

  // Bob reloads: a fresh page that nobody has touched yet.
  await guest.page.reload();
  await expect(guest.page.getByTestId("slot-B")).toContainText("Bob");
  await startMatch(host.page, guest.page);
  // Alice tapped Start: her turn cue plays with sound and vibration.
  await expect.poll(() => lastCue(host.page)).toEqual({ cue: "attention", sound: true, haptic: true });

  // Alice passes: Bob is called, but his untouched page stays silent and makes no AudioContext.
  await host.page.getByRole("button", { name: "Pass" }).click();
  await expect.poll(() => lastCue(guest.page)).toEqual({ cue: "attention", sound: false, haptic: false });
  expect(await guest.page.evaluate(() => [window.__audioContexts, window.__vibrations])).toEqual([0, 0]);

  // After his first tap, cues are heard and felt.
  await guest.page.getByRole("button", { name: "Pass" }).click();
  expect(await guest.page.evaluate(() => window.__audioContexts)).toBe(1);
  await host.page.getByRole("button", { name: "I Guessed It" }).click();
  await expect.poll(() => lastCue(guest.page)).toEqual({ cue: "attention", sound: true, haptic: true });
  await guest.page.getByRole("button", { name: /correct/i }).first().click();
  await expect.poll(() => lastCue(guest.page)).toEqual({ cue: "success", sound: true, haptic: true });
  await expect.poll(() => lastCue(host.page)).toEqual({ cue: "success", sound: true, haptic: true });

  await host.context.close();
  await guest.context.close();
});

test("the mute switch silences sound and vibration, and the phone remembers it", async ({ browser }) => {
  const { host, guest } = await twoPhones(browser);
  const { link } = await createGame(host.page, { nickname: "Alice", turns: "Trade turns" });
  await joinGame(guest.page, link, "Bob");

  const toggle = guest.page.getByTestId("sound-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  if (process.env.COMFORT_SHOTS) await guest.page.screenshot({ path: `${process.env.COMFORT_SHOTS}/sound-muted-lobby-390.png` });
  await guest.page.reload();
  await expect(guest.page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
  await guest.page.getByTestId("sound-toggle").focus();
  await guest.page.keyboard.press("Shift"); // a first gesture that changes nothing

  await startMatch(host.page, guest.page);
  await host.page.getByRole("button", { name: "Pass" }).click();
  await expect.poll(() => lastCue(guest.page)).toEqual({ cue: "attention", sound: false, haptic: false });
  expect(await guest.page.evaluate(() => window.__vibrations)).toBe(0);
  // Alice never muted, so her phone still plays.
  expect((await cues(host.page)).at(0)).toEqual({ cue: "attention", sound: true, haptic: true });

  await host.context.close();
  await guest.context.close();
});

test("with reduce motion, cues still sound but never vibrate", async ({ browser }) => {
  const { host, guest } = await twoPhones(browser, { reducedMotion: "reduce" });
  const { link } = await createGame(host.page, { nickname: "Alice", turns: "Trade turns" });
  await joinGame(guest.page, link, "Bob");
  await startMatch(host.page, guest.page);
  await host.page.getByRole("button", { name: "Pass" }).click();
  await expect.poll(() => lastCue(guest.page)).toEqual({ cue: "attention", sound: true, haptic: false });
  expect(await guest.page.evaluate(() => window.__vibrations)).toBe(0);
  await host.context.close();
  await guest.context.close();
});
