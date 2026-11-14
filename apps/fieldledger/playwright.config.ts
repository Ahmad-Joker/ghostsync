import { defineConfig, devices } from "@playwright/test";

const PORT = 4329;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Serves the BUILT dist (run `pnpm build` first).
  webServer: {
    command: "node e2e/static-server.mjs",
    env: { FIELDLEDGER_PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
