import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // One file at a time: the raster property batches decode large images and must not be starved by CPU oversubscription.
    fileParallelism: false,
  },
});
