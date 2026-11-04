import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;

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
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The client is built by `npm run e2e` before this starts. A fresh state dir per run keeps
    // rate-limit windows and rooms from earlier runs out of the way.
    command: `rm -rf .wrangler/e2e-state && exec node_modules/.bin/wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to .wrangler/e2e-state --var SESSION_SECRET:e2e-only-secret-not-for-production`,
    url: `http://127.0.0.1:${PORT}/api/packs`,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "ignore",
    stderr: "pipe",
  },
});
