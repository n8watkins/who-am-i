import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".wrangler", "node_modules", "test-results", "playwright-report", "src/worker/worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The client must never import server-only identity content.
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/worker/**"], message: "Client code must not import Worker modules (identity content is server-only)." }] }],
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
