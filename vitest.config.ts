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
          exclude: ["test/party/**", "test/client/**", "test/static/**"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
      {
        // The party adapter runs in plain Node, with no Workers runtime: that is the point of it.
        // Browser-only client code (test/client) runs here too, against stand-ins for the browser.
        test: { name: "node", include: ["test/party/**/*.test.ts", "test/client/**/*.test.ts", "test/static/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
