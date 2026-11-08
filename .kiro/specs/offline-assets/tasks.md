# offline-assets — Tasks

- [x] T1 — Build-time SW + precache-manifest generator
  (`scripts/sw-precache-plugin.ts`): enumerate the ACTUAL emitted bundle, compute
  a deterministic content-derived cache version, emit `sw.js`,
  `precache-manifest.json`, and a TEST-ONLY failing worker. (REQ-OA-001)
- [x] T2 — Wire the plugin into `vite.config.ts` (build-only; no new dep).
  (REQ-OA-001)
- [x] T3 — Generated Service Worker: atomic install, scoped activate cleanup,
  navigation→shell + cache-first-for-precached fetch, status/cleanup/skip-waiting
  messages; scope-relative URLs. (REQ-OA-001/003/004)
- [x] T4 — Harness registration + observable readiness
  (`harness/sw-register.ts`): `window.__gsOffline` state machine (controlled +
  complete precache ⇒ ready; redundant/precache-fail ⇒ failed); DOM mirror;
  `?sw=` override for the failing-worker test. (REQ-OA-002)
- [x] T5 — Harness wiring: call `initOfflineReadiness()` from `harness.ts`; add
  `#offline-status` + `#restored-data` to `index.html`; add TEST-ONLY
  `showRestored`. (REQ-OA-002/003)
- [x] T6 — e2e helpers: `awaitOfflineReady` + `readOfflineState` (observable, no
  sleep). (REQ-OA-005)
- [x] T7 — `e2e/offline-assets.spec.ts`: cold offline boot + restore + offline
  edit survives offline reload; new-page-same-profile reopen after lock release;
  scoped cleanup preserves unrelated cache + IndexedDB; `fromServiceWorker()`
  asserts; real offline screenshot. (REQ-OA-005)
- [x] T8 — Negative cases (separated): uncached fresh profile honestly fails
  offline; real install-failure reported as failed, never ready. (REQ-OA-005-4/5)
- [x] T9 — Regression: keep 112 kit / 50 persist unit / 23 existing e2e
  meaningful; no skips/weakened assertions/timeout bumps; no src/kit/dep/lockfile
  changes. (REQ-OA-006)
- [x] T10 — Docs: `.gitignore` for generated artifacts (already covered by
  `dist/`), `docs/progress.md` with PLANNED→IMPLEMENTED→TESTED, commands + exit
  codes, totals, Chromium version, screenshot path, limitations. (REQ-OA-006)

## Defect-fix pass (scope-specific cache naming + restricted navigation)

- [x] T11 — FIX 1: make cache ownership specific to the registration SCOPE in
  `scripts/sw-precache-plugin.ts` — cache name =
  `ghostsync-persist-harness-<scope-pathname>::<version>`; shared
  `cleanupThisScope()` deletes ONLY older caches of THIS exact scope on both
  activation and the `GHOSTSYNC_CLEANUP` message (never another scope / unrelated
  / IndexedDB / other registration). (REQ-OA-004, AC-OA-004-3/004-4)
- [x] T12 — FIX 2: restrict the navigation-shell fallback to the DOCUMENTED
  routes only (scope-relative deployment root + `index.html`); any other
  navigation (including a missing-`.js` navigation) is left to the network — no
  catch-all HTML. (REQ-OA-003, AC-OA-003-2/003-3)
- [x] T13 — Multi-scope serving for the regression: dependency-free
  `e2e/static-multiscope-server.mjs` serves the built harness at `/`,
  `/deploy-p1/`, `/deploy-p2/`; wired into `playwright.config.ts` webServer
  (replaces `vite preview`). (REQ-OA-005)
- [x] T14 — Regression A (real Chromium): two deployment scopes on one origin own
  SEPARATE caches; cleanup/activation in P1 preserves P2's cache + offline boot.
  (AC-OA-005-8)
- [x] T15 — Regression B (real Chromium): unknown navigation + missing-`.js`
  navigation receive NO HTML shell; a known precached asset still serves from the
  SW (`fromServiceWorker()`). Existing boot/restore + screenshot preserved.
  (AC-OA-005-9)
- [x] T16 — Update the existing scoped-cleanup test's seeded stale-cache name to
  the scope-specific prefix (derived from the SW-reported active cache name) so
  it still exercises same-scope cleanup after FIX 1. (AC-OA-005-6)

## Verification commands (run from workspace root, PowerShell)
1. `pnpm.cmd install --frozen-lockfile`
2. `pnpm.cmd -F @ghostsync/kit build`
3. `pnpm.cmd -F @ghostsync/persist build`
4. `pnpm.cmd -F @ghostsync/persist typecheck`
5. `pnpm.cmd -F @ghostsync/persist test`
6. `pnpm.cmd -F @ghostsync/persist build:harness`
7. `pnpm.cmd -F @ghostsync/persist test:browser`
8. `pnpm.cmd -F @ghostsync/kit test`
9. `git diff --check`
10. `git status --short --branch`
