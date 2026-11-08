import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { swPrecachePlugin } from "./scripts/sw-precache-plugin.js";

/**
 * Minimal Vite harness build (REQ-BP-007, clarification 5). A plain static
 * server cannot execute the harness TypeScript with bare `@ghostsync/*` package
 * imports; Vite resolves those to the BUILT public package entries
 * (`dist/index.js`) and emits a static bundle under `harness/dist` that
 * Playwright serves. This is build/serve tooling only — no sync logic lives
 * here.
 *
 * offline-assets milestone: the `swPrecachePlugin` enumerates the ACTUAL
 * emitted bundle and writes a Service Worker (`dist/sw.js`) + inspectable
 * `dist/precache-manifest.json`. The worker precaches the shell + its assets so
 * a previously-initialized profile boots offline. The plugin is build-only and
 * adds no runtime dependency.
 */
const root = fileURLToPath(new URL("./harness", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [swPrecachePlugin()],
  build: {
    outDir: fileURLToPath(new URL("./harness/dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
