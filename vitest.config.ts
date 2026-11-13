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
          exclude: ["test/party/**"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        // The party adapter runs in plain Node, with no Workers runtime: that is the point of it.
        test: { name: "node", include: ["test/party/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
