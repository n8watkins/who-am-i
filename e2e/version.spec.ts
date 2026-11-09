// The footer's "What's new" link and /api/version agree on which build is running.
import { expect, test } from "@playwright/test";
import pkg from "../package.json" with { type: "json" };
import { newPlayer } from "./support";

test("the footer links to the changelog with the running version, and /api/version reports it", async ({ browser, baseURL }) => {
  const { page, context } = await newPlayer(browser, { mobile: true });
  await page.goto("/");
  const link = page.getByTestId("whats-new");
  await expect(link).toHaveText(`What's new · v${pkg.version}`);
  await expect(link).toHaveAttribute("href", "https://github.com/n8watkins/who-am-i/blob/main/CHANGELOG.md");
  await expect(link).toHaveAttribute("target", "_blank");
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);

  const res = await page.request.get(`${baseURL}/api/version`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, name: "who-am-i", version: pkg.version });
  expect(body.commit).toMatch(/^(dev|[0-9a-f]{7,40})$/);
  if (process.env.COMFORT_SHOTS) await page.screenshot({ path: `${process.env.COMFORT_SHOTS}/footer-landing-390.png`, fullPage: true });
  await context.close();
});
