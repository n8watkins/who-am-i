import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // Tests never read .dev.vars; they use a fixed, obviously fake secret.
              bindings: { SESSION_SECRET: "test-only-secret-not-for-production", TEST_MIGRATIONS: migrations },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["test/**/*.test.ts"],
          exclude: ["test/party/**", "test/party-room/**"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        // The party adapter runs in plain Node, with no Workers runtime: that is the point of it.
        test: { name: "node", include: ["test/party/**/*.test.ts"], environment: "node" },
      },
      {
        // The room game in the party room's real room class, from n8watkins/n8-party-games at a
        // pinned commit (fetched once into .cache/ by the global setup; needs git and the network).
        test: {
          name: "party-room",
          include: ["test/party-room/**/*.test.ts"],
          environment: "node",
          globalSetup: ["./scripts/party-room-checkout.mjs"],
        },
      },
    ],
  },
});
