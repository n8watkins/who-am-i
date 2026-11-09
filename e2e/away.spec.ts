// Away state on phones: when a player's phone locks or they switch apps, the other phone says so,
// the turn timer pauses, and everything clears by itself when they come back.
import { expect, test } from "@playwright/test";
import { installPhoneMocks, setVisibility } from "./phone";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

const SHOTS = process.env.COMFORT_SHOTS;

test("a locked phone shows as away, pauses the timer, and clears on return", async ({ browser }) => {
  const host = await newPlayer(browser, { mobile: true });
  const guest = await newPlayer(browser, { mobile: true });
  await installPhoneMocks(guest.context);
  const { link } = await createGame(host.page, { nickname: "Alice", timer: "60 s" });
  await joinGame(guest.page, link, "Bob");

  // In the lobby, the seat list shows it.
  await setVisibility(guest.page, "hidden");
  await expect(host.page.getByTestId("presence-B")).toHaveText("Away");
  await setVisibility(guest.page, "visible");
  await expect(host.page.getByTestId("presence-B")).toHaveCount(0);

  await startMatch(host.page, guest.page);
  const timer = host.page.getByTestId("turn-timer");
  await expect(timer).toHaveAttribute("aria-label", /seconds left/);

  // Bob's phone locks during Alice's turn.
  await setVisibility(guest.page, "hidden");
  const banner = host.page.getByTestId("opponent-presence");
  await expect(banner).toHaveText("Bob stepped away: their phone is locked or in another app. The timer is paused until they are back.");
  await expect(timer).toHaveAttribute("aria-label", /Timer paused/);
  if (SHOTS) await host.page.screenshot({ path: `${SHOTS}/away-banner-390.png` });

  // Bob unlocks: the banner goes and the clock runs again, with no tap needed.
  await setVisibility(guest.page, "visible");
  await expect(banner).toHaveCount(0);
  await expect(timer).toHaveAttribute("aria-label", /seconds left/);

  // A dropped connection is still told apart from being away.
  await guest.page.close();
  await expect(banner).toContainText("Bob lost connection.");

  await host.context.close();
  await guest.context.close();
});

test("a phone that was hidden while its connection dropped reports away again after reconnecting", async ({ browser }) => {
  const host = await newPlayer(browser, { mobile: true });
  const guest = await newPlayer(browser, { mobile: true });
  await installPhoneMocks(guest.context);
  const { link } = await createGame(host.page, { nickname: "Alice" });
  await joinGame(guest.page, link, "Bob");
  await setVisibility(guest.page, "hidden");
  await expect(host.page.getByTestId("presence-B")).toHaveText("Away");

  // A reload starts a new socket while the page is still hidden.
  await guest.page.reload();
  await expect(host.page.getByTestId("presence-B")).toHaveText("Away");
  await setVisibility(guest.page, "visible");
  await expect(host.page.getByTestId("presence-B")).toHaveCount(0);

  await host.context.close();
  await guest.context.close();
});
