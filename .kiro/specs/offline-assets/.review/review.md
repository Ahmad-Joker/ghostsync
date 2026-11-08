# Final code review — offline-assets milestone (`feat/offline-assets`)

Range reviewed: `git diff 8312f50...HEAD` (commit `a376096`). Evidence read from the
implementer report and the commit message; build/test suites were NOT re-run per the
step instructions.

## Verdict: APPROVED

No blocking findings. All required scenarios are implemented with genuine offline
evidence, and the change stays within the permitted file set and semantics boundary.

## Scope / permitted-set check

`git diff --stat 8312f50...HEAD` shows 12 files, all permitted:

- `.kiro/specs/offline-assets/{requirements,design,tasks}.md` (new)
- `packages/persist/scripts/sw-precache-plugin.ts` (new)
- `packages/persist/harness/sw-register.ts` (new)
- `packages/persist/harness/harness.ts`, `index.html` (modified, additive)
- `packages/persist/vite.config.ts` (modified, registers build-only plugin)
- `packages/persist/e2e/helpers.ts` (modified, additive exports)
- `packages/persist/e2e/offline-assets.spec.ts` (new)
- `.gitignore` (comment only), `docs/progress.md`

`git diff --name-only` filtered for `packages/kit/`, `packages/persist/src/`, `apps/`,
`pnpm-lock`, `package.json`, `playwright.config` → no matches. `package.json`,
`playwright.config.ts`, and the lockfile produce an EMPTY diff (unchanged). No new
dependency. The 8 pre-existing e2e spec files are untouched (only `helpers.ts` gained
additive helpers and `offline-assets.spec.ts` is new).

## Blocking-criteria results (all pass)

- **Out-of-scope edits:** none. CRDT/persistence `src`, apps, kit, lockfile, manifests
  all untouched.
- **New dependency / lockfile edit:** none.
- **Deterministic cache version from real build:** `sw-precache-plugin.ts`
  `generateBundle` enumerates the actual `bundle` object, computes a per-entry short
  SHA-256 over emitted bytes, sorts entries, and derives `cacheVersion` as a SHA-256
  over `url\u0000integrity` lines. No hardcoded hashed filenames; no timestamp/counter.
  `EXCLUDED` keeps `sw.js`/`sw-install-fail.js`/`precache-manifest.json` out of the
  precache.
- **Offline-ready signal honesty:** `sw-register.ts` marks `ready` only when a
  controller exists AND a bounded `GHOSTSYNC_PRECACHE_STATUS` round-trip reports
  `complete === true`. Registration resolving alone is not sufficient; incomplete
  precache → `failed`.
- **No SPA catch-all masking 404s:** the fetch handler intercepts only GET, same-origin,
  in-scope requests; navigation requests fall back to the cached shell; non-navigation
  requests are served only if their URL is in `precacheUrls()`, otherwise they fall
  through to the network so a missing `.js`/unrelated request fails visibly.
- **Safe updates:** install is atomic (all fetches must be OK before any `cache.put`;
  a failure rejects install and keeps the prior version); no automatic `skipWaiting`
  (only via explicit `GHOSTSYNC_SKIP_WAITING`); activation deletes ONLY caches whose
  name starts with the `ghostsync-persist-harness-` prefix and is not the current
  version — never IndexedDB, unrelated caches, or other registrations.
- **No faked offline success:** tests use real `context.setOffline(true)`, no
  `route.fulfill`, no injected HTML, no mocked worker. SW delivery is proven with
  `response.fromServiceWorker() === true` for both the document and the JS asset.
  Failure-injection cases live in a separate `offline negative cases` describe block.
  Readiness is awaited via observable `window.__gsOffline.ready` / terminal state — no
  sleeps.
- **Test integrity:** no `.skip/.todo/.only`, no weakened assertions, no raised
  timeouts (`playwright.config.ts` unchanged at 20s). kit 112 / persist 50 unit coverage
  preserved (unchanged suites).
- **Browser result recorded:** commit message records exit codes (all 0), unit totals
  (kit 112, persist 50), browser 28 passed / 0 failed, Chromium 158.0.8127.18
  (Playwright 1.65.0), and the screenshot path under the gitignored `playwright-report/`.

## Required e2e scenarios (all present in `offline-assets.spec.ts`)

1. Previously-initialized profile: online load → full readiness → create legacy +
   structured + imported-remote data → flush → `setOffline(true)` → reload offline →
   shell boots and data restores. ✔
2. Offline edit (`status=resolved-offline`) + flush + offline reload → latest edit
   survives. ✔
3. New page in the SAME offline profile: `StorageInUseError` while the Web Lock is held,
   reopen after release. ✔
4. `fromServiceWorker() === true` for shell (document) + `assets/index-*.js`. ✔
5. Uncached fresh profile honestly fails offline (first-ever visit not promised). ✔
6. Install failure (`sw-install-fail.js`, a real rejecting worker) → `state === "failed"`,
   `ready === false`. ✔
7. Scoped cleanup removes only the stale prefixed cache; unrelated cache (`keep-me`) and
   IndexedDB replica (`survive=yes`) survive. ✔

## Notes (non-blocking)

- The scoped-cleanup test drives cleanup via an explicit `GHOSTSYNC_CLEANUP` message that
  runs the identical deletion code path as the `activate` handler. This is a deterministic
  exercise of the same logic rather than a second real activation; the deletion predicate
  is shared, so the assertion is meaningful. Not a defect.
- Documentation (`docs/progress.md`) covers the first-online-visit requirement, cache
  eviction/cleared-storage limits, the localhost/HTTPS requirement, the integrity-not-auth
  distinction, and manual verification steps, satisfying the reporting requirement.
