# offline-assets — Requirements

## Overview

Add the smallest reliable **offline asset-loading** milestone for the existing
production-built `@ghostsync/persist` verification harness. A
**previously-initialized** browser profile must boot the production harness and
restore its replica with networking **disabled throughout navigation**. This
milestone caches the harness **shell + assets**; it does **not** change CRDT or
persistence semantics (`packages/persist/src` is untouched) and does **not**
build the application UIs (FieldLedger / PatchBoard / Studio). The harness stays
a verification tool.

Baseline: commit `8312f50` — `@ghostsync/kit` 112 tests + 8 properties,
`@ghostsync/persist` 50 unit tests + 23 Chromium e2e. Before this milestone the
browser tests re-enabled networking to reload uncached assets; this milestone
removes that need for a previously-initialized profile.

## Requirements

### REQ-OA-001 — Production asset precache
As a harness operator, I want every asset needed to boot the shell cached, so a
return visit loads offline.
- **AC-OA-001-1** The build emits a Service Worker (`sw.js`) and an inspectable
  `precache-manifest.json` derived from the ACTUAL emitted bundle (never
  hardcoded hashed filenames).
- **AC-OA-001-2** The precache includes the shell HTML (`index.html`) and every
  emitted asset required to boot it (the hashed JS chunk).
- **AC-OA-001-3** The cache version is DETERMINISTIC — a content hash over the
  sorted precache entries; identical build contents ⇒ identical version.
- **AC-OA-001-4** IndexedDB contents, sync messages, non-GET requests, arbitrary
  URLs, and external/cross-origin resources are NOT cached.

### REQ-OA-002 — Registration, scope, observable readiness
- **AC-OA-002-1** The SW is registered only for the production-built harness on a
  secure context (localhost/HTTPS); an insecure/unsupported context is reported
  as `unsupported`.
- **AC-OA-002-2** The worker URL is stable (`./sw.js`) and scope is limited to the
  harness deployment directory (`./`). No hardcoded localhost port or absolute
  asset path — all URLs resolve relative to the worker's own scope, so hosting
  under a subpath still works.
- **AC-OA-002-3** Readiness is OBSERVABLE at `window.__gsOffline` (mirrored to
  `#offline-status` and `<html data-offline-state>`), awaitable with no sleep.
- **AC-OA-002-4** The harness is marked offline-ready ONLY when the worker
  controls the page AND the precache is fully populated — never merely because
  registration resolved.
- **AC-OA-002-5** A registration/precache failure surfaces a `failed` state, not
  `ready`.

### REQ-OA-003 — Fetch behavior
- **AC-OA-003-1** Cached shell + known assets are served when offline.
- **AC-OA-003-2** Navigation requests are served the cached shell ONLY for the
  DOCUMENTED harness routes (the scope-relative deployment root and
  `index.html`). The shell is NOT returned for any other navigation path.
- **AC-OA-003-3** Unknown resources are NOT masked — a missing `.js` or unrelated
  request is left to the network so its real 404/failure stays visible (no SPA
  catch-all returning HTML for assets). This INCLUDES a missing-`.js` path
  requested as a NAVIGATION: it must NOT receive the cached HTML shell; it misses
  → network → an honest offline failure.
- **AC-OA-003-4** Existing persistence behavior and diagnostics are preserved.

### REQ-OA-004 — Safe updates
- **AC-OA-004-1** An INCOMPLETE precache must NOT replace a working installed
  version — install is atomic (reject ⇒ keep the old version).
- **AC-OA-004-2** No automatic `skipWaiting`; a new worker waits so old pages never
  mix with new assets. Taking control is via an EXPLICIT prompt
  (`__gsOffline.applyUpdate()`), on next navigation after clients release.
- **AC-OA-004-3** Cache ownership is specific to the actual registration SCOPE:
  the cache name is `ghostsync-persist-harness-` + the worker's
  `self.registration.scope` PATHNAME + `::` + the content-derived version. Two
  deployments of the SAME build under DIFFERENT paths on the SAME origin
  therefore own SEPARATE cache namespaces even with IDENTICAL build contents. On
  activation (and on the explicit `GHOSTSYNC_CLEANUP` message), clean ONLY caches
  whose name begins with THIS exact scope prefix that are not the current
  version. The content-derived version still distinguishes old-vs-new WITHIN a
  scope; the scope distinguishes DEPLOYMENTS on one origin.
- **AC-OA-004-4** Cleanup never deletes a cache owned by ANOTHER scope, an
  unrelated cache, IndexedDB, or another registration.

### REQ-OA-005 — Real Chromium acceptance
- **AC-OA-005-1** From a CLEAN context: load online, await complete offline
  readiness + worker control (observable, no sleep); create legacy + structured
  data, flush; disable networking; reload WITHOUT re-enabling; assert the shell
  boots and data restores; edit + flush offline, reload offline, verify the
  latest edit survived.
- **AC-OA-005-2** Close the page and open a NEW page in the SAME offline
  context/profile; reopen the saved replica after the prior page releases the Web
  Lock.
- **AC-OA-005-3** Assert the shell + required asset responses are
  service-worker-served (`response.fromServiceWorker() === true`).
- **AC-OA-005-4** An UNCACHED fresh profile honestly FAILS to open offline
  (first-ever visit is NOT promised).
- **AC-OA-005-5** A worker/cache INSTALLATION FAILURE is reported as a failure
  state, never offline-ready (injected test-side via a real failing worker).
- **AC-OA-005-6** Scoped cleanup leaves unrelated caches AND IndexedDB untouched.
- **AC-OA-005-7** HONESTY: no `route.fulfill`, injected page HTML, or mocked
  service worker is used to manufacture offline success; failure-injection tests
  are clearly separated and labeled.
- **AC-OA-005-8** (FIX 1 regression) Two distinct deployment SCOPES on one origin
  (served under two sub-paths of the SAME built harness) own SEPARATE caches;
  running cleanup/activation in one scope PRESERVES the other scope's cache and
  its ability to boot offline (document + asset still `fromServiceWorker()`).
- **AC-OA-005-9** (FIX 2 regression) An unknown navigation path and a
  missing-`.js` path requested as a NAVIGATION do NOT receive the harness HTML
  shell (offline, they fail at the network — no masked 200-HTML), while a KNOWN
  precached asset STILL serves from the SW cache (`fromServiceWorker() === true`).

### REQ-OA-006 — Regression + documentation
- **AC-OA-006-1** All existing coverage preserved + meaningful: 112 kit, 50 persist
  unit, 23 existing e2e; new offline e2e added. No `.skip/.todo/.only`, no
  weakened assertions, no timeout increases.
- **AC-OA-006-2** No `packages/kit` or `packages/persist/src` changes; no new
  dependencies; no lockfile edits.
- **AC-OA-006-3** Docs explain the first-online-visit requirement, cache
  eviction / cleared-storage limitations, the localhost/HTTPS requirement, and
  manual verification; a real offline screenshot path is recorded.

## Out of scope
- CRDT / persistence semantics changes (src is read-only here).
- Application UIs (FieldLedger / PatchBoard / Studio).
- Capsule codec, QR transfer, schema editor.
- Caching user data (IndexedDB, sync messages) in the Service Worker.

## Security note
Every cached response is integrity-bounded by a content hash in the precache
manifest: a checksum/hash **detects corruption; it does not authenticate the
sender**. The SW caches only same-origin, same-scope GET assets it explicitly
precached; it never caches external resources, and no secrets or PII are placed
in the generated artifacts.
