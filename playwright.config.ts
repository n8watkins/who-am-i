import { defineConfig, devices } from "@playwright/test";

/** Set E2E_PORT to run the local stack on another port, for example beside a second checkout. */
const PORT = Number(process.env.E2E_PORT ?? 8788);
/** The forced-deal Worker (e2e/forced/worker.ts) runs on the next port. */
const FORCED_PORT = PORT + 1;
/** Set E2E_BASE_URL to run against a deployed Worker instead of a local `wrangler dev`. */
const REMOTE = process.env.E2E_BASE_URL;

/**
 * One local `wrangler dev`. The client is built by `npm run e2e` before this starts. A fresh state
 * dir per run keeps rate-limit windows and rooms from earlier runs out of the way. `entry`
 * replaces the Worker's main module (the forced-deal Worker); everything else is wrangler.jsonc.
 */
function localServer(port: number, stateDir: string, entry = "") {
  return {
    command: `rm -rf ${stateDir} && node_modules/.bin/wrangler d1 migrations apply DB --local --persist-to ${stateDir} && exec node_modules/.bin/wrangler dev ${entry} --port ${port} --ip 127.0.0.1 --local-upstream 127.0.0.1:${port} --upstream-protocol http --persist-to ${stateDir} --var SESSION_SECRET:e2e-only-secret-not-for-production`,
    url: `http://127.0.0.1:${port}/api/packs`,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
    stdout: "ignore" as const,
    stderr: "pipe" as const,
  };
}

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
  projects: [
    { name: "chromium", testIgnore: "forced/**", use: { ...devices["Desktop Chrome"] } },
    // Deals a chosen pair through a test-only Worker, so it cannot run against a deployed one.
    ...(REMOTE
      ? []
      : [{ name: "forced-deal", testMatch: "forced/**/*.spec.ts", use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${FORCED_PORT}` } }]),
  ],
  webServer: REMOTE
    ? undefined
    : [localServer(PORT, ".wrangler/e2e-state"), localServer(FORCED_PORT, ".wrangler/e2e-forced-state", "e2e/forced/worker.ts")],
});
