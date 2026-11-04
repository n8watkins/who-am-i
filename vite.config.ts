import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds only the browser SPA. The Worker is bundled by Wrangler (`wrangler dev` / `wrangler deploy`),
// which serves this output as static assets. Identity content lives in src/worker and is never
// imported by the client, so it cannot end up in the bundle (checked by scripts/check-bundle.mjs).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    // `npm run dev:ui` proxies the API to a running `wrangler dev` for hot reload.
    proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true } },
  },
});
