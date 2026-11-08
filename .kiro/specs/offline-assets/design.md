# offline-assets — Design

## Approach

A small **build-generated Service Worker** + **Cache Storage** precache, with
**no new dependency** (no Workbox). A Vite plugin inspects the ACTUAL emitted
bundle and writes the worker + manifest; the harness registers the worker and
exposes observable offline-readiness. Storage (IndexedDB, owned by
`packages/persist/src`) and transport remain separate from this asset cache.

## Components (all within the permitted file set)

### 1. Build-time generator — `packages/persist/scripts/sw-precache-plugin.ts`
A Vite plugin (`apply: "build"`, `generateBundle` with `order: "post"` so Vite's
HTML plugin has already added `index.html`). It:
- enumerates emitted chunks/assets (excluding `sw.js`, `sw-install-fail.js`,
  `precache-manifest.json`),
- computes a short SHA-256 `integrity` per entry from its emitted bytes,
- sorts entries and derives a **deterministic** `cacheVersion` = SHA-256 over the
  sorted `url\u0000integrity` lines (content-derived, no timestamp/counter),
- emits `precache-manifest.json` (inspectable) and `sw.js` (manifest inlined),
- emits a TEST-ONLY `sw-install-fail.js` whose install genuinely rejects.

Cache naming: prefix `ghostsync-persist-harness-`; cache name =
`${prefix}${cacheVersion}`.

### 2. Generated Service Worker — `dist/sw.js` (plain classic worker, no imports)
- **install**: fetch every precache URL with `cache:"reload"`; only AFTER all
  fetches are OK does it `cache.put` them. Any failure → install REJECTS →
  browser discards the worker → the previously installed version is kept
  (atomic precache; AC-OA-004-1). No automatic `skipWaiting` (AC-OA-004-2).
- **activate**: delete ONLY caches whose name starts with the scope prefix and is
  not the current version, then `clients.claim()` (AC-OA-004-3/004-4).
- **message**: `GHOSTSYNC_PRECACHE_STATUS` replies whether every manifest entry is
  present in the current cache; `GHOSTSYNC_SKIP_WAITING` is the explicit,
  user-driven takeover; `GHOSTSYNC_CLEANUP` runs the scoped cleanup on demand
  (deterministic test of the cleanup path).
- **fetch**: GET + same-origin + in-scope only. Navigation requests →
  cached shell (`index.html`); precached asset URLs → cache-first; everything
  else is NOT intercepted, so real 404s/failures stay visible (AC-OA-003-3). URLs
  are resolved against `self.registration.scope` so a subpath deployment works.

### 3. Harness registration + readiness — `packages/persist/harness/sw-register.ts`
`initOfflineReadiness()` installs `window.__gsOffline` and drives a state machine:
`registering → installing → (waiting | ready | failed)`, plus `unsupported` for
an insecure/unsupported context. It registers `./sw.js` with scope `./`. A worker
going `redundant` without ever controlling the page ⇒ `failed`. Readiness is
`ready` ONLY when the page has a controller AND the worker reports a COMPLETE
precache (a bounded `GHOSTSYNC_PRECACHE_STATUS` round-trip; AC-OA-002-4). State is
mirrored to `#offline-status` and `<html data-offline-state / data-offline-ready>`.
A `?sw=<name>.js` query (restricted to `[a-z0-9-]+\.js`) lets the acceptance suite
register the generated failing worker.

### 4. Harness wiring — `harness/harness.ts` + `harness/index.html`
`harness.ts` calls `initOfflineReadiness()` after installing `window.__gs` (the
existing persistence surface is unchanged). `index.html` adds `#offline-status`
and `#restored-data` panels. A TEST-ONLY `showRestored(text)` echoes restored data
into the DOM so the offline screenshot visibly shows the recovered replica.

## Update lifecycle (when a new version takes control)
A freshly installed worker WAITS (no auto `skipWaiting`). `updateAvailable`
becomes true and the state shows `waiting`. Control transfers either on the next
navigation after all controlled clients are released, or immediately when the
operator calls `window.__gsOffline.applyUpdate()` (explicit prompt). This avoids
mixing an old page with new assets.

## Readiness mechanism (observable, no sleep)
`window.__gsOffline.ready === true` ⟺ controlled page + complete precache. The
e2e `awaitOfflineReady(page)` waits for `window.__gs.ready` then
`window.__gsOffline.ready`. Failure surfaces a terminal `failed` state the tests
also await, so no test uses an arbitrary sleep.

## Separation of concerns
- Merge logic: `@ghostsync/kit` (untouched).
- Storage: IndexedDB in `packages/persist/src` (untouched, read-only here).
- Asset cache: the Service Worker + Cache Storage (this milestone), independent of
  IndexedDB persistence and of offline app loading entanglement.

## Honesty boundary
`route.fulfill`, injected HTML, and mocked workers are NOT used. Offline is real
(`context.setOffline(true)`); SW delivery is proven with
`response.fromServiceWorker()`. The install-failure case uses a REAL worker whose
install rejects. "Previously-initialized profile reopens offline" is promised;
"first-ever visit offline" is explicitly NOT promised and is asserted to fail.

## AC → test mapping
| Acceptance criterion | Evidence |
| --- | --- |
| AC-OA-001-1/2/3 | `precache-manifest.json` emitted; deterministic version verified by double build |
| AC-OA-001-4 | SW fetch handler scoping; only GET same-scope precached URLs cached |
| AC-OA-002-* | `offline-assets.spec.ts` readiness asserts + install-failure test |
| AC-OA-003-1/2/3 | cold-boot offline reload + `fromServiceWorker()` asserts |
| AC-OA-004-1/2 | atomic install (reject keeps old) + no auto skipWaiting |
| AC-OA-004-3/4 | scoped-cleanup test (unrelated cache + IndexedDB survive) |
| AC-OA-005-1..7 | `offline-assets.spec.ts` five tests |
| AC-OA-006-* | full suite run + `docs/progress.md` |
