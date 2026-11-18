import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { swPrecachePlugin } from "./scripts/sw-precache-plugin.js";

/**
 * Production build. `base: "./"` makes every emitted URL (assets, ./sw.js, scope ./)
 * relative to the document, so the build works at the origin root (the MVP contract) and,
 * as an optional extra, under a sub-path. No sync logic lives here.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  base: "./",
  plugins: [swPrecachePlugin()],
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
