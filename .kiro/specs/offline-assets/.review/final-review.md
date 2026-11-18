# Final focused review — offline-assets defect fixes (`feat/offline-assets`)

Range reviewed: the current working-tree diff (`git diff`) plus the pre-existing staged
changes (`git diff --cached`). Evidence read from `docs/progress.md` (implementer report)
and the commit metadata; test/browser suites were NOT re-run per the step instructions.

## Verdict: APPROVED

No blocking findings. Both defect fixes are genuine, both regressions are real
Chromium assertions, existing assertions and the managed screenshot are intact, the
forbidden file set is untouched, and the recorded verification shows all exit codes 0.

## FIX 1 — scope-specific cache ownership (verified)

`packages/persist/scripts/sw-precache-plugin.ts`:

- `scopePrefix()` = `MANIFEST.cachePrefix + new URL(self.registration.scope).pathname + "::"`;
  `cacheName()` = `scopePrefix() + MANIFEST.cacheVersion`. Two deployments of the same
  build under different paths on one origin therefore produce different cache names
  (the scope pathname differs) even with identical content-derived versions. The
  content-derived version still distinguishes old-vs-new within one scope.
- The `"::"` terminator prevents prefix collisions between nested scope paths (e.g.
  `/app1/::` is not a prefix of `/app1/sub/::`), so a parent scope's cleanup cannot
  match a child scope's caches.
- `cleanupThisScope()` deletes ONLY keys where `key.indexOf(scopePrefix()) === 0 && key !== cacheName()`.
  It never touches another scope's caches (different prefix), unrelated caches,
  IndexedDB, or other registrations.
- The SAME `cleanupThisScope()` runs on both the `activate` handler and the explicit
  `GHOSTSYNC_CLEANUP` message. `install`, status reply, and cleanup-done reply all use
  `cacheName()`. The test-only failing worker's cache name was updated to the same
  scope-specific form.

## FIX 2 — restricted cached-HTML navigation (verified)

- `documentedNavUrls()` returns exactly the scope-relative root (`new URL("", scope)`)
  and `index.html` as fully-resolved URLs.
- In the `fetch` handler, navigation requests (`request.mode === "navigate"`) whose
  resolved URL is not in `documentedNavUrls()` return early (fall through to the
  network); only the two documented routes receive the cached shell. A missing-`.js`
  path requested as a navigation therefore falls through → honest offline failure, not
  a masked 200-HTML.
- Normal precached ASSET delivery is preserved: non-navigation GET requests whose URL
  is in `precacheUrls()` still serve cache-first; unknown asset URLs fall through.

## Regression A — two scopes on one origin (genuine)

`e2e/offline-assets.spec.ts` + `e2e/static-multiscope-server.mjs` + `playwright.config.ts`:

- A dependency-free Node static server serves the built `harness/dist` at `/`,
  `/deploy-p1/`, and `/deploy-p2/` on one origin; the harness registers its SW with
  `scope: "./"`, so each sub-path gets a scope-local registration/controller. This is a
  real two-deployment setup, not a simulation.
- The test asserts `p1Cache !== p2Cache`, that both names contain their sub-path, that
  both caches exist, that running cleanup in P1 (via `GHOSTSYNC_CLEANUP`, awaiting
  `GHOSTSYNC_CLEANUP_DONE`) leaves P2's cache present, and that P2 still boots offline
  with `fromServiceWorker() === true` for both the document and the JS asset and still
  reports its own unchanged cache name.

## Regression B — restricted navigation (genuine)

- Uses real `page.goto(...)` navigations (genuine `mode: "navigate"` reaching the SW
  fetch handler) to `/totally-unknown-route` and `/assets/does-not-exist.js` while
  offline; asserts neither boots the harness (`window.__gs.ready !== true`) and each
  fails at the network. A scripted `fetch` could not exercise navigate mode, so real
  navigations are the correct mechanism.
- After returning to the documented root (SW-served), a KNOWN precached asset still
  serves from the SW (`ok`, status 200, `fromServiceWorker() === true`), proving normal
  asset delivery is not regressed. The asset URL is discovered from the real
  `precache-manifest.json` (no hardcoded hash).

## Existing assertions + screenshot (intact)

- Offline root/index boot + restored-data assertions preserved: legacy `status`/remote
  key, structured incident `{ id: "i1", title: "Spill", priority: 1 }`, SW-served proof,
  offline edit survival (`resolved-offline`).
- Managed capture preserved: `testInfo.outputPath("offline-restored.png")` +
  `testInfo.attach(..., { contentType: "image/png" })`.
- The existing scoped-cleanup test was updated to seed its stale cache under the
  scope-specific prefix (derived from the SW-reported active cache name) so it still
  exercises same-scope cleanup after FIX 1 — intent unchanged, no weakened assertion.

## Constraints

- No forbidden paths changed: `git diff --name-only HEAD` over `packages/kit`,
  `packages/persist/src`, `apps`, `package.json`, `pnpm-lock.yaml`, and
  `packages/*/package.json` returns empty. No dependency/lockfile change.
- `playwright.config.ts` test `timeout` (20s) and `expect.timeout` (10s) unchanged; the
  webServer command swap (vite preview → the multi-scope static server) does not raise
  any test timeout. No `.skip` / `.todo` / `.only` present. No weakened assertions.
- HEAD remains `a376096`; the pre-existing staged entries (`.review/review.*`,
  `docs/progress.md`, `offline-assets.spec.ts`) remain staged; nothing reset, amended,
  committed, pushed, or unstaged.

## Recorded verification evidence (read, not re-run)

All commands exit 0: kit `test` 112 passed, persist `typecheck` clean, persist `test`
50 passed, persist `build` + `build:harness` ok, persist `test:browser` 30 passed
(28 prior + 2 new regressions), `git diff --check` clean, HEAD still `a376096`.
Chromium via Playwright 1.65.0 (Chrome for Testing 158). Managed screenshot preserved
at `packages/persist/test-results/offline-assets-offline-col-bb88a-ives-another-offline-reload-chromium/offline-restored.png`
(25443 bytes, valid PNG signature).

## Non-blocking note (not a finding)

The task brief's explicit permitted-file enumeration does not name
`packages/persist/e2e/static-multiscope-server.mjs`. The authoritative original user
request (which wins over a brief paraphrase) permits "Related offline harness/test
helpers only where necessary." This dependency-free static server is a genuine test
helper required for the two-scope regression (vite preview serves only the root), adds
no dependency, and touches no production/SDK/app code. It is within the authoritative
scope and is not treated as a blocker.
