import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Builds the server game a party site imports (party.ts and src/party, over the rules engine and
// the content) into party.js, one plain JavaScript module, which is committed: the party kit's
// contract asks for plain JavaScript, and the party site's own build runs in plain Node, which
// will not load TypeScript from node_modules. `npm run check:party` rebuilds it and fails when
// the committed copy differs. zod stays an import (it is one of this package's dependencies).
// `PARTY_OUT` builds somewhere else, for that check.
const out = process.env.PARTY_OUT ?? fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    target: "es2022",
    reportCompressedSize: false,
    lib: { entry: fileURLToPath(new URL("./party.ts", import.meta.url)), formats: ["es"], fileName: () => "party.js" },
    rolldownOptions: {
      external: ["zod"],
      output: { banner: "// Built by `npm run build:party` from party.ts and src/party. Do not edit: change the source and rebuild." },
    },
  },
});
