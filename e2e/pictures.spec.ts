// Identity pictures: the opponent's card shows their picture with a credit, the request for it
// says nothing about the room, a player's own picture never loads before the reveal, and a
// picture that fails to load leaves today's text card. Pictures are served by a stand-in here
// (see newPlayer), so the tests never reach Wikimedia.
import { expect, test, type BrowserContext } from "@playwright/test";
import { PICTURE_HOST } from "../src/shared/protocol";
import { assertNoLeakBeforeReveal, createGame, joinGame, newPlayer, startMatch } from "./support";

function pictureRequests(context: BrowserContext) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  context.on("request", (request) => {
    if (new URL(request.url()).host === PICTURE_HOST) seen.push({ url: request.url(), headers: request.headers() });
  });
  return seen;
}

test("the opponent's card shows their picture and credit, and your own never loads before the reveal", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser, { mobile: true });
  const hostRequests = pictureRequests(host.context);
  const guestRequests = pictureRequests(guest.context);
  const { code, link } = await createGame(host.page, { nickname: "Alice", pack: "actors" });
  await joinGame(guest.page, link, "Bob");
  const windowStart = guest.capture.mark();
  const hostStart = host.capture.mark();
  await startMatch(host.page, guest.page);

  // Alice guesses first; Bob answers as Alice's identity, shown big with its credit.
  const card = guest.page.getByTestId("identity-picture");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("src", new RegExp(`^https://${PICTURE_HOST.replace(/\./g, "\\.")}/wikipedia/`));
  await expect(card).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(card).toHaveAttribute("alt", `Picture of ${(await guest.page.getByTestId("opponent-identity").textContent())!.trim()}`);
  const credit = guest.page.getByTestId("picture-credit");
  await expect(credit).toHaveAttribute("target", "_blank");
  await expect(credit).toHaveAttribute("href", /^https:\/\/(commons\.wikimedia\.org|en\.wikipedia\.org)\/wiki\/File:/);
  // Alice sees Bob's picture small, next to his identity's name.
  await expect(host.page.getByTestId("identity-picture")).toBeVisible();

  await host.capture.snapshot("in game");
  await guest.capture.snapshot("in game");
  await host.page.getByRole("button", { name: "Give up" }).click();
  await guest.page.getByRole("button", { name: "Give up" }).click();
  await expect(guest.page.getByRole("heading", { name: "The big reveal" })).toBeVisible();
  await expect(guest.page.getByTestId("identity-picture")).toHaveCount(2);
  expect(await assertNoLeakBeforeReveal(guest.capture, 1, windowStart)).toBeGreaterThan(0);
  expect(await assertNoLeakBeforeReveal(host.capture, 1, hostStart)).toBeGreaterThan(0);

  // No picture request carries a referrer, a cookie, the room code or a nickname.
  for (const request of [...hostRequests, ...guestRequests]) {
    expect(request.headers.referer).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
    for (const secret of [code, "Alice", "Bob"]) expect(request.url).not.toContain(secret);
  }
  expect(guestRequests.length).toBeGreaterThan(0);

  await host.context.close();
  await guest.context.close();
});

test("a picture that fails to load leaves the text card", async ({ browser }) => {
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser, { mobile: true, pictures: "fail" });
  const { link } = await createGame(host.page, { nickname: "Alice", pack: "actors" });
  await joinGame(guest.page, link, "Bob");
  await startMatch(host.page, guest.page);
  await expect(guest.page.getByTestId("opponent-identity")).not.toBeEmpty();
  await expect(guest.page.getByText("Answer as")).toBeVisible();
  await expect(guest.page.getByTestId("identity-picture")).toHaveCount(0);
  await expect(guest.page.getByTestId("picture-credit")).toHaveCount(0);
  await host.context.close();
  await guest.context.close();
});

test("the Pictures note says where pictures come from and how to report one", async ({ browser }) => {
  const player = await newPlayer(browser, { mobile: true });
  await player.page.goto("/");
  await player.page.getByTestId("pictures-credits").click();
  const dialog = player.page.getByRole("dialog", { name: "Pictures" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Wikimedia Commons");
  await expect(dialog).toContainText("belong to their owners");
  await expect(dialog.getByRole("link", { name: "Report it on GitHub" })).toHaveAttribute("href", /^https:\/\/github\.com\/n8watkins\/who-am-i\/issues\/new/);
  await player.context.close();
});
