import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // .cache holds the party room's own code for the harness test; party.js and party-view are built (npm run build:party).
  { ignores: ["dist", ".wrangler", ".cache", "party.js", "party-view", "node_modules", "test-results", "playwright-report", "src/worker/worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/client/**/*.{ts,tsx}", "src/kit/client/**/*.{ts,tsx}", "public/**/*.js"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The client must never import server-only identity content.
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/worker/**"], message: "Client code must not import Worker modules (identity content is server-only)." }] }],
    },
  },
  {
    // The party kit (src/kit) is shared by every game in the collection, so it never reaches into a game's code.
    files: ["src/kit/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["../../*"], message: "The party kit is game-agnostic: it must not import a game's code." }] }],
    },
  },
  {
    files: ["src/kit/client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../../*"], message: "The party kit is game-agnostic: it must not import a game's code." },
            { group: ["**/worker/**"], message: "Client code must not import Worker modules." },
          ],
        },
      ],
    },
  },
  {
    // The party adapter (src/party) is the game's edge for the party kit: plain TypeScript over the
    // pure rules, with no Cloudflare runtime and no room, so any host (and plain Vitest) can run it.
    files: ["party.ts", "src/party/**/*.ts", "test/party/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["cloudflare:*"], message: "The party adapter must run outside the Workers runtime." },
            {
              group: ["**/worker/*", "!**/worker/engine", "!**/worker/view", "!**/worker/content"],
              message: "The party adapter wraps only the pure rules: engine, view and content.",
            },
            { group: ["**/kit/worker/**", "**/kit/client/**"], message: "The party adapter uses no host or browser code." },
          ],
        },
      ],
    },
  },
  {
    // The room view a party room shows (src/party-view): browser code like the client, built
    // from the game's own screens. It never imports the rules or the content: a phone gets an
    // identity only in its own snapshot (scripts/check-bundle.mjs checks the build too).
    files: ["src/party-view/**/*.{ts,tsx,js}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/worker/**"], message: "The room view must not import Worker modules (identity content is server-only)." },
            { group: ["**/party/*", "!**/party/snapshots", "!**/party/manifest"], message: "The room view takes only the snapshot types and the manifest from src/party." },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "e2e/**/*.ts", "*.config.{ts,js}"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
);
