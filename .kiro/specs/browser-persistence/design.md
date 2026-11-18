# browser-persistence — Design

Status: **IMPLEMENTED & VERIFIED.** Branch `feat/browser-persistence`, baseline `d53452f`.
`packages/persist` is built (src-only `.d.ts` like the Kit), unit-tested (38 Vitest tests on fake-indexeddb
+ real `crypto.subtle`), harness-built via Vite, and browser-verified (15 Playwright tests in real Chromium,
Chrome for Testing 158.0.8127.18). Dev deps pinned exactly: `@playwright/test@1.65.0`, `fake-indexeddb@6.2.7`,
`vite@8.3.6` (plus the Kit's `typescript@7.0.2`, `@types/node@24.19.2`, `vitest@5.1.0`). Nothing committed
in this step. The five implementation clarifications in `requirements.md` are reflected throughout.

## Overview

`@ghostsync/persist` (`packages/persist`) is a new, browser-targeted workspace package that adds
**IndexedDB full-state persistence** around a GhostSync Kit replica while keeping **all** browser-storage
dependencies out of `packages/kit`. It wraps the Kit's existing public surface — read verbatim from
`packages/kit/src` at `d53452f`:

```ts
// from @ghostsync/kit (actual signatures at d53452f)
createKit(): Kit
interface Kit { createReplica(documentId: string, seedBytes?: Uint8Array): Replica }
interface Replica {
  readonly documentId: string;
  set(key: string, value: Scalar): void;
  delete(key: string): void;
  get(key: string): Scalar | undefined;
  has(key: string): boolean;
  exportState(): TransportUpdate;                 // { documentId, kind: "full", bytes: Uint8Array }
  exportStateVector(): StateVector;
  exportDiff(remoteStateVector: unknown): ExportDiffResult;
  collection<T>(adapter: EntityAdapter<T>): Collection<T>;
  subscribe(listener: ChangeListener): Unsubscribe;
  applyUpdate(carrier: unknown): ApplyOutcome;    // { ok:true } | { ok:false, reason }
  getState(): State;
  destroy(): void;
}
type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" | "invalidCarrier" | "malformedUpdate" };
interface TransportUpdate { readonly documentId: string; readonly kind: "full" | "diff"; readonly bytes: Uint8Array }
interface ChangeEvent { readonly documentId: string; readonly origin: "local" | "remote" }
```

The persistence package persists `exportState().bytes` (a full-state `Y.encodeStateAsUpdate(doc)` that,
per the SDK implementation, serializes **both** the `root` and `ghostsync:records:v1` maps **and** pending
out-of-order updates) and restores by passing those bytes as `seedBytes` to `createReplica(documentId,
bytes)`. Merge stays a pure function in the Kit; this package is pluggable **storage** only (architecture
steering).

## Technology stack (locked once approved)

- **Language/tooling:** TypeScript `strict` (matching the Kit: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `NodeNext`, `verbatimModuleSyntax`), `target ES2022`, `lib ["ES2022","DOM"]`
  (the package runs in the browser and needs DOM/IndexedDB/Web Locks lib types). ESM, `type: module`.
- **Storage:** **raw IndexedDB** (dependency-free). No `idb` wrapper (see U1).
- **Concurrency:** **Web Locks API** (`navigator.locks`) — a browser built-in, no dependency.
- **CRDT engine:** `@ghostsync/kit` (workspace dependency, consumed via its public ESM entry).
- **Browser test runner:** **Playwright** (`@playwright/test`) running **Chromium** — real IndexedDB.
- **Node unit runner (fast feedback only, not acceptance):** **Vitest** (already in the repo tool-chain)
  with **`fake-indexeddb`** for codec/generation/state-machine unit tests. A Node mock is explicitly **not**
  acceptance evidence for browser persistence (REQ-BP-007).

Installed exact pins (verified against the registry for Node 24 / pnpm 10.34.9 compatibility):
`@playwright/test@1.65.0`, `fake-indexeddb@6.2.7`, `vite@8.3.6`. `typescript@7.0.2`, `@types/node@24.19.2`,
and `vitest@5.1.0` reuse the Kit's exact versions. See "Dependency choices" for rationale.

## Public API surface

All types live in `packages/persist/src`. The package's ESM entry (`index.ts`) re-exports the public
surface; consumers `import { openReplica } from "@ghostsync/persist"`.

```ts
/** Durable identity + app namespace for one persisted replica. */
export interface ReplicaIdentity {
  /** Application namespace, e.g. "fieldledger" | "patchboard". */
  readonly app: string;
  /** Logical document id (same value passed to the Kit). */
  readonly documentId: string;
  /**
   * Stable LOCAL replica identity. Distinct from the Yjs session clientID
   * (which changes per Y.Doc). If omitted, generated via crypto.randomUUID()
   * and returned on the ready session so the caller can persist + reuse it.
   */
  readonly replicaId?: string;
}

export interface OpenOptions extends ReplicaIdentity {
  /** IndexedDB database name. Default: "ghostsync". */
  readonly dbName?: string;
  /** Reject a stored record whose bytes exceed this many bytes BEFORE decoding. Default: 8 MiB. */
  readonly maxBytes?: number;
  /** Optional save-state observer. */
  readonly onStateChange?: (state: SaveState, info: SaveStateInfo) => void;
}

export type SaveState = "dirty" | "saving" | "saved" | "error";

export interface SaveStateInfo {
  readonly sequence: number;           // last persisted generation (0 if none)
  readonly error?: PersistenceError;   // present when state === "error"
}

/** Async open: read + validate stored bytes, THEN hand out a ready session. */
export function openReplica(options: OpenOptions): Promise<PersistSession>;

export interface PersistSession {
  readonly identity: Required<ReplicaIdentity>;   // replicaId resolved (generated if not supplied)
  readonly storageKey: string;                     // the computed collision-safe key
  readonly restored: boolean;                      // true if seeded from a stored record
  readonly state: SaveState;

  // --- reads / exports (safe to call directly) ---
  get(key: string): Scalar | undefined;
  has(key: string): boolean;
  getState(): State;
  collection<T>(adapter: EntityAdapter<T>): Collection<T>;
  exportState(): TransportUpdate;
  exportStateVector(): StateVector;
  exportDiff(remoteStateVector: unknown): ExportDiffResult;
  subscribe(listener: ChangeListener): Unsubscribe;

  // --- local edits (mark dirty, schedule save) ---
  set(key: string, value: Scalar): void;
  delete(key: string): void;

  // --- the ONLY supported import path (persistence guarantee) ---
  applyUpdate(carrier: unknown): ApplyOutcome;

  // --- durability control ---
  flush(): Promise<void>;                          // resolves only after transaction.oncomplete (or rejects in error)
  onStateChange(listener: (s: SaveState, i: SaveStateInfo) => void): Unsubscribe;
  /**
   * Final best-effort flush, release the Web Lock, close the IDB connection, destroy the replica.
   * If the FINAL save fails, close() REJECTS with CloseFailedError (never a silent durable close) and the
   * session enters a RECOVERY-ONLY state: exportBytes() and read-only accessors keep working while
   * set/delete/applyUpdate/flush reject ClosedError. The Web Lock is retained across recovery-only and
   * releases only on a later explicit dispose() / page unload (see AC-BP-005-7a).
   */
  close(): Promise<void>;
  /**
   * Explicit, IDEMPOTENT, NON-durable discard (clarification 1 / AC-BP-005-7b). Releases the replica, the
   * IndexedDB connection, the Web Lock, listeners, and page-lifecycle handlers WITHOUT claiming unsaved
   * data was saved. Used to release ownership after a failed close() (recovery-only) or to abandon a
   * session. After dispose() every operational method, every previously-returned collection handle, and
   * exportBytes() reject ClosedError; no queued save continuation may write after release.
   */
  dispose(): Promise<void>;
  /**
   * Export the current in-memory snapshot bytes (Y.encodeStateAsUpdate). Available while the session is
   * open AND in the recovery-only state after a FAILED close() — the recovery path (AC-BP-005-7). Only a
   * SUCCESSFUL close()/dispose() makes it reject ClosedError.
   */
  exportBytes(): Uint8Array;
}

/** Typed, recoverable persistence error. `code` discriminates the failing check. */
export class PersistenceError extends Error {
  readonly code:
    | "DatabaseOpenError"
    | "StorageUnavailableError"
    | "UnsupportedEnvironmentError"  // navigator.locks absent — no unprotected fallback
    | "StorageInUseError"            // another session owns the exclusive lock for this key
    | "TransactionAbortError"
    | "QuotaExceededError"
    | "BlockedError"
    | "InvalidRecordError"           // format/version/identity/checksum/oversized/seed-reject
    | "CloseFailedError"             // final save during close() failed; state still exportable
    | "ClosedError";
  readonly cause?: unknown;
  constructor(code: PersistenceError["code"], message: string, cause?: unknown);
}
```

**Supported-vs-unsupported access (REQ-BP-004-5).** The session exposes the replica's **reads and exports**
directly (`get`/`has`/`getState`/`collection`/`exportState`/`exportStateVector`/`exportDiff`/`subscribe`)
and **local edits** (`set`/`delete`) that both mark the session dirty. Imports MUST go through
`session.applyUpdate`. The package does **not** hand out the raw `Replica` object, so a consumer cannot
reach `replica.applyUpdate` and silently bypass persistence. (A debug escape hatch is intentionally omitted;
if ever needed it would be documented as unsupported.)

### Example consumer usage (open → edit → import → flush → reload → restore)

```ts
import { openReplica } from "@ghostsync/persist";

// First load: no replicaId stored yet → one is generated and returned.
const session = await openReplica({ app: "fieldledger", documentId: "incident-42" });
localStorage.setItem("gs:replicaId:incident-42", session.identity.replicaId); // caller persists it

session.set("status", "open");                     // legacy map edit → dirty
const incidents = session.collection(incidentAdapter);
incidents.put("i1", { id: "i1", title: "Leak", priority: 2 }); // structured edit → dirty

const outcome = session.applyUpdate(remoteCarrier); // routed import → dirty on ok (even pending/no-op)
await session.flush();                              // resolves after transaction.oncomplete
await session.close();

// After a RELOAD (same origin+profile), reuse the SAME replicaId to reopen THIS replica's data:
const replicaId = localStorage.getItem("gs:replicaId:incident-42")!;
const restored = await openReplica({ app: "fieldledger", documentId: "incident-42", replicaId });
restored.restored === true;                         // seeded from the stored snapshot
restored.get("status") === "open";                  // legacy survived
restored.collection(incidentAdapter).get("i1");     // structured survived
```

## Storage key format

```
storageKey = esc(app) + SEP + esc(documentId) + SEP + esc(replicaId)
```

- `SEP` = `"\u001f"` (Unit Separator), `esc()` = the NUL-introducer escape reused from the Kit's
  `packages/kit/src/keys.ts` (`\u0000 → \u0000\u0000`, `\u0001 → \u0000\u0001`, `\u001f → \u0000\u001f`).
  This is **copied into the persistence package** (a tiny pure function) rather than imported: the Kit's
  `esc()` is **module-private** (not exported from `packages/kit/src/keys.ts` or the public `index.ts`), so
  copying is the only option without a Kit change. **Ownership (NIT-5):** this `esc`/`SEP` codec is an
  **independent persistence-package concern** used **only** for the IndexedDB `keyPath`; it is deliberately
  **decoupled** from the Kit's records-map codec and never interoperates with Kit records-map keys. If the
  Kit's escape ever changes, the two may diverge without any correctness impact (only the key string would
  differ). `storage-key.test.ts` **pins the expected key strings** so any drift is caught. It guarantees no
  two distinct `(app, documentId, replicaId)` triples collide into one key.
- `replicaId` is the **durable** local identity: supplied by the caller or generated with
  `crypto.randomUUID()`. It is **never** derived from the Yjs session `clientID` (which changes per `Y.Doc`).
- Two replicas of the same `documentId` with different `replicaId` → different `storageKey` → separate
  records; reloading one reopens only its own bytes.
- **Origin/profile boundary:** IndexedDB is per-origin and per-profile. The package relies on this browser
  guarantee; identical keys in different origins/profiles never share data, and the package does not bridge
  those boundaries.

## Storage record / version format

- **Database name:** `"ghostsync"` (overridable via `dbName`).
- **Object store:** `"replicas"`, `keyPath: "storageKey"` (in-line key; no autoIncrement).
- **DB version:** `1`. Upgrades go through `onupgradeneeded`; a blocked upgrade surfaces `BlockedError`.
- **Stored value shape:**

```ts
interface StoredRecord {
  readonly storageKey: string;     // keyPath — esc(app)+SEP+esc(documentId)+SEP+esc(replicaId)
  readonly version: 1;             // record FORMAT version (independent of DB version)
  readonly app: string;            // identity (REQ-BP-001-3) — enables mismatch detection
  readonly documentId: string;
  readonly replicaId: string;
  readonly bytes: Uint8Array;      // exportState().bytes (full-state; both maps + pending updates)
  readonly sequence: number;       // monotonic generation; stale-write guard (REQ-BP-003-4)
  readonly checksum: string;       // integrity checksum over bytes (NOT authentication)
  readonly savedAt: number;        // Date.now() at the completing transaction (informational)
}
```

- **Checksum:** **SHA-256 via `crypto.subtle.digest`** over `bytes`, stored as hex. This is the single
  chosen algorithm — available in the browser, dependency-free, strong corruption detection; there is **no**
  FNV-1a alternative. Because `crypto.subtle.digest` is asynchronous, the checksum is **awaited to
  completion before** any `readwrite` transaction opens (see "Lifecycle" save ordering below). Documented:
  a checksum **detects corruption; it does not authenticate the sender.**
- **Validation order on read (REQ-BP-002-5, NFR-BP-006):** (1) **size bound** — reject if
  `bytes.length > maxBytes` **before** any decode; (2) **format** — the value is an object with the expected
  fields and types; (3) **version** — `version === 1`; an unknown/greater version → `InvalidRecordError`
  (never auto-wipe); (4) **document identity** — `app`/`documentId`/`replicaId` match the open options and
  the computed `storageKey`; (5) **checksum** — recomputed over `bytes` (SHA-256) equals `checksum`;
  (6a) **sequence** — a non-negative safe integer; and (6b) **seed** — the stored `bytes` apply cleanly.
  **Seed via the PUBLIC boundary (clarification 4):** rather than relying on cleaning up a private `Y.Doc`
  inside a constructor that threw, `openReplica` creates a FRESH PUBLIC replica with `createReplica(documentId)`
  (no seed), applies the validated stored bytes through its public `applyUpdate({ documentId, bytes })`
  boundary, and — if that returns `{ ok: false }` — `destroy()`s that **accessible** replica and rejects
  with `InvalidRecordError(reason)`. This preserves pending updates and allows clean cleanup without
  touching `packages/kit`. On any failure the IndexedDB connection is closed, the **acquired Web Lock is
  released**, and the corrupt stored record is **preserved** (no empty-state replacement, no delete). Only
  after all checks pass is the session exposed as ready. (The alternative `createReplica(documentId, bytes)`
  seed path would also throw on malformed bytes — the Kit does not pre-validate seed bytes — but the public
  `applyUpdate` route gives cleaner, constructor-free cleanup and is the one used.) Any failure → reject the open promise with a typed, recoverable
  error and leave the stored record untouched.

## Lifecycle and the save-state machine

```
openReplica ──(read+validate)──▶ READY(restored?) ──▶ [ dirty ⇄ saving ⇄ saved ]
                                          │                     │
                                          └────── error ◀───────┘ (save/txn failure; live replica intact)
                                   flush() awaits saved
                                   close() → best-effort flush → release lock+db → replica.destroy()
```

- **dirty:** a local edit or a routed `applyUpdate` that returned `ok` set the flag; a save is scheduled.
- **saving (save ordering — REQ-BP-003-2a):** the **whole** capture → hash → write pipeline is serialized
  as a single-flight save (one in-flight; a dirty mark during a write schedules a follow-up). A save
  captures the **immutable** snapshot `bytes = exportState().bytes` and `sequence = ++generation`, then
  **awaits** `crypto.subtle.digest("SHA-256", bytes)` to completion **BEFORE** opening the `readwrite`
  transaction on `replicas`. The transaction body does **only synchronous** work — read-compare the stored
  `sequence`, then `put` the record with the **precomputed** bytes + checksum. Nothing is `await`ed inside
  the active transaction (no hashing, timers, network, or unrelated promise), so it cannot auto-commit mid-
  flight (`TransactionInactiveError`). Concretely: issue the `objectStore.put` request, then
  `transaction.oncomplete` resolves the save.
- **saved:** reached **only** in `transaction.oncomplete` for that `sequence`. Request `onsuccess` is not
  treated as durable.
- **Generation guard (REQ-BP-003-4):** the write is a read-modify-write inside one transaction — read the
  current record **via the request callback** (an async `get` is not a synchronously returned value), and
  **skip** `put` if the existing `sequence >= thisSequence` (a newer snapshot already landed). `sequence`
  never regresses, so an older hashed snapshot (e.g. one delayed by a slow digest) can never overwrite a
  newer one.
- **Generation restoration + truthful state (clarification 2):** the generation counter is initialized from
  the VALIDATED stored `sequence` on open (validated as a non-negative safe integer), so a reopened session
  never reuses a sequence that could be skipped as stale. The session tracks the **current dirty revision**
  separately from the **snapshot currently saving**: `saved` is reported only when the latest dirty
  generation is persisted, so an OLDER transaction completing never reports the whole session saved while a
  NEWER edit remains pending. A **skipped stale write** (`writeRecord` returns `{ written: false }` because
  the RMW guard found a newer-or-equal stored sequence) means the current in-memory bytes never reached disk,
  so the session does **not** advance the persisted marker and does **not** report `saved` for that
  generation — it surfaces an explicit `TransactionAbortError` (stale-generation conflict), PRESERVES the
  in-memory edit AND the newer stored record (no clobber, no false `saved`), and lets a caller-triggered
  retry re-attempt the save (AC-BP-003-4a). Captured bytes are **immutable** (a `.slice()` copy). `maxBytes`
  is enforced
  **before** opening the write transaction too, so the package never reports saving a snapshot the next open
  would reject as oversized; on violation the in-memory data is preserved and the typed error is exposed.
  `onStateChange` callback exceptions are isolated from persistence outcomes. A failed save stays in `error`
  and retries only on the next `flush()`/dirty mark — never a tight auto-retry loop.
- **error:** any transaction **abort** / quota / open failure transitions here, surfaces a typed
  `PersistenceError`, and **keeps the live replica intact**. An abort/error leaves the session **visibly
  unsaved** — never a silent `saved`. Retry happens on the next `flush()` or next dirty mark
  (caller-triggered; no silent infinite loop).
- **flush():** resolves after the latest dirty generation's transaction completes (`saved`), or rejects in
  `error`. The flush waiter is **registered before** a save is triggered, so a save that settles
  **synchronously before its first `await`** (e.g. the pre-write `maxBytes` check) still resolves/rejects the
  waiter — **no flush ever strands a waiter** (AC-BP-003-5). An **IMMEDIATE** retry `flush()` (no
  `Promise.resolve()`/timer/polling inserted between the first settled flush and the retry) can arrive WHILE
  the failed save worker (`#runSave`) is still unwinding; at that moment `#inFlight` is still set, so the
  retry declines to schedule and its waiter would strand. The save worker therefore COORDINATES with waiter
  settlement: its `finally` clears `#inFlight` FIRST, then — if the session still owns its connection, is not
  terminating, and a flush waiter's target is still unpersisted (`#hasPendingFlushWaiter()`) — schedules a
  FRESH save to service the retry. That fresh save rejects again on a repeated failure (bounded: the rejected
  waiter is removed, so no further reschedule) or resolves `saved` on a transient failure that is now gone.
  Repeated flushes after a failure and a **same-session** retry after a transient failure both settle; dirty
  data is retained.
- **Unload:** on `pagehide`/`visibilitychange→hidden` the session attempts a best-effort flush. The design
  **does not promise** async writes complete on tab close (AC-BP-003-8).
- **close()/dispose() terminal ordering (AC-BP-005-7c):** the write lifecycle in `idb.writeRecord` settles
  on the transaction's ACTUAL terminal event — `transaction.oncomplete` (success) or `transaction.onabort`
  (terminal failure) — NOT on `request.onerror`/`transaction.onerror` (which can fire before the terminal
  event, and `tx.onerror` precedes `tx.onabort`); request/tx errors are recorded and surfaced through the
  abort rejection (`readRecord` is consistent). Because of this, on a successful `close()` (or any
  `dispose()`), teardown marks the session terminating (suppressing further state notifications and
  cancelling queued/hash continuations), **finishes an active write transaction** — `abort()`s it or awaits
  its settlement — and awaits the in-flight save routine (which now resolves only on the terminal event)
  BEFORE touching the connection or the Web Lock, so no transaction can complete and publish `saved` (or
  advance the marker) after ownership release. It then `replica.destroy()`s, closes the IDB connection, and
  releases the Web Lock, **awaiting the actual `navigator.locks` release** so an immediate same-key reopen can
  acquire it. The OBSERVED order is **transaction complete/abort → Web Lock release → dispose resolution**
  (asserted explicitly by a deterministic unit + Chromium regression using test-only instrumentation).
  CONCURRENT `close()`/`dispose()` share one teardown promise and settle consistently without hanging. After
  a successful close every operation rejects with `ClosedError` — including a new `onStateChange`
  registration (AC-BP-005-7d).
  **Close-failure rule (AC-BP-005-7 / AC-BP-005-7a):** if the final save fails, `close()` **rejects with
  `CloseFailedError`** rather than reporting a durable close and the session enters a **recovery-only** state:
  `exportBytes()` (and read-only accessors) keep returning the unsaved in-memory snapshot while
  `set`/`delete`/`applyUpdate`/`flush` reject `ClosedError`. The Web Lock is **retained** across this
  recovery-only state (protecting the still-exportable record) and is released only on a later explicit
  `dispose()` or page unload — this is the single authoritative lock-release rule.

## Persist-every-accepted-update (routed import)

`session.applyUpdate(carrier)` calls `replica.applyUpdate(carrier)` and returns the `ApplyOutcome`
unchanged. On **`{ ok: true }`** — **including** an accepted out-of-order (pending) update and an accepted
no-op that fires **no** `afterTransaction`/change notification — the session marks `dirty` and schedules a
save. This is the crux of REQ-BP-004: because the SDK subscription only fires on observable key deltas, a
pending accept would otherwise never be persisted. Routing through the session makes dirtiness follow the
**`applyUpdate` return value**, not the notification. On **`{ ok: false, reason }`** the session does
nothing (no dirty, no write), so rejected bytes are never stored.

Local edits (`session.set`/`delete`) also mark dirty directly, and `session.subscribe` is additionally
wired to mark dirty on `origin === "local"` events as a supplement. The authoritative guarantee for imports
is the routed-return-value rule, not the subscription.

## Concurrency (same storage key) — EXCLUSIVE single-writer

For this milestone the policy is **exclusive single-writer sessions**. There is **no reader role**, **no
reader-mutation path**, and **no automatic ownership transfer** anywhere in the package. The session's
mutating surface (`set`/`delete`/`applyUpdate`) belongs only to the single owner, because only an owner can
open a session at all.

- **Acquire-before-restore (AC-BP-005-1).** On open, before reading/restoring the IndexedDB record, the
  session requests an **exclusive, non-waiting** lock:
  `navigator.locks.request(lockName, { mode: "exclusive", ifAvailable: true }, cb)` where
  `lockName = "ghostsync:lock:" + esc(dbName) + SEP + storageKey` — it unambiguously includes BOTH the
  `dbName` and the `storageKey` (clarification 3), so two sessions in different databases but the same key
  never share a lock. The lock is held for the **whole session lifetime** — through every save and the
  final close — and released only on `close()`/dispose or page unload. Acquisition/open failures RELEASE
  all acquired resources; a late IndexedDB-open success after an earlier blocked/error rejection closes the
  abandoned connection rather than leaking it.
- **Contention rejects with zero writes (AC-BP-005-2).** `ifAvailable: true` is non-waiting: if another
  session already owns the lock, the callback receives `null`, and `openReplica` **rejects with
  `StorageInUseError`** and returns no usable session. On this failed acquisition the opener performs
  **zero** storage writes — it does not read-modify, mutate, or overwrite the stored record.
- **Retry reloads the latest committed record (AC-BP-005-3).** A caller MAY retry `openReplica` after the
  owner closes (lock released). A successful retry **re-reads the latest committed record from IndexedDB**
  while holding the lock; it never reuses a stale in-memory snapshot from a prior attempt.
- **Separate keys are both writers (AC-BP-005-4).** Different `replicaId`s ⇒ different `storageKey` ⇒
  different `lockName`; two tabs editing their own replicas of the same `documentId` both acquire their own
  locks and both write. The hazard is *multiple writers to one key*, which exclusive ownership prevents; it
  is **not** conflated with the safe separate-key case.
- **Chosen over BroadcastChannel leader election** because Web Locks gives OS-backed, automatically-released
  exclusive ownership (no heartbeat, no split-brain on crash) and is available in Chromium — the acceptance
  target. (U4.)
- **Web Locks absent (AC-BP-005-5):** if `navigator.locks` is undefined, `openReplica` **rejects with
  `UnsupportedEnvironmentError`**. There is **no** degraded single-writer fallback and **no** `degraded`
  flag — the package never silently runs an unprotected writer.
- **Close-failure (AC-BP-005-7 / AC-BP-005-7a):** a failed final save during `close()` rejects with
  `CloseFailedError` and enters the recovery-only state — `exportBytes()` keeps returning the unsaved
  snapshot while mutating/flush ops reject `ClosedError`; the lock is retained and releases only on a later
  explicit `dispose()` / page unload (the single lock-release rule).
- **IndexedDB unavailable (AC-BP-005-6 / REQ-BP-006-3):** `openReplica` rejects with
  `StorageUnavailableError` before creating a replica.

## Error handling (concrete, per operation)

| Operation | Failure condition | Recoverable? | Caller receives | Logged? |
| --- | --- | --- | --- | --- |
| `openReplica` DB open | `indexedDB.open` `onerror`/`onblocked` | recoverable | reject `PersistenceError("DatabaseOpenError"|"BlockedError")` | no console; error carried on rejection |
| `openReplica` storage missing | `indexedDB === undefined` / throws | recoverable | reject `PersistenceError("StorageUnavailableError")` | no |
| `openReplica` Web Locks absent | `navigator.locks === undefined` | recoverable | reject `PersistenceError("UnsupportedEnvironmentError")`; no unprotected fallback; no writes | no |
| `openReplica` key in use | non-waiting exclusive lock callback gets `null` | recoverable | reject `PersistenceError("StorageInUseError")`; **zero** storage writes; stored record untouched | no |
| `close()` final save | final flush transaction aborts | recoverable | reject `PersistenceError("CloseFailedError")`; in-memory replica + `exportBytes()` survive; lock released on dispose/unload | no |
| `openReplica` oversized record | `bytes.length > maxBytes` (checked pre-decode) | recoverable | reject `PersistenceError("InvalidRecordError")`, stored record untouched | no |
| `openReplica` bad format/version/identity/checksum | validation fails | recoverable | reject `InvalidRecordError` naming the failing check; stored record untouched (no auto-wipe) | no |
| `openReplica` seed reject | `createReplica(documentId, bytes)` throws | recoverable | reject `InvalidRecordError`; stored record untouched | no |
| save transaction | `transaction.onabort` (incl. quota) | recoverable | state → `error`; `onStateChange` gets `TransactionAbortError`/`QuotaExceededError`; **live replica intact**; retry on next flush/dirty | no |
| save skipped (stale-generation conflict) | `writeRecord` returns `{ written: false }` (newer sequence on disk) | recoverable | state → `error` with `TransactionAbortError`; persisted marker NOT advanced; in-memory edit + newer stored record both preserved (no clobber, no false `saved`); retry on next flush/dirty (AC-BP-003-4a) | no |
| collection READ route (`get`/`getResult`/`list`/`listResults`/`has`) after terminal close/dispose — incl. a handle captured while open | session not readable | fatal for session | throw typed `PersistenceError("ClosedError")` (never a raw destroyed-Yjs-doc error); recovery-only reads still allowed (AC-BP-005-7d) | no |
| `subscribe` **or** `onStateChange` registration after terminal close/dispose | session not readable | fatal for session | throw typed `PersistenceError("ClosedError")` (recovery-only registration still allowed) (AC-BP-005-7d) | no |
| upgrade | `onblocked` by another connection | recoverable | `BlockedError`; open connections listen for `versionchange` to close and let the upgrade proceed | no |
| routed `applyUpdate` reject | `{ ok:false, reason }` | n/a (expected) | outcome returned unchanged; **not** persisted | no |
| any op (incl. `exportBytes()`/reads/`collection`) after a **successful** `close()` or `dispose()` | resources released | fatal for session | throw/reject `PersistenceError("ClosedError")` | no |
| `set`/`delete`/`applyUpdate`/`flush` **or** `collection(adapter)` after a **failed** `close()` | recovery-only state (collection open writes schema meta ⇒ a mutation) | fatal for session | reject `PersistenceError("ClosedError")` | no |
| `exportBytes()` / reads after a **failed** `close()` | recovery-only state | recoverable | returns the unsaved in-memory snapshot (lock retained until `dispose()`/unload) | no |
| `close()` while recovery-only | prior final save failed | recoverable | reject `PersistenceError("CloseFailedError")`; use `dispose()` to release | no |

The package does **not** write to `console` by default (NFR: no PII/secrets in output); errors travel as
typed values on promise rejections and `onStateChange`. A failed save **never** drops user data — the live
in-memory replica remains authoritative (REQ-BP-006-6).

### Input validation (each external input)

- **`OpenOptions.app` / `documentId`:** required, non-empty string; else `TypeError` synchronously from
  `openReplica`.
- **`OpenOptions.replicaId`:** optional string; if present must be non-empty; else generated.
- **`OpenOptions.maxBytes`:** optional positive integer; default 8 MiB.
- **Stored `bytes`:** untrusted; size-bounded before decode, then checksum-validated, then seed-validated.
- **`carrier` to `session.applyUpdate`:** passed straight to the Kit, which already validates `unknown`
  shape before decoding; the session trusts the Kit's `ApplyOutcome`.

### Invariant ownership

- **"`saved` ⟺ transaction completed AND the put was actually written"** — owned by the save routine (only
  `transaction.oncomplete` with `{ written: true }` sets `saved`; a completed-but-skipped write surfaces an
  error and never claims `saved` — AC-BP-003-4a). Chosen there because only the save routine observes both
  the IDB transaction lifecycle and the RMW guard's write/skip outcome.
- **"no state notification or write after ownership release"** — owned by terminal teardown (it marks the
  session terminating, aborts/awaits the active write transaction, and awaits the in-flight save before
  releasing the lock — AC-BP-005-7c). Chosen there because only teardown knows ownership is ending.
- **"stored `sequence` never regresses"** — owned by the write transaction's read-modify-write (skip put if
  stored `sequence ≥ thisSequence`). Owned there because atomicity requires the compare and the put to share
  one transaction.
- **"imports persist iff accepted"** — owned by `session.applyUpdate` (dirty on `ok`, nothing on `!ok`).
- **"single writer per key"** — owned by the exclusive, non-waiting Web Locks acquisition held for the whole
  session lifetime (no reader role, no transfer, no degraded fallback).
- **"saved only after hashing completes"** — owned by the save pipeline: `crypto.subtle.digest` is awaited
  before the `readwrite` transaction opens, so the transaction body stays synchronous and never auto-commits
  across an `await`.

## Proposed files (created later, NOT in this planning step)

Actual files created (all under `packages/persist/`):

```
packages/persist/
  package.json                 # @ghostsync/persist; dep @ghostsync/kit (workspace:*);
                               #   devDeps @playwright/test@1.65.0, fake-indexeddb@6.2.7, vite@8.3.6,
                               #   typescript@7.0.2, @types/node@24.19.2, vitest@5.1.0 (exact pins);
                               #   scripts: typecheck / test / build / build:harness / test:browser
  tsconfig.json                # strict; lib ["ES2022","DOM","DOM.Iterable"]; NodeNext; verbatimModuleSyntax;
                               #   paths {"@ghostsync/persist":["./src/index.ts"]} so the harness's self-import
                               #   typechecks against SOURCE — clean checkout needs no pre-built dist (NFR-BP-002)
  tsconfig.build.json          # src-only emit to dist (mirrors the Kit; excludes harness/tests → paths is a no-op here)
  vitest.config.ts             # node env + fake-indexeddb/Web-Locks-mock setup, fast unit feedback only
  vitest.setup.ts              # import "fake-indexeddb/auto" + installWebLocksMock() (labeled mock)
  vite.config.ts               # minimal harness build: root=harness, out=harness/dist (built entries)
  playwright.config.ts         # chromium project; webServer = vite preview; bounded timeouts; no sleeps
  src/
    index.ts                   # public ESM entry: openReplica, PersistenceError, types
    identity.ts                # ReplicaIdentity, esc()/SEP (copied), storageKey(), resolveIdentity(), lockName()
    record.ts                  # StoredRecord, sha256Hex, validateRecord(order shape→size→version→identity→checksum→sequence)
    idb.ts                     # raw IndexedDB open/upgrade; readRecord; writeRecord (settles on terminal tx event oncomplete/onabort, RMW guard)
    errors.ts                  # PersistenceError + code union + isPersistenceError
    locks.ts                   # exclusive non-waiting Web Locks acquisition (held whole session)
    types.ts                   # OpenOptions, PersistSession, GuardedCollection, SaveState, re-exported Kit types
    session.ts                 # openReplica + PersistSessionImpl: state machine, generation guard, routed
                               #   applyUpdate, guarded collection, flush/close/dispose, unload best-effort
  tests/                       # Node unit (fast feedback; NOT acceptance evidence) — 38 tests
    support/web-locks-mock.ts  # labeled single-process Web Locks mock
    support/incident-adapter.ts, support/fake-reset.ts
    storage-key.test.ts        # REQ-BP-001 escaping/collision/pinned strings
    record-codec.test.ts       # REQ-BP-002-5/006/NFR-BP-006 order + real SHA-256
    generation-guard.test.ts   # REQ-BP-003-4 stale-write drop; sequence monotonic
    state-machine.test.ts      # REQ-BP-003 transitions, restore, reopen cycles, isolation, close/dispose
    routed-import.unit.test.ts # REQ-BP-004 dirty-on-ok incl. pending/no-op; integrate on prerequisite
    open-restore.unit.test.ts  # REQ-BP-002/005/006 corrupt-preserve, oversize, contention, maxBytes-before-write
  harness/                     # minimal Vite browser harness (NOT an app UI)
    index.html                 # loads harness.ts; exposes window.__gs test API (observable readiness)
    harness.ts                 # wires openReplica + a FieldLedger-style adapter; resolves on real events
    dist/                      # Vite build output (gitignored)
  e2e/                         # Playwright specs (ACCEPTANCE evidence — real Chromium IndexedDB) — 15 tests
    helpers.ts                 # offline load/reload discipline + uniqueDbName
    identity-isolation.spec.ts # REQ-BP-001
    open-restore.spec.ts       # REQ-BP-002
    save-flush.spec.ts         # REQ-BP-003
    routed-import.spec.ts      # REQ-BP-004
    concurrent-same-key.spec.ts# REQ-BP-005 (TWO PAGES, SAME context+origin)
    errors-lifecycle.spec.ts   # REQ-BP-005/006 (failed close + recovery-only + dispose)
    persistence-e2e.spec.ts    # REQ-BP-007 survival matrix (a)/(c)/(e)/(h)
```

No `packages/kit/*`, `apps/*`, root `package.json`, `pnpm-workspace.yaml` (already globs `packages/*`), or
lockfile changes are part of this milestone's planning. (When implemented, `pnpm-workspace.yaml` already
covers `packages/*`, so no workspace edit is needed to add `packages/persist`.)

## Dependency choices (minimal; pinned; NOT installed now)

- **IndexedDB wrapper — NONE (raw IndexedDB).** (U1) Rationale: the surface we need (one object store,
  `get`/`put` in a `readwrite` transaction, `oncomplete`-gated durability, `onupgradeneeded`) is small and
  the `oncomplete`-vs-`onsuccess` distinction (REQ-BP-003-3) is clearer with raw IDB. Adding `idb` would be
  a dependency for little gain and would hide the transaction-completion semantics we specifically test.
- **Web Locks — NONE (browser built-in).** `navigator.locks`; no package.
- **`@ghostsync/kit`** — workspace dependency (`workspace:*`), the CRDT engine.
- **`@playwright/test@1.56.0`** (devDependency) — the only way to produce real-Chromium-IndexedDB acceptance
  evidence (REQ-BP-007). Chromium is installed via `playwright install chromium`. Pin verified against the
  current 1.56.x line; confirm at install time.
- **`fake-indexeddb@6.2.2`** (devDependency) — Node unit feedback only; explicitly NOT acceptance evidence.
- **`vitest`, `typescript`, `@types/node`** — reuse the versions already pinned by the Kit
  (`vitest@5.1.0`, `typescript@7.0.2`, `@types/node@24.19.2`) for tool-chain consistency.

### Exact future PowerShell commands (NOT run during planning)

```powershell
# from workspace root, Windows PowerShell — pnpm.cmd (NOT pnpm)
pnpm.cmd add -D --filter @ghostsync/persist "@playwright/test@1.56.0"
pnpm.cmd add -D --filter @ghostsync/persist "fake-indexeddb@6.2.2"
pnpm.cmd add -D --filter @ghostsync/persist "typescript@7.0.2" "@types/node@24.19.2" "vitest@5.1.0"
pnpm.cmd add    --filter @ghostsync/persist "@ghostsync/kit@workspace:*"
pnpm.cmd exec playwright install chromium
# Build/check order on a CLEAN checkout: the Kit must build first (persist consumes its dist); persist's
# own `typecheck` is INDEPENDENT of persist/dist because tsconfig.json maps `@ghostsync/persist` →
# ./src/index.ts (NFR-BP-002), so it is correct whether or not `persist build` has run. The canonical
# verify order below builds first regardless (kit build → persist build → persist typecheck → ...).
pnpm.cmd -F @ghostsync/kit build                  # tsc -p tsconfig.build.json (kit dist consumed by persist + harness)
pnpm.cmd -F @ghostsync/persist build              # tsc -p tsconfig.build.json
pnpm.cmd -F @ghostsync/persist typecheck          # tsc --noEmit -p tsconfig.json (self-types resolve to ./src, no stale dist needed)
pnpm.cmd -F @ghostsync/persist test               # vitest run (Node unit, fast feedback)
pnpm.cmd -F @ghostsync/persist build:harness      # vite build (harness/dist from built entries)
pnpm.cmd -F @ghostsync/persist exec playwright test   # ACCEPTANCE run (Chromium, real IndexedDB)
```

## How an external consumer imports the built package

`package.json` mirrors the Kit: `"type": "module"`, `"main"/"module": "./dist/index.js"`,
`"types": "./dist/index.d.ts"`, `"exports": { ".": { "types": "./dist/index.d.ts", "import":
"./dist/index.js" } }`, `"files": ["dist"]`. A consumer does
`import { openReplica } from "@ghostsync/persist"` and gets `dist/index.d.ts` types. The package runs only
in a browser (it uses IndexedDB / Web Locks); a Node consumer would need `fake-indexeddb`, and with no
`navigator.locks` `openReplica` rejects with `UnsupportedEnvironmentError` (no degraded fallback).

## Testability

- **Unit (Vitest + fake-indexeddb, Node — fast feedback, NOT acceptance):** storage-key escaping/collisions;
  record encode/decode + validation order (size→format→version→identity→checksum→seed); generation-guard
  stale-write drop; state-machine transitions; routed-import dirty-on-ok including pending/no-op.
- **Integration/acceptance (Playwright + Chromium, real IndexedDB — the acceptance evidence):** the survival
  matrix (a)–(h), isolation, async open+restore+corrupt-reject, flush/oncomplete, concurrent same-key
  ownership, error lifecycle. Readiness is observable via `window.__gs` (promises resolving on real
  open/flush/oncomplete), never sleeps; each test sets a bounded `test.setTimeout`.
- A design note states plainly: **a Node mock alone does not establish browser persistence**; the Vitest
  layer exists only for quick iteration, and REQ-BP-007 acceptance is the Playwright/Chromium run.

### Traceability (requirement → planned test)

| Requirement | Planned test(s) |
| --- | --- |
| REQ-BP-001 identity/isolation | `storage-key.test.ts` (unit) + `identity-isolation.spec.ts` (Playwright) |
| REQ-BP-002 async open/restore/validate | `open-restore.spec.ts` + `record-codec.test.ts` |
| REQ-BP-003 save/flush/state/generation | `save-flush.spec.ts` + `generation-guard.test.ts` + `state-machine.test.ts` |
| REQ-BP-004 routed import | `routed-import.spec.ts` + `routed-import.unit.test.ts` |
| REQ-BP-005 concurrent same-key | `concurrent-same-key.spec.ts` |
| REQ-BP-006 errors/lifecycle | `errors-lifecycle.spec.ts` + `record-codec.test.ts` |
| REQ-BP-007 real browser verification | `persistence-e2e.spec.ts` (matrix a–h) + all `e2e/*.spec.ts` |

## Decisions (U1–U6; U3 and U4 RESOLVED by this review pass)

- **U1 — IndexedDB access.** Options: raw IndexedDB vs `idb` wrapper. **Recommend: raw IndexedDB** —
  dependency-free and keeps the `oncomplete`-gated durability explicit.
- **U2 — Node unit mock.** Options: `fake-indexeddb` vs jsdom-only vs none. **Recommend: `fake-indexeddb`**
  for fast feedback, with a loud note that it is **not** acceptance evidence.
- **U3 — Checksum algorithm — RESOLVED: SHA-256 via `crypto.subtle`.** The single chosen algorithm;
  FNV-1a is **not** an option. Dependency-free in the browser, strong corruption detection; documented as
  integrity-only, not authentication. The async digest is awaited before any `readwrite` transaction opens.
- **U4 — Concurrency mechanism — RESOLVED: exclusive single-writer via Web Locks.** OS-backed exclusive
  ownership, auto-released on crash/close, available in the Chromium acceptance target. Non-waiting
  acquisition before restore, held the whole session. There is **no** BroadcastChannel fallback and **no**
  degraded unprotected-writer path: if `navigator.locks` is absent, open rejects with
  `UnsupportedEnvironmentError`.
- **U5 — replicaId generation.** Options: `crypto.randomUUID()` vs caller-mandatory. **Recommend: generate
  with `crypto.randomUUID()` when omitted and return it on the session**, so first-load works with zero
  caller bookkeeping while reloads reuse the stored id.
- **U6 — Harness hosting.** Options: `file://` vs Playwright `webServer` static server. **Recommend: a
  Playwright `webServer` serving `packages/persist/harness/`** with `context.setOffline(true)`, so the
  offline assertion is explicit and module imports resolve cleanly.

## Responses to review findings

The first design-and-tasks review (`.kiro/specs/browser-persistence/.review/review.md`) returned
**CHANGES_REQUESTED** with **2 MEDIUM + 4 NIT**. All six are addressed in this revision; no `packages/kit`,
`apps/*`, manifests, lockfile, steering, or `.agents/` were touched, and this remains PLANNED-only.

1. **MEDIUM-1 — reader-role mutation unspecified (silent-loss hazard).** Resolved by choosing **exclusive
   single-writer sessions**: removed the reader role, reader-mutation path, and automatic ownership transfer
   entirely. Open acquires a **non-waiting exclusive Web Lock before restore** and holds it for the whole
   session; same-key contention rejects with `StorageInUseError` and performs zero writes; a retry after the
   owner closes reloads the latest committed record; absent Web Locks rejects with
   `UnsupportedEnvironmentError` (no degraded fallback). See "Concurrency" and AC-BP-005-1..7.
2. **MEDIUM-2 — async checksum vs IndexedDB transaction lifetime.** Standardized on **SHA-256**; stated the
   ordering invariant: the digest is **awaited before** opening the `readwrite` transaction, whose body is
   purely synchronous (read-compare-put with precomputed bytes+checksum); saved only on
   `transaction.oncomplete`; abort → visibly unsaved. The whole capture→hash→write pipeline is single-flight
   so a stale generation is dropped. See "Lifecycle" save ordering and AC-BP-003-2a/3/4.
3. **NIT-3 — single-member `concurrency` option.** Removed the `OpenOptions.concurrency?: "single-writer"`
   field; exclusive single-writer is the only policy, not a caller choice. Removed `SaveStateInfo.degraded`
   and the `role` field that only existed for the reader/degraded paths.
4. **NIT-4 — `session.replica` read handle.** REQ-BP-004-5 now drops the `session.replica` example and
   states the resolved decision: reads/exports via explicit accessors; the raw `Replica` is deliberately not
   exposed. The `PersistSession` interface matches.
5. **NIT-5 — copied `esc()` drift risk.** Documented ownership: the persistence `esc`/`SEP` codec is an
   independent IndexedDB-keyPath concern, deliberately decoupled from the Kit's module-private codec;
   `storage-key.test.ts` pins expected key strings. See "Storage key format".
6. **NIT-6 — reliance on `createReplica` throwing on bad seed.** Validation step 6 now states `openReplica`
   wraps `createReplica` in `try/catch` (the Kit does not pre-validate seed bytes), maps the decode throw to
   `InvalidRecordError`, cleans up the temporary replica/`Y.Doc` + IDB connection, **releases the acquired
   Web Lock**, and preserves the corrupt stored record. Mirrored in requirements AC-BP-002-5a and task 4.2.
