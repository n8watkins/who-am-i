import { defineConfig, devices } from "@playwright/test";

/** Set E2E_PORT to run the local stack on another port, for example beside a second checkout. */
const PORT = Number(process.env.E2E_PORT ?? 8788);
/** Set E2E_BASE_URL to run against a deployed Worker instead of a local `wrangler dev`. */
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: REMOTE ?? `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: REMOTE
    ? undefined
    : {
        // The client is built by `npm run e2e` before this starts. A fresh state dir per run keeps
        // rate-limit windows and rooms from earlier runs out of the way.
        command: `rm -rf .wrangler/e2e-state && node_modules/.bin/wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e-state && exec node_modules/.bin/wrangler dev --port ${PORT} --ip 127.0.0.1 --local-upstream 127.0.0.1:${PORT} --upstream-protocol http --persist-to .wrangler/e2e-state --var SESSION_SECRET:e2e-only-secret-not-for-production`,
        url: `http://127.0.0.1:${PORT}/api/packs`,
        reuseExistingServer: false,
        timeout: 60_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
        stdout: "ignore",
        stderr: "pipe",
      },
});
