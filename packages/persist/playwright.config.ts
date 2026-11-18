import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright / Chromium ACCEPTANCE config (REQ-BP-007). Serves the BUILT Vite
 * harness over a local static server (`vite preview`) and runs real Chromium
 * with real IndexedDB + crypto.subtle SHA-256 + navigator.locks.
 *
 * OFFLINE DISCIPLINE (honest, clarification 5): the harness is loaded FIRST
 * (networking enabled) so the uncached assets arrive; each test then disables
 * networking for its edit/import/flush assertions and re-enables it only to
 * load/reload uncached harness assets. This proves persistence + editing in an
 * already-loaded page with networking disabled — NOT cold offline loading
 * (service workers / asset caching are the next milestone).
 */
const PORT = 4319;

export default defineConfig({
  testDir: "./e2e",
  timeout: 20_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // A dependency-free multi-scope static server (e2e/static-multiscope-server.mjs)
  // serves the BUILT harness dist at the origin ROOT ("/") AND under two
  // sub-paths ("/deploy-p1/", "/deploy-p2/") on the SAME origin. The sub-paths
  // let the scope-isolation regression deploy the SAME build twice and prove the
  // scope-specific Service Worker cache namespaces stay independent. `vite
  // preview` only serves the root, so a plain static server replaces it here.
  webServer: {
    command: `node e2e/static-multiscope-server.mjs`,
    env: { GHOSTSYNC_HARNESS_PORT: String(PORT) },
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
