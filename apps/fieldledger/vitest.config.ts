import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/dist-scan.test.ts", "node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
