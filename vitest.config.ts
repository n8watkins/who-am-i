import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Tests never read .dev.vars; they use a fixed, obviously fake secret.
        bindings: { SESSION_SECRET: "test-only-secret-not-for-production" },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
