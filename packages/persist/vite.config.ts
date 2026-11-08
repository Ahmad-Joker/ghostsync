import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

/**
 * Minimal Vite harness build (REQ-BP-007, clarification 5). A plain static
 * server cannot execute the harness TypeScript with bare `@ghostsync/*` package
 * imports; Vite resolves those to the BUILT public package entries
 * (`dist/index.js`) and emits a static bundle under `harness/dist` that
 * Playwright serves. This is build/serve tooling only — no sync logic lives
 * here.
 */
const root = fileURLToPath(new URL("./harness", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./harness/dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
