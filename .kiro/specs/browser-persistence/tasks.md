# browser-persistence — Tasks

Status: **IMPLEMENTED & VERIFIED.** Every task below is complete (`- [x]`). Branch `feat/browser-persistence`,
baseline `d53452f`. `packages/persist/**`, `pnpm-lock.yaml`, `.kiro/specs/browser-persistence/**`,
`docs/progress.md`, and `.gitignore` are the only changes. `packages/kit/*`, `apps/*`, and root manifests
are **untouched**; nothing was staged, committed, or pushed (the caller handles git). The five
implementation clarifications in `requirements.md` were applied AS the code was written.

Each task links the requirement IDs it satisfies. The exact commands run and their exit codes are in Task 10
and in `docs/progress.md`.

## 1. Package scaffold — REQ-BP (all), NFR-BP-001/002/003

- [x] 1.1 Created `packages/persist/package.json` (`@ghostsync/persist`, `type: module`, ESM `exports`,
  `main`/`module`/`types`, `files: ["dist"]`, scripts `typecheck`/`test`/`build`/`build:harness`/
  `test:browser`; dep `@ghostsync/kit@workspace:*`; devDeps exact-pinned per design). `pnpm-workspace.yaml`
  already globs `packages/*` — no workspace edit was needed.
- [x] 1.2 Created `packages/persist/tsconfig.json` (strict; `lib ["ES2022","DOM","DOM.Iterable"]`;
  `NodeNext`; `verbatimModuleSyntax`; `noUncheckedIndexedAccess`; `exactOptionalPropertyTypes`) and
  `tsconfig.build.json` (src-only emit to `dist`), mirroring the Kit.
- [x] 1.3 Created `vitest.config.ts` + `vitest.setup.ts` (`import "fake-indexeddb/auto"` + a labeled
  single-process Web Locks mock), `vite.config.ts` (minimal harness build consuming built entries), and
  `playwright.config.ts` (chromium project, `webServer = vite preview`, bounded timeouts, no sleeps).

## 2. Storage key + record/version codec — REQ-BP-001, REQ-BP-006, NFR-BP-006

- [x] 2.1 `src/identity.ts`: `ReplicaIdentity`, `SEP`/`esc()` (copied NUL-introducer escape),
  `storageKey(app, documentId, replicaId)`, `resolveIdentity()` (`crypto.randomUUID()` when omitted; never
  from `clientID`), and `lockName(dbName, key)` (unambiguously includes BOTH dbName and storageKey —
  clarification 3). (REQ-BP-001-1/2/4, REQ-BP-005 clar. 3)
- [x] 2.2 `src/record.ts`: `StoredRecord` shape with `version: 1`, identity fields, `bytes`, `sequence`,
  `checksum`, `savedAt`; `buildRecord`; `sha256Hex()` via `crypto.subtle` (hex) — the only algorithm, **no
  FNV-1a** — awaited to completion before any `readwrite` transaction opens; `validateRecord()` in the fixed
  order **shape → size → version → identity → checksum → sequence** (shape before `bytes.length`; sequence a
  non-negative safe integer), each failure a typed `InvalidRecordError` naming the check; no auto-wipe; a
  failed checksum preserves the corrupt stored record. (REQ-BP-002-5, REQ-BP-003-2a, REQ-BP-006-5, NFR-BP-006)
- [x] 2.3 `src/errors.ts`: `PersistenceError` with the `code` union
  (`DatabaseOpenError`/`StorageUnavailableError`/`UnsupportedEnvironmentError`/`StorageInUseError`/
  `TransactionAbortError`/`QuotaExceededError`/`BlockedError`/`InvalidRecordError`/`CloseFailedError`/
  `ClosedError`) + `isPersistenceError`.

## 3. IndexedDB layer — REQ-BP-003, REQ-BP-006

- [x] 3.1 `src/idb.ts`: raw `indexedDB.open("ghostsync", 1)` with `onupgradeneeded` creating object store
  `"replicas"` (`keyPath: "storageKey"`); reject `StorageUnavailableError` when `indexedDB` is absent,
  `DatabaseOpenError`/`BlockedError` on `onerror`/`onblocked`; register `versionchange` to close gracefully;
  a LATE open success after an earlier blocked/error rejection closes the abandoned connection
  (clarification 3). (REQ-BP-006-1/3/4)
- [x] 3.2 `src/idb.ts`: `readRecord(key)` and `writeRecord(record)` where the **write resolves only in
  `transaction.oncomplete`** (not request `onsuccess`), reads the stored sequence via the request CALLBACK
  (not a synchronous returned value), and surfaces `onabort` as `TransactionAbortError`/`QuotaExceededError`.
  (REQ-BP-003-3, REQ-BP-006-2)

## 4. Async open + restore + validate — REQ-BP-002

- [x] 4.1 `src/session.ts` `openReplica(options)`: validate options; **acquire the exclusive Web Lock
  (non-waiting) BEFORE** reading/restoring; open DB (release lock on open failure); `readRecord(storageKey)`;
  run `validateRecord()`; on a valid record seed via the PUBLIC `applyUpdate` boundary (`restored:true`,
  generation counter initialized from the validated stored sequence); on no record create fresh
  (`restored:false`); only THEN construct and return the `PersistSession`. (REQ-BP-002-1/2/3/4, REQ-BP-005-1)
- [x] 4.2 Seed via the PUBLIC boundary (clarification 4): create a FRESH `createReplica(documentId)` and
  apply the validated stored bytes through `applyUpdate`; on `{ ok:false }` `destroy()` that accessible
  replica and reject `InvalidRecordError(reason)`. On any corrupt/invalid/oversized/seed-reject record,
  **close the IDB connection, release the acquired Web Lock**, and leave the stored record untouched (no
  auto-wipe/replace/delete). (REQ-BP-002-5/5a/6)

## 5. Save state machine + generation + flush — REQ-BP-003

- [x] 5.1 `src/session.ts`: implemented the `dirty/saving/saved/error` machine with `onStateChange`
  (callback exceptions isolated); serialize saves per key (one in-flight; follow-up on dirty-during-save);
  the current dirty revision is tracked separately from the snapshot saving, so an older txn completing never
  reports the session saved while a newer edit is pending. (REQ-BP-003-1, clarification 2)
- [x] 5.2 On save: capture `{ bytes = exportState().bytes.slice() (immutable), sequence = ++generation }`,
  enforce `maxBytes` BEFORE the write, **`await`
  `crypto.subtle.digest("SHA-256", bytes)` to completion BEFORE opening the `readwrite` transaction**; the
  transaction body is **purely synchronous** (read-compare stored `sequence`, then `put` the precomputed
  bytes+checksum) with **no `await` inside** the active transaction (else `TransactionInactiveError`);
  serialize the whole capture→hash→write pipeline (single-flight) so a stale older-generation hash cannot
  clobber a newer save; set `saved` only in `transaction.oncomplete` (a transaction abort leaves the session
  **visibly unsaved**); implement the **read-modify-write generation guard** (skip put when stored
  `sequence ≥ thisSequence`; sequence never regresses). A skipped stale write (`{ written: false }`) is
  surfaced as a `TransactionAbortError` and does NOT advance the persisted marker or report `saved` — the
  in-memory edit and the newer stored record both survive (no clobber, no false `saved`). (REQ-BP-003-2/2a/3/4,
  REQ-BP-003-4a, clarification 2)
- [x] 5.3 `flush()` covers edits accepted before its call and resolves only after that generation's
  transaction completes (or rejects in `error`); a failed save → `error`, live replica intact, retry only on
  the next flush/dirty (no tight auto-retry loop). The flush waiter is registered BEFORE a save is triggered,
  so a save that settles **synchronously before its first `await`** (pre-write `maxBytes`) never strands a
  waiter; repeated-failure flush and same-session transient retry both settle. (REQ-BP-003-5/6, REQ-BP-006-6)
- [x] 5.4 `close()`: prevent further mutation as soon as closing begins; flush edits accepted before closing;
  **on success** release lock + close DB + `replica.destroy()`, then all ops AND existing collection handles
  reject `ClosedError`. A **failed final save rejects `CloseFailedError`** (never a silent durable close) and
  enters a **recovery-only** state: `exportBytes()` and reads keep working while `set`/`delete`/`applyUpdate`/
  `flush` AND `collection(adapter)` (schema-meta write ⇒ mutation) reject `ClosedError`; the lock is
  **retained** and released only on a later explicit `dispose()`/unload (single lock-release rule,
  AC-BP-005-7a). `dispose()` is a first-class, idempotent, non-durable discard that releases all resources
  without claiming a save. Terminal teardown marks the session terminating (suppressing further state
  notifications), **aborts/awaits an active write transaction** and the in-flight save BEFORE releasing the
  lock (no late write or `saved` after ownership release), and **awaits the actual Web Lock release** so an
  immediate same-key reopen can acquire it; CONCURRENT `close()`/`dispose()` share one teardown and settle
  consistently. Wired `pagehide`/`visibilitychange` best-effort flush (no durability promise on unload).
  (REQ-BP-003-7/8, REQ-BP-005-7/7a/7b/7c)

## 6. Persistence-session routed import — REQ-BP-004

- [x] 6.1 `session.applyUpdate(carrier)`: call `replica.applyUpdate`, return the `ApplyOutcome` unchanged;
  mark `dirty` + schedule save on **every `ok`** (including pending/no-op accept); do nothing on `!ok`
  (rejected bytes never written). (REQ-BP-004-1/2/3)
- [x] 6.2 Exposed reads/exports/local-edits via **explicit session accessors** and a **guarded collection**
  (`get`/`has`/`getState`/`collection`/`subscribe`/`exportState`/`exportStateVector`/`exportDiff`); do NOT
  hand out the raw `Replica` (no `session.replica`), so `replica.applyUpdate` is unreachable through the
  session; wired `replica.subscribe` to mark dirty on `origin === "local"` as a supplement. The guarded
  collection's READ routes (`get`/`getResult`/`list`/`listResults`/`has`) apply the session's **readable**
  guard — including on a handle captured while open — so after terminal close/dispose they reject a typed
  `ClosedError` instead of a raw destroyed-Yjs-doc error; recovery-only reads stay allowed; `subscribe` is
  blocked after terminal disposal. (REQ-BP-004-4/5, AC-BP-005-7d)

## 7. Concurrent-access ownership (EXCLUSIVE single-writer) — REQ-BP-005

- [x] 7.1 `src/locks.ts`: acquire an **exclusive, non-waiting** lock
  `navigator.locks.request(lockName(dbName,key), { mode:"exclusive", ifAvailable:true }, cb)` **BEFORE**
  reading/restoring the record; hold it for the **whole session lifetime** (the callback promise stays
  pending until release); release on close/dispose/unload. The lock name includes BOTH dbName and
  storageKey. There is **no reader role** and **no ownership transfer**. (REQ-BP-005-1, clarification 3)
- [x] 7.2 Contention + retry: if the lock callback receives `null`, reject `openReplica` with
  `StorageInUseError` and perform **zero** storage writes. A caller retry after the owner closes **re-reads
  the latest committed record** while holding the lock (never a stale in-memory snapshot). Separate
  `replicaId` ⇒ separate key ⇒ separate lock ⇒ both writers. (REQ-BP-005-2/3/4)
- [x] 7.3 Unsupported capability: if `navigator.locks` is undefined, reject `openReplica` with
  `UnsupportedEnvironmentError` — **no degraded fallback**, no unprotected writer, no `degraded` flag.
  (REQ-BP-005-5)

## 8. Browser test harness — REQ-BP-007

- [x] 8.1 `harness/index.html` + `harness/harness.ts` (built by Vite): wires `openReplica` with a
  FieldLedger-style adapter; exposes `window.__gs` whose methods resolve on real lifecycle events (open
  resolved, `flush()` resolved on `oncomplete`). No application UI. (REQ-BP-007-3)
- [x] 8.2 `playwright.config.ts` chromium project serves the built harness via `vite preview`; tests load
  with networking ON then set the context **offline** for edit/import/flush and assert no network is
  required; bounded per-test timeouts; readiness via awaited `window.__gs` signals, never sleeps.
  (REQ-BP-007-1/4)

## 9. Full test plan — REQ-BP-007 (IMPLEMENTED & RUN)

Node unit (fast feedback only — NOT acceptance evidence) — 38 tests passed:
- [x] 9.1 `tests/storage-key.test.ts` — escaping/collision + pinned key strings (REQ-BP-001).
- [x] 9.2 `tests/record-codec.test.ts` — shape/size/version/identity/checksum/sequence + real SHA-256
  (REQ-BP-006, NFR-BP-006).
- [x] 9.3 `tests/generation-guard.test.ts` — stale-write dropped; sequence monotonic (REQ-BP-003-4).
- [x] 9.4 `tests/state-machine.test.ts` — transitions, restore legacy+structured, reopen cycles advance
  sequence, replicaId isolation, close/dispose idempotency (REQ-BP-003).
- [x] 9.5 `tests/routed-import.unit.test.ts` — dirty on every `ok` incl. pending/no-op; nothing on `!ok`;
  integrate on prerequisite (REQ-BP-004).
- [x] 9.5b `tests/open-restore.unit.test.ts` — corrupt-record preserved, oversize rejected, contention zero
  writes, maxBytes-before-write (labeled fake-indexeddb supplement — REQ-BP-002/005/006).

Playwright + Chromium, real IndexedDB (ACCEPTANCE evidence) — 15 tests passed:
- [x] 9.6 `e2e/identity-isolation.spec.ts` — same `documentId`, different `replicaId` → separate storage;
  reload restores own data (REQ-BP-001).
- [x] 9.7 `e2e/open-restore.spec.ts` — fresh open; seeded open (legacy + structured intact); corrupt-record
  open rejects `InvalidRecordError` and leaves bytes byte-identical (REQ-BP-002).
- [x] 9.8 `e2e/save-flush.spec.ts` — the save path succeeds with a **real async SHA-256 digest + real
  IndexedDB**; `flush()` resolves saved; repeated reopen/edit/save cycles advance sequence + retain latest;
  maxBytes-before-write surfaces error and keeps live data (REQ-BP-003).
- [x] 9.9 `e2e/routed-import.spec.ts` — out-of-order (pending) accept with NO notification still dirties,
  survives flush+reload, integrates on prerequisite delivery; rejected import leaves record unchanged
  (REQ-BP-004).
- [x] 9.10 `e2e/concurrent-same-key.spec.ts` (**TWO PAGES, SAME context+origin**) — a second same-key
  session **cannot open** (`StorageInUseError`) while the first holds the lock; two **different** replica
  keys open concurrently; after the owner closes, a **retry** restores its **latest** saved data; dispose
  releases ownership (REQ-BP-005).
- [x] 9.11 `e2e/errors-lifecycle.spec.ts` — a visible save failure → `error`, live state intact, retry
  succeeds; a **failed close()** preserves `exportBytes()` and blocks every mutation route (recovery-only),
  then dispose releases ownership (REQ-BP-005/006).
- [x] 9.12 `e2e/persistence-e2e.spec.ts` — survival matrix: legacy + structured survive reload after flush;
  accepted remote imports persist; restored replica converges through SDK updates; invalid records
  discoverable via `listResults()` after reload. (b) isolation / (d) pending-dependent / (f)+(g) are covered
  in the specs above (REQ-BP-007).

## 9b. Independent-review follow-up fixes — flush/skip/lifecycle/read-guard

These four fixes correct defects found after the initial milestone. Each is grounded in a reproduced defect
and ships with a deterministic regression; no public failure-injection API was added (all failure
instrumentation is test-only).

- [x] 9b.1 **Flush never strands a waiter (fix 1, AC-BP-003-5).** `flush()` registers its waiter BEFORE
  triggering a save, so a save that fails/succeeds **synchronously before its first `await`** (pre-write
  `maxBytes`) still settles the waiter. Regressions: `tests/flush-lifecycle.test.ts` (repeated oversized
  flush rejects twice — no hang; same-session transient retry resolves `saved`) and
  `e2e/errors-lifecycle.spec.ts` (repeated oversized flush; **same-session** retry after a REAL aborted
  transaction — correcting the old dispose-and-reopen test).
- [x] 9b.2 **Transactions finish before ownership release (fix 2, AC-BP-005-7c).** `idb.writeRecord` exposes
  the live transaction via an internal hook; `session` tracks it and, on terminal teardown, aborts/awaits it
  and the in-flight save before releasing the lock, suppresses state notifications once terminating, awaits
  the actual `navigator.locks` release, and shares one teardown promise across concurrent close/dispose.
  Regressions: `tests/flush-lifecycle.test.ts` (dispose during in-flight save / during hashing; same-key
  reopen; concurrent close+dispose) and `e2e/lifecycle-fixes.spec.ts` (dispose during a REAL aborted
  transaction; same-key reopen acquires the lock; concurrent close/dispose).
- [x] 9b.3 **Truthful skipped writes (fix 3, AC-BP-003-4a).** `#saveOnce` honors `writeRecord`'s
  `{ written }`: a skipped stale write surfaces `TransactionAbortError`, does not advance the marker, and
  preserves both the in-memory edit and the newer stored record. Regressions: `tests/flush-lifecycle.test.ts`
  (planted newer sequence via a second connection) and `e2e/lifecycle-fixes.spec.ts` (planted newer record;
  flush is not a false `saved`; edit + stored record survive).
- [x] 9b.4 **Guarded collection reads + subscription (fix 4, AC-BP-005-7d).** The guarded collection's read
  routes and `subscribe` apply the session's readable guard; a handle captured while open returns a typed
  `ClosedError` after terminal close. Regressions: `tests/flush-lifecycle.test.ts` (captured-handle reads;
  session reads/subscribe; recovery-only reads preserved) and `e2e/lifecycle-fixes.spec.ts` (captured-handle
  reads + subscribe in real Chromium).

## 9c. Review follow-up 2 — remaining fixes (immediate flush retry / terminal txn event / onStateChange guard / clean-checkout typecheck)

This round fixes the three REMAINING review findings plus the clean-checkout typecheck ordering. All
instrumentation remains test-only; no public failure-injection API was added. SDK/apps/deps/lockfile
unchanged; the staged review-ZIP index was left intact (new/edited files are unstaged `AM`/`??`).

- [x] 9c.1 **Immediate flush retry no longer hangs (fix 1, AC-BP-003-5).** `#runSave`'s `finally` clears
  `#inFlight` FIRST, then schedules a FRESH save (via new `#hasPendingFlushWaiter()`) when a retry `flush()`
  that arrived WHILE the failed worker was unwinding left a still-pending waiter — so the immediate retry
  (no inserted `Promise.resolve()`/timer/polling) is serviced, not stranded. Regressions
  (`tests/flush-lifecycle.test.ts`, NO microtask gap): IMMEDIATE repeated oversized flush (both reject) and
  IMMEDIATE same-session retry after a transient (forced-digest) failure that resolves `saved`.
- [x] 9c.2 **Await the ACTUAL terminal transaction event (fix 2, AC-BP-005-7c).** `idb.writeRecord`/`readRecord`
  settle on `transaction.oncomplete`/`transaction.onabort` (never on `onerror` alone, which can precede
  `onabort`); request/tx errors are recorded and surfaced through the abort rejection. Teardown therefore
  waits for the terminal event (it awaits the in-flight save) before releasing ownership. Deterministic
  regression asserts the ordering EXPLICITLY — `tx:abort → lock:release → dispose:resolve` — in both
  `tests/flush-lifecycle.test.ts` (via test-only `tests/support/tx-abort-hook.ts`: a real-IndexedDB abort +
  lock-release observer) and `e2e/lifecycle-fixes.spec.ts` (via the harness lifecycle log), plus immediate
  same-key reopen and no late writes/notifications.
- [x] 9c.3 **onStateChange guarded after terminal disposal (fix 3, AC-BP-005-7d).** `onStateChange` now calls
  `#assertReadable()`, so a new save-state subscription after terminal close/dispose throws the typed
  `ClosedError` (recovery-only still allowed). Regressions: `tests/flush-lifecycle.test.ts` (after terminal
  dispose and after terminal close) and `e2e/lifecycle-fixes.spec.ts` (after terminal disposal in Chromium).
- [x] 9c.4 **Clean-checkout typecheck independent of stale dist (fix 4, NFR-BP-002).** `tsconfig.json` maps
  `"@ghostsync/persist": ["./src/index.ts"]`, so the harness's self-import typechecks against SOURCE;
  verified by deleting `dist` and running `typecheck` (exit 0). Typing not weakened (no `any`/loosened
  options/`@ts-ignore`); `tsconfig.build.json` excludes harness/tests so the mapping is a no-op for emit.
  Documented build/check order: kit build → persist build → persist typecheck (persist typecheck is in fact
  independent of persist/dist).

## 10. Exact commands run (Windows PowerShell, from workspace root) + exit codes

```powershell
# from workspace root — pnpm.cmd (NOT pnpm). Dev deps added to packages/persist/package.json directly,
# then installed via a single `pnpm.cmd install` (single root pnpm-lock.yaml; no second package manager).
pnpm.cmd install                                              # 0
pnpm.cmd install --frozen-lockfile                            # 0
pnpm.cmd -F @ghostsync/kit build                              # 0
pnpm.cmd -F @ghostsync/persist typecheck                      # 0
pnpm.cmd -F @ghostsync/persist test                           # 0  (38 unit tests passed)
pnpm.cmd -F @ghostsync/persist build                          # 0
pnpm.cmd -F @ghostsync/persist build:harness                  # 0
pnpm.cmd -F @ghostsync/persist exec playwright install chromium  # 0  (Chrome for Testing 158.0.8127.18)
pnpm.cmd -F @ghostsync/persist test:browser                   # 0  (15 Chromium tests passed)
pnpm.cmd -F @ghostsync/kit test                               # 0  (112 SDK tests unchanged)
git diff --check                                              # 0
git status --short --branch                                   # 0
```

Review follow-up round (the four flush/skip/lifecycle/read-guard fixes; Chromium 158.0.8127.18, Playwright
1.65.0 / chromium-1254):

```powershell
pnpm.cmd -F @ghostsync/persist typecheck                      # 0
pnpm.cmd -F @ghostsync/persist test                           # 0  (48 unit tests passed — 38 + 10 new)
pnpm.cmd -F @ghostsync/persist build                          # 0
pnpm.cmd -F @ghostsync/persist build:harness                  # 0
pnpm.cmd -F @ghostsync/persist test:browser                   # 0  (21 Chromium tests passed — 15 + 6 new)
pnpm.cmd -F @ghostsync/kit test                               # 0  (112 SDK tests unchanged)
git diff --check                                              # 0  (clean; only LF→CRLF warnings)
git status --short --branch                                   # 0  (staged review-ZIP index intact; new changes unstaged)
```

Review follow-up 2 (immediate-flush-retry / terminal-txn-event / onStateChange-guard / clean-checkout
typecheck; Chromium 158.0.8127.18, Playwright 1.65.0 / chromium-1254), run IN THIS ORDER:

```powershell
pnpm.cmd -F @ghostsync/kit build                              # 0
pnpm.cmd -F @ghostsync/persist build                          # 0
pnpm.cmd -F @ghostsync/persist typecheck                      # 0  (also verified with dist deleted → still 0)
pnpm.cmd -F @ghostsync/persist test                           # 0  (50 unit tests passed)
pnpm.cmd -F @ghostsync/persist build:harness                  # 0
pnpm.cmd -F @ghostsync/persist test:browser                   # 0  (23 Chromium tests passed)
pnpm.cmd -F @ghostsync/kit test                               # 0  (112 SDK tests unchanged)
git diff --check                                              # 0  (clean; only LF→CRLF warnings)
git status --short --branch                                   # 0  (staged review-ZIP index intact; new changes unstaged AM/??)
```

Observed terminal transaction / disposal event order (test-side instrumentation, both unit and Chromium):
`["tx:abort", "lock:release", "dispose:resolve"]`.

## Coverage matrix

| Requirement | Tasks | Tests (run) |
| --- | --- | --- |
| REQ-BP-001 | 2.1, 1.1 | 9.1, 9.6 |
| REQ-BP-002 | 4.1, 4.2, 2.2 | 9.7, 9.2, 9.5b |
| REQ-BP-003 | 3.2, 5.1, 5.2, 5.3, 5.4 | 9.8, 9.3, 9.4 |
| REQ-BP-004 | 6.1, 6.2 | 9.9, 9.5 |
| REQ-BP-005 | 7.1, 7.2, 7.3 | 9.10, 9.11, 9.5b |
| REQ-BP-006 | 2.2, 2.3, 3.1, 3.2, 5.3 | 9.11, 9.2, 9.5b |
| REQ-BP-007 | 8.1, 8.2, 9.6–9.12 | 9.12 (matrix) + all `e2e/*` |
| NFR-BP-001 (Kit purity) | 1.1 | `@ghostsync/kit test` still 112 (unchanged) |
| NFR-BP-005 (full-state, no log) | 5.2 | 9.8, 9.12 |
| NFR-BP-006 (size bound/checksum) | 2.2 | 9.2, 9.5b |

## Verification (executed)

- [x] 11.1 `git diff --check` — exit 0, clean (only cosmetic LF→CRLF warnings on `.gitignore`,
  `docs/progress.md`, `pnpm-lock.yaml`).
- [x] 11.2 `git status --short --branch` — exit 0; only permitted paths changed: ` M .gitignore`,
  ` M docs/progress.md`, ` M pnpm-lock.yaml`, `?? .kiro/specs/browser-persistence/`, `?? packages/persist/`
  (plus pre-existing untracked `.agents/`, left untouched). Nothing committed.
