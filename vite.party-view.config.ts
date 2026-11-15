import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Builds the room view a party room shows (src/party-view) into party-view/, which is committed:
// a party site serves the package's files as they are and runs no build of a game's (the party
// kit's GAME-CONTRACT.md). `npm run check:party-view` rebuilds it and fails when the committed
// copy differs. `PARTY_VIEW_OUT` builds somewhere else, for that check.
const root = fileURLToPath(new URL("./src/party-view/", import.meta.url));
const out = process.env.PARTY_VIEW_OUT ?? fileURLToPath(new URL("./party-view/", import.meta.url));

export default defineConfig({
  root,
  // Every address is relative: the page is served under a game's path on any site.
  base: "./",
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  publicDir: "public",
  build: {
    outDir: out,
    emptyOutDir: true,
    // No inline script: the party site's Content-Security-Policy allows only its own files.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    reportCompressedSize: false,
  },
});
