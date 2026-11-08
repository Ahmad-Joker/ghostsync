# browser-persistence — Requirements

Status: **IMPLEMENTED & VERIFIED** on branch `feat/browser-persistence`, baseline `d53452f`.
`@ghostsync/persist` (`packages/persist`) is built, unit-tested (38 Node/Vitest tests on fake-indexeddb +
real `crypto.subtle`), and browser-verified (15 Playwright tests in real Chromium —
Chrome for Testing 158.0.8127.18, playwright chromium v1254 — with real IndexedDB, SHA-256, and Web Locks).
The Kit's 112 tests remain unchanged. Nothing was committed in this step (the caller handles git).

**Five implementation clarifications (below) OVERRIDE any conflicting earlier prose** and are reflected in
this document, `design.md`, and `tasks.md`:
1. `dispose()` is a first-class `PersistSession` method (idempotent, non-durable discard); `close()` on a
   failed final save rejects `CloseFailedError` and enters a **recovery-only** state (exportBytes() + reads
   survive; all mutation routes — incl. `collection(adapter)`, which can write schema meta — reject).
2. The generation counter is initialized from the VALIDATED stored sequence (a non-negative safe integer);
   the current dirty revision is distinguished from the snapshot currently saving; a skipped stale write
   never falsely reports newer bytes saved; `maxBytes` is enforced BEFORE writes too.
3. The Web Lock name unambiguously includes BOTH `dbName` and `storageKey`; `ifAvailable:true` with no
   silent unlocked fallback; acquisition/open failures release all acquired resources; a late IDB-open
   success after an earlier rejection closes the abandoned connection.
4. Safe restore validates shape before `bytes.length`, enforces size before hashing/decoding, and seeds via
   a FRESH PUBLIC replica through `applyUpdate` (not a thrown constructor), destroying that accessible
   replica if restore rejects.
5. The browser harness is a minimal **Vite** build/serve setup consuming the BUILT package entries; the
   harness loads with networking ON then OFF for edit/import/flush; same-key contention uses TWO PAGES in
   the SAME browser context + origin. Cold offline loading (service workers / asset caching) remains a later
   milestone and is NOT claimed.

## Summary

This milestone specifies the **smallest reliable browser-persistence** foundation for GhostSync: a
**separate IndexedDB persistence package** that lets an already-loaded browser page **save and restore**
a GhostSync Kit replica, with **networking disabled**, so that both legacy scalar data (`root` map) and
structured records (`ghostsync:records:v1` map) survive a page reload and the replica still converges
through SDK updates after restore.

The persistence package is a new workspace package under `packages/` (chosen name: **`@ghostsync/persist`**,
`packages/persist`). It keeps **all browser-storage dependencies out of `packages/kit`** — the Kit stays a
pure in-memory CRDT engine (architecture steering: storage is pluggable and separate from merge). The
package wraps the Kit's existing public API (`createKit().createReplica(documentId, seedBytes?)`,
`replica.exportState()`, `replica.applyUpdate(carrier)`) and persists **full-state snapshots** of
`exportState().bytes` (which, per the SDK implementation, already serialize **both** top-level maps and any
pending out-of-order updates). We deliberately avoid update-log / compaction machinery (justified in
NFR-BP-005).

The deliverable is a **minimal browser test harness** (a static page plus a Playwright spec), **not** an
application UI. FieldLedger, PatchBoard, and Studio remain untouched. The SDK's 112 passing tests and eight
fast-check properties are preserved (this milestone adds a new package; it does not edit `packages/kit`).

### Scope boundary (honest)

This milestone proves **data persistence and editing in an already-loaded browser page with networking
disabled**. It does **NOT** implement **cold offline loading** (cached application assets, service worker)
and must not claim to. Cold offline loading is a later, bounded **Phase-4** milestone. There is **no server
sync and no hidden network dependency**: the harness runs with the browser context offline and asserts no
network requests are required.

### Assumptions

1. The SDK public surface is exactly as read at `d53452f`: `Kit.createReplica(documentId, seedBytes?)`,
   `Replica.exportState(): TransportUpdate` (`{ documentId, kind: "full", bytes: Uint8Array }`),
   `Replica.applyUpdate(carrier: unknown): ApplyOutcome` (`{ ok: true } | { ok: false, reason }`),
   `Replica.subscribe(listener): Unsubscribe`, `Replica.collection<T>(adapter)`, `Collection.listResults()`,
   `Replica.getState()`, `Replica.destroy()`. The persistence package consumes only this surface.
2. `exportState().bytes` is a full-state Yjs update (`Y.encodeStateAsUpdate(doc)`) that captures **both** the
   `root` and `ghostsync:records:v1` maps and **pending out-of-order updates** (confirmed in the SDK
   implementation progress notes). Restoring via `createReplica(documentId, bytes)` reproduces the observable
   projection **and** keeps pending updates for later integration.
3. `applyUpdate` returns `{ ok: true }` for an accepted update **including** an accepted out-of-order
   (pending) update and an accepted no-op; an accepted out-of-order update **may not fire** a change
   notification (central to REQ-BP-004). A rejected update returns `{ ok: false, reason }` and does **not**
   mutate state.
4. The target browser is **Chromium** (via Playwright). IndexedDB is **per-origin, per-profile**. The Web
   Locks API (`navigator.locks`) is available in Chromium and is a browser built-in (no dependency).
5. `replicaId` (the durable local identity) is distinct from the Yjs session `clientID`, which changes on
   every `new Y.Doc()` and is therefore unusable as durable local identity.

---

## Functional Requirements

Requirement IDs are stable: **REQ-BP-001 … REQ-BP-007**. Acceptance criteria use EARS phrasing and are
numbered **AC-BP-00X-N**. Each requirement names at least one **planned** test (nothing is executed in
planning).

### REQ-BP-001 — Identity and isolation (collision-safe storage key)

The package SHALL derive a **collision-safe storage key** from three components — an **application
namespace** (`app`), a **logical `documentId`**, and a **stable local `replicaId`** — so that two replicas
of the **same** logical document persist to **separate** storage and reloading one replica reopens **its
own** data. `replicaId` SHALL be distinct from the Yjs session `clientID`.

- **AC-BP-001-1** WHEN the package opens a replica with `{ app, documentId, replicaId }`, the system SHALL
  compute a single storage key string `k = esc(app) + SEP + esc(documentId) + SEP + esc(replicaId)` using a
  NUL-introducer escape (reusing the Kit's collision-safe escaping approach) so that no two distinct
  `(app, documentId, replicaId)` triples can collide into one key.
- **AC-BP-001-2** WHEN two replicas share the same `app` and `documentId` but differ in `replicaId`, the
  system SHALL store them under **distinct** keys, and reloading either SHALL restore only that replica's
  own bytes.
- **AC-BP-001-3** WHEN a stored record exists, its stored value SHALL carry `app`, `documentId`, and
  `replicaId` as explicit fields so a mismatch between the computed key and the stored identity is
  detectable (and treated as an invalid record per REQ-BP-006).
- **AC-BP-001-4** WHERE the caller does not supply a `replicaId`, the system SHALL generate one via
  `crypto.randomUUID()` and SHALL NOT derive it from the Yjs `clientID`; a generated `replicaId` SHALL be
  returned to the caller so it can be persisted and reused across reloads.
- **AC-BP-001-5** The design SHALL document that IndexedDB is **per-origin and per-profile**: two browser
  profiles, or two origins, never share storage even for identical keys, and isolation across origins /
  profiles is a browser guarantee the package relies on (it does not and cannot cross those boundaries).
- Planned test: `identity-isolation.spec.ts` (Playwright) — two replicas, same `documentId`, different
  `replicaId`; each edits distinct values, flushes, reloads; each restores only its own state; key strings
  asserted distinct. Plus a Node unit `storage-key.test.ts` for escaping collision cases.

### REQ-BP-002 — Opening and restoring (async open; validate before ready)

The package SHALL expose an **asynchronous** open API that loads and **validates** stored bytes **before**
exposing a ready replica. No replica handle SHALL be handed out until restore completes, so an early edit
can never be silently overwritten by a later-arriving restoration. A **corrupt** stored record SHALL
produce a **visible, recoverable** error — never an automatic empty-document replacement or deletion.

- **AC-BP-002-1** WHEN `openReplica(options)` is called, the system SHALL return a `Promise` that resolves
  to a ready session **only after** the stored record (if any) has been read, validated, and seeded into the
  replica via `createReplica(documentId, bytes)`.
- **AC-BP-002-2** WHILE the open promise is pending, the system SHALL NOT expose any replica handle or
  session object to the caller, so there is no window in which an early edit could be overwritten by a later
  restore (open-then-ready ordering; no queue needed because the handle does not exist yet).
- **AC-BP-002-3** IF no stored record exists for the key, THEN the system SHALL open a **fresh** replica
  (no seed bytes) and resolve as ready with `restored: false`.
- **AC-BP-002-4** IF a stored record exists and validates, THEN the system SHALL seed the replica with its
  `bytes` and resolve as ready with `restored: true`.
- **AC-BP-002-5** IF a stored record exists but is **corrupt** (fails format, version, identity, or
  checksum validation, or `applyUpdate`/seed rejects the bytes), THEN the system SHALL reject the open
  promise with a **typed, recoverable** `PersistenceError("InvalidRecordError")` that names the failing check
  and SHALL leave the stored record **untouched** (no auto-wipe, no empty-document substitution, no delete).
- **AC-BP-002-5a** The system SHALL detect malformed seed bytes by wrapping `createReplica(documentId,
  bytes)` in `try/catch`: the Kit does **not** pre-validate seed bytes (its `ReplicaImpl` constructor calls
  `Y.applyUpdate` unguarded), so a decode throw inside the constructor is the detection mechanism and SHALL
  be mapped to `InvalidRecordError`. On that failure the system SHALL clean up the temporary replica/`Y.Doc`
  and the IndexedDB connection, **release any acquired Web Lock**, and leave the corrupt stored record
  **preserved** (no empty-state replacement, no delete).
- **AC-BP-002-6** WHEN open rejects due to a corrupt record, the caller SHALL be able to choose an explicit
  recovery action (e.g. open fresh under a new `replicaId`, or inspect/export the raw bytes); the package
  SHALL NOT make that choice silently.
- Planned test: `open-restore.spec.ts` (Playwright) — fresh open (`restored:false`); seeded open
  (`restored:true`, legacy + structured state intact); corrupt-record open rejects with the typed error and
  the stored bytes remain byte-identical afterward.

### REQ-BP-003 — Saving and flush (serialized saves; state machine; generation guard)

The package SHALL serialize saves, expose an explicit **save-state machine** (`dirty` / `saving` / `saved` /
`error`) and a `flush()` method, mark `saved` **only after the IndexedDB transaction completes**
(`transaction.oncomplete`, not request `onsuccess`), prevent an **older** async save from overwriting a
**newer** snapshot via a monotonic generation number, and specify retry and safe close/disposal.

- **AC-BP-003-1** WHEN a local edit or a routed import marks the session dirty, the system SHALL transition
  to `dirty` and schedule a save; concurrent saves SHALL be **serialized** (at most one in-flight write per
  key; a new dirty mark during a write schedules a follow-up save after completion).
- **AC-BP-003-2** WHEN a save begins, the system SHALL capture the **current** full-state snapshot
  (`exportState().bytes`) and a monotonically increasing **generation** number `g`, and transition to
  `saving`.
- **AC-BP-003-2a** The system SHALL compute the record checksum with **SHA-256** (`crypto.subtle.digest`)
  and SHALL **await** the digest to completion **before** opening the `readwrite` IndexedDB transaction. The
  transaction body SHALL perform **only synchronous** work — read-compare the stored `sequence`, then `put`
  the record with the **precomputed** bytes and checksum — and SHALL NOT `await` hashing, timers, network,
  or any unrelated promise inside the active transaction (which would let it auto-commit and raise
  `TransactionInactiveError`). Concretely: the `objectStore.put` request is issued, then
  `transaction.oncomplete` resolves the save.
- **AC-BP-003-3** The system SHALL mark `saved` for generation `g` **only** in the IndexedDB
  `transaction.oncomplete` handler; a request-level `onsuccess` SHALL NOT be treated as durable. A
  transaction **abort/error** SHALL leave the session **visibly unsaved** (`error` state; the live in-memory
  replica preserved), never a silent `saved`.
- **AC-BP-003-4** The system SHALL serialize the **whole** capture → hash → write pipeline (a single-flight
  save queue / generation counter) so an **older** hashed snapshot can NEVER overwrite a **newer** one. IF a
  save for generation `g` would land **after** a save for generation `g' > g` has already been persisted,
  THEN the IndexedDB layer SHALL **drop** the stale write (the stored record's `sequence` field SHALL never
  regress) and report `{ written: false }`.
- **AC-BP-003-4a** (skipped-write truthfulness) WHEN a write transaction completes but the generation guard
  **skipped** the `put` (`written === false`, i.e. a newer-or-equal `sequence` already sits on disk), the
  session SHALL NOT advance its persisted marker and SHALL NOT report `saved` for that generation — the
  current in-memory bytes never reached storage. The session SHALL instead surface an explicit
  `TransactionAbortError` (stale-generation conflict), PRESERVE the in-memory edit, and PRESERVE the newer
  stored record unchanged (no clobber, no data loss, no false `saved`). A later caller-triggered retry
  re-attempts the save.
- **AC-BP-003-5** `flush()` SHALL return a `Promise` that resolves **only after** the most recent dirty
  state has been persisted (its transaction completed) and the state machine is `saved`, or rejects/settles
  in `error` if that write failed. EVERY `flush()` SHALL settle (resolve or reject) — **no stranded waiter**
  — even when a save fails or succeeds **synchronously before its first `await`** (e.g. the pre-write
  `maxBytes` check): the flush waiter is registered BEFORE a save is triggered so a synchronous settlement is
  observed. An **IMMEDIATE** retry `flush()` — called with NO `Promise.resolve()`/timer/polling delay
  inserted between the first (settled) flush and the retry, i.e. while the failed save worker is still
  unwinding — SHALL be serviced, not stranded: the system SHALL COORDINATE flush-waiter settlement with
  save-worker cleanup so that when a worker finishes unwinding it schedules a FRESH save for any
  still-pending flush waiter. Both IMMEDIATE repeated failure (the retry flush rejects again — bounded) and
  an IMMEDIATE same-session retry after a transient failure (the retry flush resolves `saved`) SHALL settle
  (neither hangs), and dirty data SHALL NOT be lost.
- **AC-BP-003-6** IF a save fails, THEN the system SHALL transition to `error`, SHALL retry on the next
  explicit `flush()` or next dirty mark (bounded, caller-triggered retry — no silent infinite background
  loop), and SHALL preserve the live in-memory replica unchanged (REQ-BP-006).
- **AC-BP-003-7** On a **successful** `close()`/`dispose()` the system SHALL attempt a final flush, then
  release the IndexedDB connection, the held Web Lock, and the Kit replica (`replica.destroy()`); after a
  successful close the session SHALL reject further operations with a typed `ClosedError`. (Failed-close
  behavior and the sole Web Lock release rule are defined in AC-BP-005-7, which governs when the lock is
  released in both cases.)
- **AC-BP-003-8** The design SHALL document that closing a tab does **not** guarantee async writes complete:
  on `pagehide`/`visibilitychange` the package attempts a **best-effort** flush but SHALL NOT promise
  durability on unload.
- Planned test: `save-flush.spec.ts` (Playwright) — edit → `flush()` resolves only after
  `transaction.oncomplete`; the prescribed save path succeeds with a **real async SHA-256 digest + real
  IndexedDB**; a **delayed/slow hash** for an older generation cannot clobber a newer save (ordering); a
  **transaction abort** surfaces `error` with the live replica preserved; a forced stale-generation write is
  dropped (sequence does not regress); state machine transitions observed via an exposed `onStateChange`.
  Plus a unit `generation-guard.test.ts`. Plus `flush-lifecycle.test.ts` (Node unit) and
  `lifecycle-fixes.spec.ts` (Playwright/Chromium) covering: repeated-failure flush (no stranded waiter),
  **same-session** retry after a transient failure, the **skipped-write** stale-generation conflict (no false
  `saved`, edit + stored record survive), and terminal ordering (dispose during an active transaction /
  hashing, immediate same-key reopen, concurrent close/dispose). `errors-lifecycle.spec.ts` drives a REAL
  mid-transaction IndexedDB abort (test-only harness hook) to exercise genuine transaction recovery on the
  ORIGINAL session — correcting the earlier version that disposed the failed session and opened a new one.

### REQ-BP-004 — Persist every accepted update (routed import)

Because the SDK change subscription reports only **observable key changes** and an accepted **out-of-order**
update may remain **pending without notifying**, subscriptions alone cannot guarantee persistence. The
package SHALL therefore route imports through a **persistence-session import method** that wraps
`replica.applyUpdate` and marks the session **dirty on every `ok` result** — including a pending or no-op
accept — so a save follows every successful import. **Rejected** imports SHALL NOT persist rejected bytes.

- **AC-BP-004-1** WHEN `session.applyUpdate(carrier)` is called, the system SHALL call the underlying
  `replica.applyUpdate(carrier)` and return its `ApplyOutcome` unchanged.
- **AC-BP-004-2** IF the outcome is `{ ok: true }` (any accept, including an out-of-order pending accept or a
  no-op accept that fires **no** change notification), THEN the system SHALL mark the session `dirty` and
  schedule a save, so the newly-accepted update is persisted regardless of whether a notification fired.
- **AC-BP-004-3** IF the outcome is `{ ok: false, reason }` (`invalidCarrier` / `documentIdMismatch` /
  `malformedUpdate`), THEN the system SHALL NOT mark dirty and SHALL NOT write the rejected bytes; the
  stored record SHALL be unchanged.
- **AC-BP-004-4** The system SHALL ALSO subscribe to `replica.subscribe` and mark dirty on local-origin
  change events, so local edits are persisted; the subscription is a **supplement** for local writes, never
  the sole guarantee for imports.
- **AC-BP-004-5** The package SHALL expose reads and exports through **explicit accessors** on the session
  (`get`/`has`/`getState`/`collection`/`subscribe`/`exportState`/`exportStateVector`/`exportDiff`) and SHALL
  document that **all imports must be routed through `session.applyUpdate`** (the only supported import
  path). **Resolved decision:** the raw `Replica` object is **deliberately NOT exposed** (there is no
  `session.replica`), so a consumer cannot reach `replica.applyUpdate` and silently bypass the persistence
  guarantee.
- Planned test: `routed-import.spec.ts` (Playwright) — import a dependent (out-of-order) update that returns
  `ok:true` but fires **no** notification; assert the session still becomes dirty and the pending update
  survives `flush()` + reload; later deliver the prerequisite and assert integration/convergence. A rejected
  import leaves the stored record byte-identical.

### REQ-BP-005 — Concurrent access (same storage key, two tabs)

The package SHALL define what happens when **two tabs** open the **same** storage key by choosing
**EXCLUSIVE single-writer sessions** for this milestone: there is **no reader role**, **no reader-mutation
path**, and **no automatic ownership transfer**. A session acquires an **exclusive Web Lock** for the
storage identity **before** reading/restoring its IndexedDB record and holds it for the whole session
lifetime. Separate replica keys (safe) SHALL NOT be conflated with multiple writers to **one** key (the
hazard). Unsupported-capability behavior SHALL be explicit.

- **AC-BP-005-1** WHEN a session opens a storage key, the system SHALL acquire an **exclusive** Web Lock
  (`navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, ...)` where `lockName`
  derives from the storage key) **BEFORE** reading/restoring that key's IndexedDB record, and SHALL hold the
  lock for the **whole session lifetime** — through all saves and the final close.
- **AC-BP-005-2** IF another session already owns the lock for that key (non-waiting acquisition fails),
  THEN `openReplica` SHALL reject with a typed `StorageInUseError` and return **no usable session**. The
  failed opener SHALL perform **zero** storage writes — it SHALL NOT read-modify, mutate, or overwrite the
  stored record.
- **AC-BP-005-3** A caller MAY retry `openReplica` after the owner closes (lock released). A successful
  retry SHALL reload the **latest committed** record from IndexedDB while holding the lock, and SHALL NEVER
  reuse a previous stale in-memory snapshot.
- **AC-BP-005-4** Separate `replicaId`s SHALL map to separate keys and separate locks, so two tabs each
  editing their **own** replica of the same `documentId` both acquire their own locks and are **both**
  writers (no contention) — this safe case SHALL NOT be blocked.
- **AC-BP-005-5** WHERE `navigator.locks` is unavailable (the API is absent), the system SHALL reject
  `openReplica` with a typed `UnsupportedEnvironmentError` and SHALL NOT silently fall back to an
  unprotected writer. (There is **no** degraded single-writer fallback and **no** `degraded` flag.)
- **AC-BP-005-6** WHERE IndexedDB itself is unavailable (private mode / disabled), the system SHALL reject
  `openReplica` with a typed `StorageUnavailableError` (REQ-BP-006) rather than silently running without
  persistence.
- **AC-BP-005-7** The system SHALL define **close-failure** behavior explicitly: a failed FINAL save during
  `close()` SHALL NOT silently report a successful durable closure. `close()` SHALL reject with a typed
  `CloseFailedError` and the session SHALL enter a **recovery-only** state in which `exportBytes(): Uint8Array`
  (and read-only accessors) continue to work — returning the unsaved in-memory snapshot — while
  `set`/`delete`/`applyUpdate`/`flush` **and** `collection(adapter)` (which can write schema meta, so it is
  a mutation) reject with `ClosedError`. A subsequent explicit `dispose()` (or page unload) SHALL release
  the Web Lock and resources; calling `close()` again while recovery-only rejects `CloseFailedError`.
- **AC-BP-005-7a** (Web Lock release — the single authoritative rule referenced by AC-BP-003-7): on a
  **successful** `close()` the held Web Lock SHALL be released as part of close; on a **failed** `close()`
  (`CloseFailedError`) the lock SHALL be **retained** to protect the still-exportable record and SHALL be
  released only on a later explicit `dispose()` or page unload.
- **AC-BP-005-7b** (`dispose()` — clarification 1): `PersistSession` SHALL expose `dispose(): Promise<void>`
  — an explicit, **idempotent**, **non-durable** discard that releases resources/ownership (replica,
  IndexedDB connection, Web Lock, listeners, page-lifecycle handlers) WITHOUT claiming unsaved data was
  saved. After a successful `close()` or `dispose()`, every operational method AND every previously-returned
  collection handle SHALL reject `ClosedError`, `exportBytes()` SHALL reject `ClosedError`, and no queued
  save/hash continuation SHALL write after ownership release (an active write transaction is settled/aborted
  before release). Repeated `close()`/`dispose()` is a safe no-op.
- **AC-BP-005-7c** (terminal ordering + consistency) The write lifecycle SHALL settle on the transaction's
  ACTUAL terminal event — `transaction.oncomplete` (success) or `transaction.onabort` (terminal failure) —
  NOT on `transaction.onerror` alone (which can fire BEFORE `onabort`) and NOT solely on `db.close()` or an
  early-rejected write promise; request/transaction errors MAY be recorded but SHALL be surfaced through the
  terminal-event rejection. Terminal teardown SHALL finish an ACTIVE write transaction — `abort()` it or
  await its settlement — and await the in-flight save routine BEFORE releasing the Web Lock, so no
  transaction can complete and publish `saved` (or advance the persisted marker) AFTER ownership is released;
  NO save-state notification SHALL be emitted once terminal teardown begins. The terminal operation SHALL
  await the **actual** Web Lock release (the `navigator.locks` request settling), so an immediate
  **same-key reopen** can acquire the lock (proving it was freed). The OBSERVED order SHALL be
  **transaction complete/abort → ownership (Web Lock) release → dispose resolution**. CONCURRENT `close()`
  and `dispose()` calls SHALL settle **consistently** on a single shared teardown without hanging.
- **AC-BP-005-7d** (read/subscription guards — clarification 1) The session's **readable** guard SHALL apply
  to the collection READ routes (`get`/`getResult`/`list`/`listResults`/`has`) as well as its mutation
  routes, INCLUDING on a collection handle captured while the session was open: after a terminal
  `close()`/`dispose()` those reads SHALL reject with a typed `ClosedError`, never a raw destroyed-Yjs-doc
  error. **Recovery-only** reads (after a FAILED close, while the recovery-only session lives) remain allowed.
  Operational subscription registration — BOTH `subscribe` (change events) AND `onStateChange` (save-state
  events) — SHALL be rejected with a typed `ClosedError` after terminal disposal (recovery-only registration
  stays allowed).
- Test: `concurrent-same-key.spec.ts` (Playwright, **two pages in the SAME browser context + origin** so
  storage and Web Locks are truly shared — separate contexts would be an isolation test, not contention) —
  a second same-key session **cannot open** (`StorageInUseError`) while the first holds it; two **different**
  replica keys open independently and concurrently; after the owner flushes and closes, a **retry** open
  restores its **latest** saved data (not a stale snapshot); a **failed acquisition performs ZERO storage
  writes** (the stored record is asserted byte-unchanged); and an **unsupported-capability** environment
  produces `UnsupportedEnvironmentError`. It SHALL also cover the **failed-close recovery path**: when the
  final save during `close()` fails, `close()` rejects with `CloseFailedError`, `exportBytes()` still returns
  the unsaved snapshot, `set`/`applyUpdate`/`flush` reject `ClosedError`, and the Web Lock is retained until
  an explicit `dispose()` (then released, allowing a retry open).

### REQ-BP-006 — Errors and storage lifecycle

The package SHALL handle the full IndexedDB error surface with typed, recoverable errors and SHALL
**preserve the live in-memory replica** after a save failure. There SHALL be **no** silent `saved` state on
failure and **no** automatic destructive reset.

- **AC-BP-006-1** IF the database fails to open, THEN `openReplica` SHALL reject with
  `DatabaseOpenError` and SHALL NOT create or mutate any stored record.
- **AC-BP-006-2** IF a write transaction **aborts** (including `QuotaExceededError`), THEN the session SHALL
  transition to `error`, SHALL surface a typed `TransactionAbortError` / `QuotaExceededError`, SHALL keep the
  live replica and its in-memory state **intact**, and SHALL leave the previously-stored record unchanged.
- **AC-BP-006-3** IF IndexedDB is unavailable (private mode / disabled / `indexedDB === undefined`), THEN
  `openReplica` SHALL reject with `StorageUnavailableError` **before** creating a replica (no partial state).
- **AC-BP-006-4** IF an `upgradeneeded`/`versionchange` is **blocked** by another connection, THEN the
  system SHALL surface a typed `BlockedError` and SHALL listen for `versionchange` on open connections to
  close gracefully and allow the upgrade, rather than hanging silently.
- **AC-BP-006-5** IF a stored record is **invalid** (bad format, unknown/greater `version`, identity
  mismatch, failed checksum, or seed-reject), THEN the system SHALL treat it per REQ-BP-002-5 (visible,
  recoverable; no auto-wipe) and the invalid structured records SHALL remain discoverable via
  `collection.listResults()` after a successful restore of a record that itself validates.
- **AC-BP-006-6** The system SHALL NEVER drop user data because a write failed: a failed save keeps the live
  replica authoritative and retries on the next `flush()`/dirty mark.
- Planned test: `errors-lifecycle.spec.ts` (Playwright) — simulate a transaction abort (and, where feasible,
  a quota failure) and assert `error` state, live state intact, retry succeeds; `StorageUnavailableError`
  path; a blocked upgrade surfaces `BlockedError`. Plus unit `record-codec.test.ts` for version/identity/
  checksum validation branches.

### REQ-BP-007 — Real browser verification (Playwright + Chromium, actual IndexedDB)

Acceptance evidence SHALL come from a **Playwright/Chromium** run exercising **actual IndexedDB**. A Node
mock alone (jsdom / fake-indexeddb) SHALL NOT be treated as establishing browser persistence; a Node unit
layer MAY exist for fast feedback, but the **acceptance evidence is the Playwright run**. Tests SHALL use
**bounded timeouts** and **observable readiness** (await a ready signal / expect a persisted marker), never
fixed sleeps.

- **AC-BP-007-1** The harness SHALL be built by a minimal **Vite** setup that consumes the BUILT public
  package entries (a plain static server cannot execute the harness TypeScript with bare `@ghostsync/*`
  imports). The Playwright spec SHALL load the built harness with networking ENABLED, then set the browser
  context **offline** (`context.setOffline(true)`) for all edit/import/flush assertions — re-enabling
  networking ONLY to (re)load uncached harness assets on a reload and disabling it again afterwards — and
  SHALL assert persistence/editing need no network. This proves persistence + editing in an already-loaded
  page with networking disabled, NOT cold offline loading (clarification 5).
- **AC-BP-007-2** The plan SHALL verify, in Chromium with real IndexedDB: (a) legacy **and** structured
  edits survive reload after `flush()`; (b) separate local `replicaId`s stay isolated; (c) a restored
  replica still **converges** through SDK updates; (d) a **pending dependent** update survives save/reload
  and later integrates when its prerequisite arrives; (e) accepted **remote** imports persist; (f) a save
  **failure** stays visible and retry works; (g) concurrent same-key access follows the chosen policy;
  (h) **invalid records** remain discoverable via `listResults()` after reload.
- **AC-BP-007-3** Readiness SHALL be observable: the page SHALL expose a `window.__gs` test API whose
  methods resolve on real lifecycle events (open resolved, `flush()` resolved, `transaction.oncomplete`),
  and the spec SHALL `await` those rather than sleeping.
- **AC-BP-007-4** Each Playwright test SHALL set a **bounded** timeout (e.g. `test.setTimeout(15_000)`) and
  SHALL fail (not hang) if a readiness signal does not arrive.
- **AC-BP-007-5** The spec SHALL state explicitly that this run establishes **data persistence + editing in
  a loaded page, networking disabled** — NOT cold offline loading (assets/service worker), which is a later
  Phase-4 milestone.
- Planned test: the full `apps`-free harness under `packages/persist/harness/` plus the Playwright specs
  named in REQ-BP-001..006 and a top-level `persistence-e2e.spec.ts` that runs the reload-survival matrix
  (a)–(h).

---

## Non-Functional Requirements

- **NFR-BP-001 — Kit purity.** `packages/kit` SHALL NOT gain any browser-storage dependency or `node:`/DOM
  storage import. All IndexedDB/Web Locks code lives in `@ghostsync/persist`. The Kit's 112 tests and eight
  properties remain unedited and in scope.
- **NFR-BP-002 — Strict TypeScript.** The package SHALL compile under a `strict` tsconfig consistent with
  the Kit (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `NodeNext`,
  `verbatimModuleSyntax`), with **no `any`** by default. Browser types come from `"lib": ["ES2022", "DOM"]`
  (the package targets the browser, unlike the Kit which uses `ES2022` only). Because the harness (included
  by `tsconfig.json`) imports the package's PUBLIC entry `@ghostsync/persist`, `typecheck` SHALL be correct
  on a **clean checkout** WITHOUT relying on a stale/pre-built `dist`: the typecheck config SHALL resolve the
  self-package import to SOURCE via a `paths` mapping (`"@ghostsync/persist": ["./src/index.ts"]`) rather
  than depending on generated output. This SHALL NOT weaken typing (no `any`, no loosened options, no
  `@ts-ignore`); the build config (`tsconfig.build.json`) excludes `harness`/`tests` and `src` does not
  self-import the package, so the mapping changes no emitted output.
- **NFR-BP-003 — Minimal dependencies.** The package SHALL prefer **raw IndexedDB** (dependency-free) and
  the **Web Locks** browser built-in. Any added dependency SHALL be justified and pinned exactly (see design
  U-decisions). The pinned package manager `pnpm@10.34.9` SHALL be used; no other package manager or
  lockfile is introduced.
- **NFR-BP-004 — No network.** The package SHALL make no outbound network request; persistence and editing
  work fully offline. (Server sync is out of scope.)
- **NFR-BP-005 — Full-state snapshots, no update log (justified).** Persistence SHALL store a single
  **full-state snapshot** per key (`exportState().bytes`), overwritten each save. We reject an update-log +
  compaction design for this milestone: full-state is simplest, is already produced by the Kit, inherently
  captures both maps and pending updates, needs no compaction scheduler, and bounds each record to one
  current snapshot. An append-log would add ordering, compaction, and corruption-recovery complexity with no
  benefit at this milestone's small document sizes. Revisit only if snapshot size becomes a measured problem.
- **NFR-BP-006 — Security (untrusted bytes).** Stored bytes SHALL be treated as **untrusted** on read
  (steering: every capsule is untrusted). The package SHALL **bound size before decoding** (reject a record
  whose `bytes.length` exceeds a configured cap, default 8 MiB, before calling `applyUpdate`/seed), and
  SHALL **validate format → version → document identity → checksum** before seeding. The integrity checksum
  SHALL be **SHA-256** (`crypto.subtle.digest`); there is no FNV-1a alternative. The design SHALL state
  that a **checksum detects corruption; it does not authenticate the sender** — records are integrity-checked,
  not authenticated. No secrets, tokens, or PII SHALL be written to the repo, commits, or build output;
  stored values hold only Yjs bytes and non-secret identity metadata.

---

## Acceptance Criteria (consolidated, testable)

Every acceptance criterion above (AC-BP-001-1 … AC-BP-007-5) is specific and testable and maps to a named
planned test in the design's traceability table. Summary of the headline criteria:

1. Collision-safe key `esc(app)+SEP+esc(documentId)+SEP+esc(replicaId)`; same-doc different-replicaId →
   separate storage; `replicaId ≠ clientID`. (REQ-BP-001)
2. Async `openReplica` validates before ready; no handle before restore; corrupt record → visible,
   recoverable error, no auto-wipe; corrupt records preserved, never replaced with empty state. (REQ-BP-002)
3. Serialized capture→hash→write pipeline; SHA-256 hash awaited **before** the `readwrite` txn; synchronous
   txn body; `dirty/saving/saved/error`; `saved` only on `transaction.oncomplete`; abort → visibly unsaved;
   generation guard drops stale writes; `flush()`; retry; best-effort unload. (REQ-BP-003)
4. Routed `session.applyUpdate` marks dirty on every `ok` (including pending/no-op); rejected imports are not
   persisted; the raw `Replica` is not exposed (no `session.replica`); direct `replica.applyUpdate` is
   unreachable through the session. (REQ-BP-004)
5. Same-key = **exclusive single-writer** via a non-waiting exclusive Web Lock acquired before restore and
   held for the whole session; contention → `StorageInUseError` with zero writes; no reader role, no
   ownership transfer, no degraded fallback; absent Web Locks → `UnsupportedEnvironmentError`; separate keys
   both writers; close-failure → `CloseFailedError` with state still exportable. (REQ-BP-005)
6. Typed recoverable errors for open/abort/unavailable/quota/blocked/invalid; live replica preserved on save
   failure; no silent `saved`; no destructive reset; invalid records discoverable via `listResults`.
   (REQ-BP-006)
7. Playwright/Chromium real-IndexedDB acceptance run covering survival matrix (a)–(h); offline context;
   observable readiness; bounded timeouts; a Node mock alone is not acceptance evidence. (REQ-BP-007)

**Executed.** The suites named here are IMPLEMENTED and RUN: 38 Node/Vitest unit tests (fast feedback on
fake-indexeddb + a labeled Web Locks mock + real `crypto.subtle`) and 15 Playwright/Chromium acceptance
tests (real IndexedDB + SHA-256 + Web Locks). The Node mock layer is explicitly labeled NOT acceptance
evidence; the Playwright/Chromium run is the acceptance evidence. Exact commands, exit codes, and totals are
recorded in `docs/progress.md`.

---

## Out of Scope

- **Cold offline loading** — cached application assets and service-worker support (later Phase-4 milestone).
  This milestone requires an already-loaded page.
- **Server synchronization** or any network transport (file/QR capsule tiers are separate milestones).
- **Capsule codec / checksummed transfer envelopes** beyond the minimal integrity checksum on the stored
  IndexedDB record (a stored-record checksum, not a transport capsule).
- **Application UIs** — FieldLedger, PatchBoard, Studio are untouched; only a minimal test harness is built.
- **Sender authentication** — records are integrity-checked (corruption detection), not authenticated.
- **Update-log / compaction / snapshot history** — deferred (NFR-BP-005); single full-state snapshot per key.
- **Multi-origin / multi-profile sync** — IndexedDB isolation across origins/profiles is a browser boundary
  the package relies on, not something it bridges.
