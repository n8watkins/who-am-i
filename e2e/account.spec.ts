// GitHub sign-in against a fake GitHub. Accounts stay optional.
import { expect, test } from "@playwright/test";
import { newPlayer } from "./support";

test.skip(!!process.env.E2E_BASE_URL, "Runs only against the local stack with its fake GitHub");

test("a player signs in, stays signed in after a reload, and signs out", async ({ browser }) => {
  const { page, context } = await newPlayer(browser);
  await page.goto("/new");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Continue without an account" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();

  // Back on the page they started from.
  await expect(page).toHaveURL(/\/new$/);
  const menu = page.getByRole("button", { name: "Account menu for Alice Dev" });
  await expect(menu).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "whoami_account")?.httpOnly).toBe(true);

  await page.reload();
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("menu")).toContainText("@alice-dev");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(menu).toBeFocused();

  await menu.click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await context.close();
});
