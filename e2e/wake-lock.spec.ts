// Screen wake lock on phones: held for the whole room, re-taken after the phone is unlocked,
// released on leaving, and harmless where the API is missing or refused.
import { expect, test } from "@playwright/test";
import { installPhoneMocks, setVisibility, wakeLockStats } from "./phone";
import { createGame, joinGame, newPlayer, startMatch } from "./support";

test("the screen stays on during a game and the lock comes back after the phone is unlocked", async ({ browser }) => {
  const host = await newPlayer(browser, { mobile: true });
  const guest = await newPlayer(browser, { mobile: true });
  await installPhoneMocks(host.context);

  // Not in a room yet: nothing is requested.
  await host.page.goto("/");
  expect((await wakeLockStats(host.page)).requests).toBe(0);

  const { link } = await createGame(host.page, { nickname: "Alice" });
  await expect.poll(async () => (await wakeLockStats(host.page)).held).toBe(1);

  await joinGame(guest.page, link, "Bob");
  await startMatch(host.page, guest.page);
  // Still exactly one lock through the lobby-to-game switch.
  expect(await wakeLockStats(host.page)).toMatchObject({ held: 1, requests: 1 });

  // Locking the phone releases the lock (the browser does that); unlocking takes it again.
  await setVisibility(host.page, "hidden");
  await expect.poll(async () => (await wakeLockStats(host.page)).held).toBe(0);
  await setVisibility(host.page, "visible");
  await expect.poll(async () => (await wakeLockStats(host.page)).held).toBe(1);
  expect((await wakeLockStats(host.page)).requests).toBe(2);

  // Leaving the room lets the screen sleep again.
  await host.page.getByRole("button", { name: "Leave room" }).click();
  await host.page.getByRole("button", { name: "Leave room" }).last().click();
  await expect(host.page.getByRole("button", { name: "Create game" })).toBeVisible();
  await expect.poll(async () => (await wakeLockStats(host.page)).held).toBe(0);

  await host.context.close();
  await guest.context.close();
});

for (const mode of [{ supported: false }, { refuse: true }] as const) {
  const label = "supported" in mode ? "without the Wake Lock API" : "when the browser refuses the lock";
  test(`the game works normally ${label}`, async ({ browser }) => {
    const host = await newPlayer(browser, { mobile: true });
    await installPhoneMocks(host.context, mode);
    const errors: string[] = [];
    host.page.on("pageerror", (err) => errors.push(err.message));
    await createGame(host.page, { nickname: "Alice" });
    await setVisibility(host.page, "hidden");
    await setVisibility(host.page, "visible");
    await expect(host.page.getByTestId("room-code")).toBeVisible();
    expect(errors).toEqual([]);
    await host.context.close();
  });
}
