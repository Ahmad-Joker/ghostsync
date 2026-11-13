import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Run test files one at a time. The async property tests hash (Web Crypto)
    // and apply on every one of their 200 runs; with files in parallel, CPU
    // oversubscription during worker start-up made them 4-5x slower than in
    // isolation and pushed them past the default 5 s test timeout.
    fileParallelism: false,
  },
});
