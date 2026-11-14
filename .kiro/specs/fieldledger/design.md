# FieldLedger MVP: Design

Status: PLANNED, not implemented. Baseline `916165f`, branch `feat/fieldledger`. This step
changes no code, manifest or lockfile. No planned test below has run.

All signatures in this document were read from source at the baseline:
`packages/kit/src/{types,adapter,collection,keys,index}.ts`,
`packages/persist/src/{session,types,identity,errors,locks,record,idb,index}.ts`,
`packages/capsule/src/{import,encode,decode,format,errors,types,index}.ts`, plus the offline
harness: `packages/persist/{harness/{harness.ts,index.html,sw-register.ts},scripts/sw-precache-plugin.ts,vite.config.ts,playwright.config.ts,e2e/{helpers.ts,offline-assets.spec.ts,capsule-transfer.spec.ts,capsule-persistence.spec.ts,static-multiscope-server.mjs}}`.

## 1. Architecture

```
apps/fieldledger (plain TypeScript, Vite build, service worker)
  UI views  ->  controllers  ->  @ghostsync/persist  (openReplica, PersistSession)
                     |                  |
                     |                  +--> @ghostsync/kit (via Persist; adapters passed in)
                     +--> @ghostsync/capsule (encodeCapsule, importCapsuleIntoPersisted, decodeCapsule)
```

Layering rules (steering `architecture.md`, `coding.md`):

- The app never imports `yjs` and never reimplements merge, encode, decode or storage.
- The app imports `createKit` only in tests (to decode persisted bytes in Node). Production code
  imports from Kit only the types and adapter contract (`import type`).
- Merge is a pure function of updates inside the Kit. Storage is Persist. Transport (files) is
  Capsule. The app wires them and renders.
- Offline app loading (service worker, Cache Storage) is separate from IndexedDB persistence
  and from sync. Neither depends on the other.

### Module map (see section 12 for the file list)

| Module | Responsibility | Pure? |
| --- | --- | --- |
| `config.ts` | constants: app ID, db name, limits | yes |
| `identity/document-id.ts` | normalize and validate document IDs, hash route | yes |
| `identity/replica-id.ts` | per (profile, document) replica ID over an injected key-value store | yes (store injected) |
| `model/adapters.ts` | `incidentAdapter`, `checklistItemAdapter`, types | yes |
| `model/ids.ts` | `newItemId(randomUUID)` | yes |
| `model/ordering.ts` | `compareItems`, `sortEntries`, `nextSortKey`, `keyBetween`, `renormalize` | yes |
| `model/read-model.ts` | `readModel(collections)` into a plain model of valid and invalid records | pure over collection interface |
| `model/write.ts` | `commitIncidentField`, `commitItemField`, `addItem`, `moveItem`, `restoreItem`, `discardItem` over the guarded collection interface | pure over collection interface |
| `model/diff.ts` | `diffModels(before, after)` | yes |
| `state/save-label.ts` | `(SaveState, SaveStateInfo) -> label, role, attrs` | yes |
| `state/errors.ts` | `mapPersistError`, `mapCapsuleError`, `mapSaveError`, `isSchemaMismatch` | yes |
| `transfer/filename.ts` | `capsuleFilename(documentId, replicaId, now, kind)` | yes |
| `transfer/export.ts` | build capsule bytes, browser download | browser |
| `transfer/import.ts` | file size precheck, read, `importCapsuleIntoPersisted`, result view | browser |
| `offline/sw-register.ts` | registration and readiness state machine (adapted copy of the harness module) | browser |
| `offline/status-copy.ts` | readiness state to copy | yes |
| `session/session-controller.ts` | open, close, retry save, backup, state store, lock/errors | browser |
| `ui/*` | DOM views using `h()` | browser |
| `main.ts` | bootstrap | browser |

## 2. Identity model

### 2.1 The five identities

| Identity | Value | Generated | Stored | Stable across |
| --- | --- | --- | --- | --- |
| App | `fieldledger` | constant | code | everything |
| Document | normalized user-entered ID, for example `inc-2026-0042` | user-entered, normalized | `localStorage` last document, hash route, IDB record, capsule metadata | everyone who types the same ID |
| Replica | `crypto.randomUUID()` per (profile, document) | on first open | `localStorage` key `fieldledger.replicaId.v1.<documentId>` | reloads of the same profile |
| Incident record | constant `incident` in the incident collection | constant | Yjs state | everyone |
| Checklist item | `ci-<crypto.randomUUID()>` | at creation, offline, on any replica | Yjs state | everyone |

The Yjs `clientID` is separate and changes with each `Y.Doc` (Persist reseeds a fresh replica on
every open). It is never used as an identity by the app.

### 2.2 How two profiles join the same document with distinct replicas

1. Ana and Ben type the same incident ID. Normalization (trim, lowercase) makes `INC-2026-0042`
   and ` inc-2026-0042 ` equal. Both call
   `openReplica({ app: "fieldledger", documentId: "inc-2026-0042", replicaId, ... })`.
2. `replicaId` comes from each profile's own `localStorage`. Two profiles have separate
   `localStorage`, so each generates its own UUID. They collide only with negligible probability.
3. Persist computes the storage key from `(app, documentId, replicaId)`:
   `esc(app) + SEP + esc(documentId) + SEP + esc(replicaId)`. The stored records are therefore
   distinct (different `replicaId`) while carrying the same `documentId`. The capsule's
   `documentId` and `app` metadata match, so a capsule from one profile is accepted by the other.
4. Each replica starts empty. Data arrives only by importing a capsule, which merges through the
   Kit.

### 2.3 Replica ID store

```ts
// identity/replica-id.ts
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function replicaStorageKey(documentId: string): string; // "fieldledger.replicaId.v1." + documentId
export function getOrCreateReplicaId(
  store: KeyValueStore,
  documentId: string,
  randomUUID: () => string,
): string;
```

- Read the stored value. If it matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  return it. Otherwise generate, store, return (AC-FL-002-6).
- `localStorage` access that throws (`SecurityError`, blocked storage) surfaces as the AC-FL-002-7
  error. The function does not catch it. The controller maps it.
- The key is scoped per document (`replicaStorageKey`), so one document's identity never affects
  another's. The app has no function that replaces or resets a replica ID in this milestone (see 9.3, L-11).
- Why `localStorage` and not IndexedDB: it is synchronous and available before the async
  `openReplica`, it is per profile, and it keeps replica identity separate from the replica data
  that Persist owns. Cost: clearing `localStorage` but not IndexedDB orphans the old record. The
  app then starts a fresh replica for the document. The old record stays on disk and no data is
  destroyed.

### 2.4 Second tab in the same profile

Same profile means the same `localStorage` replica ID, so the storage key is identical. Persist
takes an exclusive, non-waiting Web Lock `ghostsync:lock:<dbName>\u001f<storageKey>` before reading
the record (`acquireExclusiveLock` with `ifAvailable: true`). The second tab's `openReplica` rejects
with `PersistenceError { code: "StorageInUseError" }` with zero writes. The app shows the in-use
screen (REQ-FL-003). The lock is released when the first tab calls `close()` or `dispose()`, or
when it unloads. "Try again" calls the same open path again.

## 3. Data model

### 3.1 Collections and records

Two Kit collections inside the one document, each opened with its own adapter through the
Persist session facade:

| Collection (`entityType`) | Record IDs | Fields (all scalar) |
| --- | --- | --- |
| `incident` | exactly one: `incident` | `title: string`, `location: string`, `severity: "low"\|"medium"\|"high"\|"critical"`, `status: "open"\|"in-progress"\|"resolved"`, `notes: string` |
| `checklistItem` | `ci-<uuid>`, one per item | `text: string`, `done: boolean`, `sortKey: number` (finite), `createdBy: string` (replica ID), `createdAt: number` (integer epoch ms, informational) |

Each checklist item is its own record, so each field is its own leaf key in the Kit's records
map (`ghostsync:records:v1`). Field keys have the grammar
`SENTINEL "f" SEP esc(collection) SEP esc(id) SEP esc(field)` (`keys.ts`). That is why different
items and different fields merge independently.

`severity` and `status` are stored as strings and validated by the adapter. `createdAt` is never
used for ordering or conflict decisions.

### 3.2 Adapters (real signatures)

The Kit contract (`adapter.ts`):

```ts
interface SchemaIdentity { readonly app: string; readonly schemaVersion: number; readonly entityType: string }
type Fields = Record<string, Scalar>;
interface EntityAdapter<T> {
  readonly schema: SchemaIdentity;
  validate(entity: T): void;        // throw TypeError if invalid
  toFields(entity: T): Fields;      // flat scalar record
  fromFields(fields: Fields): T;    // throw if missing/mistyped
}
```

App code (types imported with `import type` from `@ghostsync/kit`):

```ts
export const APP_ID = "fieldledger" as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const STATUSES = ["open", "in-progress", "resolved"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type IncidentStatus = (typeof STATUSES)[number];

export interface IncidentDetails {
  readonly title: string;
  readonly location: string;
  readonly severity: Severity;
  readonly status: IncidentStatus;
  readonly notes: string;
}
export interface ChecklistItem {
  readonly text: string;
  readonly done: boolean;
  readonly sortKey: number;
  readonly createdBy: string;
  readonly createdAt: number;
}

export const INCIDENT_RECORD_ID = "incident" as const;

export const incidentAdapter: EntityAdapter<IncidentDetails> = {
  schema: { app: APP_ID, entityType: "incident", schemaVersion: 1 },
  validate, toFields, fromFields,
};
export const checklistItemAdapter: EntityAdapter<ChecklistItem> = {
  schema: { app: APP_ID, entityType: "checklistItem", schemaVersion: 1 },
  validate, toFields, fromFields,
};
```

Rules:

- `validate` throws `TypeError` for wrong types, out-of-enum values, non-finite `sortKey`,
  non-integer or negative `createdAt`, and the length bounds in AC-FL-004-6.
- `toFields` returns exactly the declared keys, no extras. (Kit `put` deletes keys for fields
  omitted from the entity, so `toFields` must always emit all fields.)
- `fromFields` reads each declared key, throws `TypeError` if any is absent or mistyped, ignores
  unknown extra keys. The Kit passes a null-prototype object, so use `Object.prototype.hasOwnProperty.call`.
- Kit `getResult` runs `fromFields` then `validate`, so both paths funnel failures into
  `{ ok: false, reason: "invalidRecord", id, fields, cause }`.
- A future field addition is a `schemaVersion` bump. The Kit rejects a version mismatch on every
  collection operation (it records the identity in-doc), so old and new app versions never
  silently rewrite each other's fields.

### 3.3 How invalid and incomplete records surface

Kit semantics used (`collection.ts`):

- `get(id)` returns `undefined` when absent and throws `IncompleteRecordError` when invalid.
- `getResult(id)` returns `GetResult<T>` and never throws for an invalid record.
- `list()` returns only valid `[id, entity]` pairs and silently omits invalid ones.
- `listResults()` returns `[id, GetResult<T>]` for every stored ID, including invalid ones.

The app therefore renders from `listResults()`, never from `list()`, and never uses `get()` in
render paths. Each `invalidRecord` shows as a "Conflicted or incomplete item" row:

- A text-only preview of `result.fields`: each key and value truncated to 80 characters.
- The reason in plain words: "Part of this item was deleted on another device while it was
  edited here" (generic for any invalid cause).
- "Restore" and "Discard" buttons (explicit actions only).

`restoreItem(id, fields)` builds a complete `ChecklistItem` from the preserved fields with explicit
fallbacks (`text` -> "(restored item)", `done` -> false, `sortKey` -> `max + 1024`,
`createdBy` -> this replica ID, `createdAt` -> now), then `put`s it. Kit `put` writes only the
fields that differ from current local state, so preserved fields are not rewritten.
`discardItem(id)` calls `delete(id)`. The incident record, if invalid, gets the same treatment
with defaults (`title` "", `location` "", `severity` "medium", `status` "open", `notes` "").

### 3.4 Ordering

```ts
export function compareItems(a: readonly [string, ChecklistItem], b: readonly [string, ChecklistItem]): number {
  if (a[1].sortKey !== b[1].sortKey) return a[1].sortKey < b[1].sortKey ? -1 : 1;
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;       // code-unit comparison of item IDs
}
```

- Order is a pure function of stored `sortKey` values and IDs. It never depends on iteration
  order of the Kit listing.
- Invalid records are placed after valid ones, ordered by ID.
- `nextSortKey(sortedValid)` returns `max(sortKey) + 1024`, or `1024` for empty.
- `keyBetween(lo, hi)` with `lo` and `hi` as `number | undefined`:
  both undefined -> 1024; only `hi` -> `hi - 1024`; only `lo` -> `lo + 1024`; both -> `(lo + hi) / 2`.
  The caller verifies `lo < mid && mid < hi` (strict). Otherwise it renormalizes.
- `renormalize(sortedValid)` returns `Map<id, (index + 1) * 1024>` containing only entries whose
  current `sortKey` differs.
- Two inspectors append at the same position offline: both compute `max + 1024` against their own
  data and may obtain equal keys. After exchange both items exist (different IDs). Equal keys are
  ordered by ID, so both profiles show the same order. This order is arbitrary but identical.
- Concurrent "move" on the same item is a same-field conflict on `sortKey`: one value wins.

## 4. Write path: only changed fields

Kit `Collection.put(id, entity)` diffs against CURRENT LOCAL state and writes only changed
scalar leaf keys. It does not protect a stale entity. Therefore the app NEVER keeps a long-lived
form object. At commit time:

```ts
// model/write.ts (sketch)
export function commitItemField<K extends keyof ChecklistItem>(
  items: GuardedCollection<ChecklistItem>, id: string, field: K, value: ChecklistItem[K],
): "ok" | "absent" | "invalid" {
  const r = items.getResult(id);              // CURRENT local state
  if (!r.ok) return r.reason === "absent" ? "absent" : "invalid";
  if (Object.is(r.entity[field], value)) return "ok";   // nothing changed
  items.put(id, { ...r.entity, [field]: value });       // Kit writes only `field`
  return "ok";
}
```

- Inputs commit on `change` (blur or Enter) and on page hide (D-6). The app reads the current
  record, changes one field, and calls `put`. If another field was imported a moment earlier, it
  is read as current and not clobbered.
- `addItem` creates a new record with all fields (new ID, nothing to clobber).
- `commitIncidentField` follows the same pattern against the `incident` record. When the record
  is absent, the form shows a single "Create incident details" button. Creation writes the full
  record with defaults (title from a required input, others defaulted) once, on explicit action
  (AC-FL-006-8).

## 5. Merge behavior (precise, using real Kit semantics)

The Kit turns every field into a Yjs map leaf key. Yjs resolves concurrent writes to one key
deterministically (by internal client and clock ordering), with no wall-clock input. The Kit's
existing test `packages/kit/tests/deletion.structured.test.ts` ("edit concurrent with deletion")
covers a concurrent write of a NEW field (`note`) against a delete. It does not cover an edit of
an EXISTING field, so the delete-versus-edit row below is a characterization, not a promise.

| Scenario | Expected result | Basis |
| --- | --- | --- |
| A edits item X, B edits item Y | Both edits present on both | different leaf keys |
| A edits X.text, B toggles X.done | Both present | different leaf keys of one record |
| A and B both set incident.title | One of the two values on both, identical | same leaf key, Yjs LWW; no wall-clock promise |
| A deletes item X, B concurrently edits the EXISTING field X.text | NOT promised. Characterization test (5.1). After exchange: identical decoded state on both, and one of three shapes (absent; valid with the edit; surfaced as an invalid record) | no Kit test covers an existing-field edit against a delete (5.1) |
| A and B append | Two items; order by `sortKey` then ID | distinct IDs, ordering rule |
| A imports B then B imports A | Same state on both | convergence over full-state updates |
| Re-import of same file | No change (state identical); Persist marks dirty and rewrites an equal snapshot | idempotent apply; `applyUpdate` always marks dirty on accept |

UI statement shown next to "What changed": "If both devices edited the same field, only one value
is kept." The app never says "latest edit wins".

### 5.1 Delete versus edit of an existing field: characterization

Scenario (E2E-FL-08): A deletes item Q while B concurrently edits `Q.text`, an EXISTING field.
No spec text says which operation wins. The convergence assertion, specified now, is:

- (a) after both profiles exchange capsules in both directions, the decoded states of A and B
  are deep-equal;
- (b) the outcome is one of these shapes, identical on both profiles: (i) Q absent on both
  (`listResults()` has no entry for Q); (ii) Q present and valid on both with `text` equal to B's
  edited value; (iii) Q returned by `listResults()` as `invalidRecord` on both, with identical
  preserved `fields`;
- (c) the UI shows the same checklist on both profiles, nothing crashes, and any invalid record
  is rendered as a "Conflicted or incomplete item" row (never hidden, never auto-repaired).

Process: the implementer first writes the Kit-level characterization test (tasks 2.10, real
`createKit` replicas, same two-step delete and edit on an existing field), records the OBSERVED
shape in the evidence note below and in tasks.md, and only then may any document or UI copy state
which outcome occurs. If the observed outcome violates (a) to (c), it is a Kit finding to report
(the milestone must not change `packages/**`), not something to hide in the app.

EVIDENCE NOTE (recorded 2026-11-14 at implementation): observed shape (iii): the item is returned by `listResults()` as `invalidRecord` on BOTH profiles with identical preserved `fields` = `{"text":"Check valve seat"}` (the delete removed the other leaf keys; the concurrent edit of the existing field survived). Same result at Kit level (tests/kit-integration.test.ts) and in Chromium (E2E-FL-08); decoded states were deep-equal, so no Kit convergence finding.
Kit baseline: 916165f. Run date: 2026-11-14.

## 6. Startup and session ownership

### 6.1 Flow

```
page load
  1. render shell (no data); html[data-offline-state="registering"]
  2. offline/sw-register.initOfflineReadiness()          (non-blocking)
  3. resolve documentId: parseRoute(location.hash) -> localStorage "fieldledger.lastDocumentId.v1" -> none
       none -> render JoinForm; done
  4. getOrCreateReplicaId(localStorage, documentId, crypto.randomUUID.bind(crypto))
  5. session = await openReplica(options)                (section 6.2)
       reject -> mapPersistError -> error screen (or in-use screen)
  6. open collections (may throw schema mismatch) -> on throw: await session.dispose(); show message
  7. subscribe; initial render from listResults(); localStorage.lastDocumentId = documentId
  8. state indicator from onStateChange; html[data-session="ready"]
```

### 6.2 `openReplica` call (actual signature)

```ts
// OpenOptions extends ReplicaIdentity { app; documentId; replicaId? }
//   + dbName?: string; maxBytes?: number; onStateChange?: SaveStateListener
const session: PersistSession = await openReplica({
  app: "fieldledger",
  documentId,                      // normalized
  replicaId,                       // stable per (profile, document)
  dbName: "fieldledger",           // app-specific database, not the default "ghostsync"
  maxBytes: 8 * 1024 * 1024,       // equals Persist DEFAULT_MAX_BYTES and Capsule DEFAULT_MAX_UPDATE_BYTES, stated explicitly
  onStateChange: (state, info) => saveStore.set(state, info),
});
```

- `dbName: "fieldledger"` keeps the app's records out of other apps' default database.
- `maxBytes` equal to the Capsule decoded-size default means anything the session can persist can
  also be exported and imported by the other side under default Capsule limits.
- `session.restored` tells whether a stored record existed. It is shown in the status line
  ("Restored saved data" or "New on this device").
- Persist creates the replica fresh (new Yjs `clientID`) and seeds it by applying stored bytes.
  The app never touches the replica directly.

### 6.3 Collections

```ts
const incidents = session.collection(incidentAdapter);        // GuardedCollection<IncidentDetails>
const items = session.collection(checklistItemAdapter);       // GuardedCollection<ChecklistItem>
```

- Opening a collection is a mutation (the Kit writes schema meta on first open), so Persist
  rejects it unless the session is open. Persist marks the session dirty because the meta write
  is a local change. On a fresh document the save indicator therefore passes through
  `dirty` and `saving` to `saved` shortly after open. This is expected and shown honestly.
- Open the collections once per session and keep the handles. Every operation rechecks the schema
  identity, so a later-imported incompatible version throws inside `listResults()`.
- All render code runs inside one `try/catch`. Errors are classified:
  `isSchemaMismatch(err)` (message prefix `GhostSync Kit: schema mismatch`), a `PersistenceError`
  with `ClosedError`, or unexpected. Schema mismatch shows the REQ-FL-004 message and stops
  rendering. The Kit has no typed class for this, so a unit test provokes the real error (two
  adapters with different `schemaVersion` on one real `createKit().createReplica`) and asserts the
  helper recognizes it. A Kit message change then fails that test.

### 6.4 Session lifecycle

| Event | Action |
| --- | --- |
| Any local edit | Persist marks dirty and schedules a save. The app does nothing else |
| `visibilitychange` hidden or `pagehide` | App blurs the focused field (its `change` handler commits the draft). Persist already installs its own handlers and schedules a best-effort save. No durability claim |
| "Change incident" | `await session.close()`: flushes and releases lock and connection. On `CloseFailedError` the session is recovery-only (reads and `exportBytes()` / `exportState()` still work). Show backup and "Discard unsaved changes and switch" (`await session.dispose()`) |
| Open failure after the lock was acquired (collection throws) | `await session.dispose()` to release the lock and connection |
| Page unload | No action. The browser releases the Web Lock. Unsaved data is lost unless already saved |

After a successful `close()` or `dispose()` the controller drops its references. It never calls
the session again (AC-FL-007-6). `PersistenceError { code: "ClosedError" }` is therefore only
expected when two actions race, and it is mapped to a reload suggestion.

## 7. Autosave feedback

Persist's state machine (from `session.ts`): `dirty -> saving -> saved | error`, single flight
saves, no automatic retry after `error`, retry on the next `flush()` or the next edit. `flush()`
resolves when the generation present at call time is durable and rejects with the failing
`PersistenceError`.

### 7.1 Label mapping (pure function `saveLabel`)

| State | `info.sequence` | Label | `role` | Notes |
| --- | --- | --- | --- | --- |
| `dirty` | any | Changes not yet saved | none | not announced |
| `saving` | any | Saving to this device... | none | not announced |
| `saved` | `> 0` | Saved locally | live region announces after a non-saved state | `data-save-sequence` = sequence |
| `saved` | `0` | Nothing to save yet | none | a fresh replica that has not persisted |
| `error` | any | NOT saved to this device | `alert` | shows the Retry banner |

The indicator element carries `data-save-state="<raw state>"` and `data-save-sequence="<n>"`.
A symbol prefix per state (for example a check, a spinner glyph, a warning sign) accompanies the
label so colour is never the only cue.

### 7.2 Live regions

- `#save-announcer` (visually hidden, `role="status"`, `aria-live="polite"`, `aria-atomic="true"`):
  updated only on `-> saved` (after a non-saved state) and on `-> error`. Updates are
  de-duplicated, so a stream of `dirty/saving` flips produces no chatter.
- The error banner is `role="alert"` and is inserted only on entering `error`, removed when the
  state leaves `error`.

### 7.3 Retry flow

A failed save that is not an import (an edit whose write aborted) shows the same alert element with
`data-save-error-kind="edit"`, heading "Your latest changes are NOT saved to this device.", the
AC-FL-009-4 sentence, and the same two actions (AC-FL-009-9). An import failure uses
`data-save-error-kind="import"` and the "Capsule applied, but NOT saved to this device" heading.

`flush()` rejects while the save keeps failing, and the state remains `error`. On success the state
returns to `saved`. A new edit while in `error` also triggers a Persist retry (a dirty mark
schedules a save). The banner stays until Persist leaves `error`. If `maxBytes` is exceeded the
failure is deterministic (`QuotaExceededError`, "snapshot exceeds maxBytes") and Retry keeps
failing. The copy says so (AC-FL-009-5).

## 8. Offline readiness and startup

### 8.1 What the existing harness and build do (reviewed)

- `scripts/sw-precache-plugin.ts` is a Vite plugin (`apply: "build"`, `generateBundle` with
  `order: "post"`). It walks the real emitted bundle, hashes each file, derives a deterministic
  `cacheVersion` from the sorted `url\u0000integrity` list, and emits `sw.js`,
  `precache-manifest.json` and a test-only `sw-install-fail.js`.
- The generated `sw.js` is dependency free, plain ES. Cache name is
  `<CACHE_PREFIX><registration scope pathname>::<cacheVersion>`, so two deployments of one build
  under different paths on one origin do not share caches. Install fetches every entry with
  `cache: "reload"`, and writes only after all succeed (atomic). It does not `skipWaiting`
  automatically. Activate deletes only older caches of the same scope prefix and calls
  `clients.claim()`.
- Fetch handling: only GET, same-origin, in-scope. Navigations are answered with the cached shell
  only for the documented URLs: the scope root and `index.html` (exact full-URL match). Other
  navigations and unknown assets fall through to the network so failures stay visible. Precached
  assets are cache-first.
- Messages: `GHOSTSYNC_PRECACHE_STATUS` (reply `complete: boolean`), `GHOSTSYNC_SKIP_WAITING`,
  `GHOSTSYNC_CLEANUP`.
- `harness/sw-register.ts` registers `./sw.js` with `scope: "./"` only if
  `"serviceWorker" in navigator && window.isSecureContext`. State machine: `unsupported`,
  `registering`, `installing`, `waiting`, `ready`, `failed`. `ready` requires a controller and a
  complete precache round trip (5 s timeout). A worker that turns `redundant` without ever
  controlling the page, while not ready, is reported as `failed`.
- The e2e suite proves cold offline boot with `context.setOffline(true)` plus `page.reload()`
  without re-enabling, and asserts `response.fromServiceWorker()` for the document and
  `assets/index-*.js`. It also asserts that a fresh profile offline fails honestly.
- Harness download uses `Blob` + `URL.createObjectURL` + anchor click and revokes the URL after
  1 s. Upload uses a file input. `File.size` is compared to the raw limit before
  `arrayBuffer()`. Failure injection (`armWriteAbortOnce`) patches `IDBDatabase.prototype.transaction`
  in the harness page so the next `readwrite` transaction aborts right after the first put.

### 8.2 Reuse decision for the service worker plugin

Options:

| Option | Pros | Cons |
| --- | --- | --- |
| A. Import `../../packages/persist/scripts/sw-precache-plugin.ts` by relative path | zero duplication | reaches into another package's non-exported internals (`exports` exposes only `.`; `files` is `dist`); couples the app build to the persist folder layout; the plugin's prefix is `ghostsync-persist-harness-` and the worker text says "Persist harness"; any plugin change to suit the app would modify `packages/persist`, which this milestone must not touch |
| B. Copy into `apps/fieldledger/scripts/` and adapt | no cross-package coupling; own cache prefix; persist untouched and its 37 browser tests unaffected; the code is already tested by the persist suite and by this app's offline tests | about 350 lines duplicated; drift risk |
| C. Extract a shared build helper package now | one source of truth | new package and dependency edge, plus changes in `packages/persist`, outside this milestone's scope |

Recommendation: B. Copy the plugin with only these changes: `CACHE_PREFIX = "ghostsync-fieldledger-"`,
header and message text say FieldLedger, the test-only `sw-install-fail.js` emission and the
`?sw=` override are dropped, and a comment records the source file and baseline commit `916165f`.
Record a follow-up (outside this milestone) to extract a shared helper when PatchBoard needs the
same worker. This spec step changes no code. The copy is covered by the app's offline e2e tests.

### 8.3 App registration and readiness

`offline/sw-register.ts` is an adapted copy of the harness module with these changes: it sets the
`<html>` attributes `data-offline-state` and `data-offline-ready`, drives the offline indicator
through a subscribe callback instead of writing into a fixed element id, and exposes NO `window`
global. The state machine and the controlled-plus-complete-precache rule are unchanged. The
indicator copy (pure `offlineCopy(state, error)`):

| State | Copy |
| --- | --- |
| `unsupported` | Offline use is not available in this browser or context. FieldLedger needs HTTPS or localhost. Your edits still save to this device while the page is open. |
| `registering` | Preparing offline use... Stay online until this says "Ready to work offline". |
| `installing` | Preparing offline use... Stay online until this says "Ready to work offline". |
| `waiting` | A new version is ready. Save your work, then update. [Update now] |
| `ready` | Ready to work offline. |
| `failed` | Offline use is not available: `<reason>`. You can keep working while online. Your edits still save to this device. |

While the state is not `ready`, a persistent line reads: "Opening FieldLedger offline for the very
first time will not work. Open it once while online." The `waiting` copy applies when a worker
is installed and waiting while a controller exists. "Update now" calls `applyUpdate()` (explicit
`GHOSTSYNC_SKIP_WAITING`), then the app reloads on `controllerchange`.

### 8.4 First visit, scope and secure context

- First online visit is required. Cold-offline first visits do not work. This is a promise
  boundary, not a bug. A test proves the honest failure (E2E-FL-10).
- Service workers need HTTPS or `localhost`. Otherwise state is `unsupported` with the copy above.
- Vite is built with `base: "./"`. Every URL (assets, `./sw.js`, scope `./`) is scope-relative, so
  the app works under a sub-path (for example `/deploy-fl/`). Optional test E2E-FL-11 covers this
  with the copied multi-scope static server.
- Document routing across offline reloads: the shell is answered only for the scope root or
  `index.html` by exact URL. A query string would not match, so the incident is carried in the
  hash (`/#/i/<documentId>`) and in `localStorage`. Whether the fragment is stripped from the
  service worker request URL is NOT verified at spec time. The offline test navigates to a hash
  route offline, and the `localStorage` last-document fallback keeps the journey working if the
  worker does not match hashed URLs. The test records which path was used so the assumption is
  settled by evidence.

### 8.5 Offline cold-boot sequence

```
online first visit:  network -> index.html -> assets -> sw registers -> install precache -> activate -> claim
                     readiness: registering -> installing -> controllerchange -> PRECACHE_STATUS complete -> ready
offline reload:      page.reload() -> SW fetch(navigate, root) -> cached index.html
                     -> cached assets -> main.ts -> readiness evaluate (controller present) -> ready
                     -> resolve document -> replica id from localStorage -> openReplica (IndexedDB) -> restored data
```

Offline readiness and IndexedDB persistence never call each other. A failed service worker does not
stop editing, and a failed IndexedDB open does not affect the shell.

## 9. Transfer (file) design

### 9.1 Export

```ts
import { encodeCapsule, CAPSULE_MEDIA_TYPE } from "@ghostsync/capsule";

async function buildCapsule(session: PersistSession): Promise<Uint8Array> {
  return encodeCapsule({
    app: session.identity.app,                // "fieldledger"
    documentId: session.identity.documentId,  // normalized
    update: session.exportState(),            // TransportUpdate, kind "full": id and kind cross-checked
  });
}
```

Download uses `new Blob([bytes], { type: CAPSULE_MEDIA_TYPE })`, `URL.createObjectURL`, a hidden
anchor with `download`, `click()`, then `URL.revokeObjectURL` on a short timeout (same pattern as
the harness). File name (pure, unit tested):

```ts
// transfer/filename.ts
export function capsuleFilename(documentId: string, replicaId: string, now: Date, kind: "export" | "backup"): string;
// "fieldledger_inc-2026-0042_3f9a1c2e_20261110T091530Z.gscap"
// "fieldledger_inc-2026-0042_3f9a1c2e_20261110T091530Z_backup.gscap"
```

`documentId` already matches `[a-z0-9._-]`, so the name needs no further sanitization. A guard
replaces any character outside `[A-Za-z0-9._-]` with `_` defensively.
Export works offline and in `error` or recovery-only states (`exportState()` stays readable).

### 9.2 Import

```ts
import { importCapsuleIntoPersisted, decodeCapsule, isCapsuleError, DEFAULT_MAX_CAPSULE_BYTES } from "@ghostsync/capsule";

async function importFile(session: PersistSession, file: File): Promise<ImportView> {
  if (file.size > DEFAULT_MAX_CAPSULE_BYTES) return rejected("OversizedRaw");   // before arrayBuffer()
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { return readFailed(); }
  const before = readModel(collections);
  // `data-import-state="importing"` and the disabled file input are set before `file.arrayBuffer()`
  // is awaited (AC-FL-013-6) and cleared when the result is rendered.
  try {
    const r = await importCapsuleIntoPersisted(session, bytes);   // { applied: true; persisted; metadata; saveError? }
    const after = readModel(collections);
    return r.persisted ? appliedSaved(r.metadata, diffModels(before, after))
                       : appliedUnsaved(r.metadata, r.saveError, diffModels(before, after));
  } catch (err) {
    return await rejectedView(err, bytes);          // CapsuleError | TypeError
  }
}
```

Facts used from `import.ts`: the importer decodes (raw size, snapshot, header, metadata, decoded
size, checksum), THEN checks app and document identity, THEN applies through
`session.applyUpdate`, THEN `flush()`. Rejection happens before any apply, so a rejected import
cannot mutate state. A failed flush is not a rejection: it resolves `persisted: false` with
`saveError` (any object with `name`, `message`, optional `code`). A throwing `applyUpdate` is
`TargetUnavailable`. A non-ok `applyUpdate` outcome is `SdkRejection`.

### 9.3 Error mapping table (copy is exact; "Nothing was changed." is appended on every reject)

`CapsuleError.code` mapping (pure `mapCapsuleError(err, meta?)`):

| Code | Message |
| --- | --- |
| `DocumentIdentityMismatch` | This capsule is for a different incident (`<its documentId>`). You have `<this documentId>` open. |
| `AppIdentityMismatch` | This capsule was made by a different app (`<its app>`), not FieldLedger. |
| `ChecksumMismatch` | This file looks damaged (its checksum does not match). Ask the sender to export it again. |
| `Malformed` | This is not a valid FieldLedger capsule file, or it is truncated. Ask the sender to export it again. |
| `UnsupportedVersion` | This capsule uses a newer or unknown capsule format version. Update FieldLedger or ask the sender to export with a compatible version. |
| `OversizedRaw` | This file is larger than the 16 MiB limit. |
| `OversizedDecoded` | The incident data inside is larger than the 8 MiB limit. |
| `SdkRejection` | The sync engine rejected the data in this capsule. Ask the sender to export it again. |
| `TargetUnavailable` | This incident is not open for editing right now. Reload the page. |
| `CryptoUnavailable` | This browser cannot verify capsules (secure crypto is unavailable). Use HTTPS or localhost. |
| `TypeError` (not `CapsuleError`) | Unexpected error. |
| file read failure | Could not read that file. |

When the code is `DocumentIdentityMismatch` or `AppIdentityMismatch`, the app calls
`decodeCapsule(bytes)` (applies nothing) to read `metadata.documentId` or `metadata.app`, renders
them truncated to 80 characters as text, and falls back to the wording without the name if the
second decode throws.

`PersistenceError.code` (open and save) mapping (pure `mapPersistError(err)`, `mapSaveError(code)`):

| Code | Context | Message and action |
| --- | --- | --- |
| `StorageInUseError` | open | This incident is already open in another tab or window on this device. Close the other one, then [Try again]. |
| `UnsupportedEnvironmentError` | open | This browser cannot store data safely (Web Locks or IndexedDB are unavailable). Use a current Chrome, Edge, Firefox or Safari. |
| `StorageUnavailableError` / `DatabaseOpenError` | open | Browser storage is not available (private mode, blocked storage, or disk full). Check browser settings, then [Try again]. |
| `BlockedError` | open | Another tab is blocking the database. Close other FieldLedger tabs, then [Try again]. |
| `InvalidRecordError` | open | The saved data for this incident on this device is damaged or does not match. Nothing was changed, and the damaged data was kept. FieldLedger cannot open or export it. Other incidents are not affected: use "Open a different incident". To start this incident again on this device, ask your colleague for a capsule, then clear this site's data in your browser settings (this removes ALL FieldLedger data on this device, so export capsules of your other incidents first). |

Note on the `InvalidRecordError` row (limitation L-11). Persist rejects the open before any write and
never wipes or overwrites a damaged record (`record.ts`: "NEVER an auto-wipe/replace/delete"). No
session exists, so there is nothing for the app to export. "Open a different incident" is the
join form; it is not a new feature. The manual instruction above is the only recovery offered.
The mapping is covered by `errors.test.ts` (copy contains "Nothing was changed" and the manual
step). No browser test corrupts a stored record in this milestone.
| `QuotaExceededError` | save | Not enough space or the incident is over the 8 MiB local limit. Download a backup capsule first. Free browser storage or start a new incident. Retrying will keep failing until space or size changes. |
| `TransactionAbortError` | save | The browser aborted the write. [Retry save] usually works. |
| `ClosedError` | any | This incident was closed. Reload the page. |
| `CloseFailedError` | close | Could not save on close. Download a backup capsule, or discard unsaved changes and switch. |
| schema mismatch (`Error`, prefix `GhostSync Kit: schema mismatch`) | open or render | This incident was created by an incompatible FieldLedger version. Nothing was changed. |
| anything else | any | Unexpected error. Reload the page. If it keeps happening, download a backup capsule first. |

### 9.4 Recovery after "applied but not saved"

State after `{ applied: true, persisted: false }`: the merged data is in memory and visible.
Persist state is `error`, the dirty generation is retained, and the stored record is the previous
snapshot. The alert offers:

1. Retry save: `await session.flush()`. Success: indicator `saved`, result text
   "Saved locally. The imported changes are now stored on this device." Failure: alert stays with the
   mapped error.
2. Download backup capsule: `encodeCapsule` of `session.exportState()` (the merged in-memory state).
3. If the page closes first: the unsaved changes are lost from this device (AC-FL-009-4). The
   `beforeunload` guard shows only while `error`.
4. If Retry cannot succeed (`QuotaExceededError`): back up, then free space or start a new
   incident.

### 9.5 What changed panel

`readModel(items, incidents)` returns `{ incident: ReadResult, items: Array<[id, ChecklistItem] | invalid> }`
from `listResults()` and `getResult("incident")`. `diffModels(before, after)` returns
`{ addedItems, removedItems, changedItems: Array<{ id, field, before, after }>, changedIncident: Array<{ field, before, after }>, becameInvalid: id[], noChanges: boolean }`.
It is rendered as text with `textContent`.

## 10. UI design

### 10.1 Screens and regions

- Join screen: `<form>` with label "Incident ID", `aria-describedby` pointing at the rules and
  the "Will open: ..." preview, button "Open incident".
- In-use screen: message plus "Try again". `html[data-session="in-use"]`.
- Error screen: mapped message plus the action from the table. `html[data-session="error"]`.
- Workspace (`html[data-session="ready"]`; `data-document-id`, `data-replica-id` on `<main>`):
  1. Header: title, incident ID, "This device: <8 chars>", [Change incident]
     (`data-testid="change-incident"`).
  2. Status bar: save indicator (`data-testid="save-indicator"`), offline indicator
     (`data-testid="offline-indicator"`), network chip (`data-testid="network-chip"`, text
     "Network: online" or "Network: offline"), transfer mode chip (`data-testid="transfer-mode"`,
     text "Transfer: file (.gscap)"), first-visit notice, and the update banner
     (`data-testid="update-banner"`, shown only in the `waiting` offline state, with the button
     "Update now").
  3. Incident details form (fields: Title, Location, Severity select, Status select, Notes) or
     the "Create incident details" panel.
  4. Checklist: "New checklist item" input plus "Add item"; ordered list.
  5. Transfer panel: "Export capsule (.gscap)", "Import capsule (.gscap)" file input
     (`data-testid="import-input"`, `disabled` while an import runs), integrity notice, import
     result region (`data-testid="import-result"`, `data-import-state` is one of `importing`,
     `applied-saved`, `applied-unsaved`, `rejected`; `data-import-code` when relevant), "What
     changed" (`data-testid="merge-summary"`).
  6. Save error alert (`data-testid="save-error-alert"`, `role="alert"`,
     `data-save-error-kind="import" | "edit"`, `data-save-error-code="<PersistenceErrorCode>"`)
     with "Retry save" and "Download backup capsule".
  7. Recovery panel (`data-testid="recovery-panel"`), shown when `close()` failed
     (`CloseFailedError`): the session stays readable, with "Download backup capsule" and
     "Discard unsaved changes and switch" (`dispose()`).
- Session attribute: `<html data-session="join | in-use | error | ready | recovery">`
  (`recovery` after a failed close). `data-document-id` and `data-replica-id` are on the
  workspace `<main>`. The checklist is `<ol data-testid="checklist">` whose rows are
  `li[data-item-id]` (invalid rows carry `data-item-id` too).
- The error screen for `InvalidRecordError` and the other open failures includes an "Open a
  different incident" link back to the join form.

### 10.2 Checklist row

```
<li data-item-id="ci-...">
  <input type="checkbox" aria-label="Done: <text>">
  <input type="text" aria-label="Item text" value="<text>">
  <button>Move up</button><button>Move down</button><button>Delete item</button>   // aria-label includes the text
</li>
```

An invalid record row shows the preview and "Restore" / "Discard". Row keys are the item IDs
(keyed reconciliation, so focus and drafts survive unrelated updates). A focused input with an
uncommitted draft is never overwritten by a re-render.

### 10.3 Styles and layout

Single `styles.css` bundled by Vite (precached). System font stack, no external resources.
CSS grid with one column below 40 em and two columns (details and checklist, transfer below) above.
`:focus-visible { outline: 3px solid #1a56db; outline-offset: 2px }` for every control. Respect
`prefers-reduced-motion`. State chips use text plus a symbol.

### 10.4 Before and after

The "What changed" panel is driven by the real before and after read models (section 9.5).
Nothing is mocked.

## 11. Security design

- Capsules are untrusted: size is bounded before decoding (`File.size`, then Capsule raw and
  decoded limits), identity and checksum are validated by Capsule before the Kit applies anything.
- Rejection never touches the replica (importer ordering in 9.2).
- The checksum is an integrity check. It does not authenticate the sender. The UI and README say
  so (AC-FL-013-8, AC-FL-017-5).
- All data is rendered with `textContent`. Capsule metadata and invalid record previews are
  truncated to 80 characters.
- No network I/O beyond same-origin static assets. A test asserts every request is same-origin.
- The foreign Yjs bytes can write arbitrary scalar fields. The adapters validate on read, so
  malformed or oversized values become `invalidRecord` rows instead of rendering unchecked.
- CSP meta (SHOULD): `default-src 'self'; base-uri 'none'; form-action 'none'`. Applied only if
  the built `index.html` has no inline script. Verified in the build task.
- No secrets, tokens or personal data in code, fixtures, test names or build output.

## 12. File plan (all future; none created in this step)

```
apps/fieldledger/
  package.json                      (modify: scripts, dependencies, devDependencies, type module)
  index.html                        shell, CSP meta, <link rel="icon" href="data:,">, #app
  vite.config.ts                    root = app dir, base "./", build.outDir "dist", plugin: swPrecachePlugin()
  tsconfig.json                     strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, lib ES2022 + DOM
  vitest.config.ts                  node environment, include tests/**/*.test.ts excluding dist-scan, setup for fast-check seed
  vitest.dist.config.ts             node environment, include tests/dist-scan.test.ts only (run after build)
  vitest.setup.ts                   fc.configureGlobal({ numRuns: 200, seed: 424242 }); batches override per call (14.6)
  playwright.config.ts              port 4329, 1 worker, retries 0, webServer static server
  README.md                         how to build, run, offline limits, integrity-not-authentication notice
  scripts/sw-precache-plugin.ts     adapted copy (D-2)
  e2e/static-server.mjs             adapted copy of the multi-scope static server (serves / and /deploy-fl/)
  e2e/helpers.ts                    contexts, readiness waits, raw IndexedDB reads, Kit decode, capsule builders, abort injector
  e2e/two-profile.spec.ts           E2E-FL-01
  e2e/offline-reload.spec.ts        E2E-FL-02, 10, 11, 15
  e2e/file-exchange.spec.ts         E2E-FL-03, 07, 08, 17, 18
  e2e/rejection.spec.ts             E2E-FL-04
  e2e/save-failure.spec.ts          E2E-FL-05
  e2e/session-and-keyboard.spec.ts  E2E-FL-06, 09, 16
  e2e/session-lifecycle.spec.ts     E2E-FL-12, 13, 14
  src/main.ts
  src/config.ts
  src/styles.css
  src/identity/document-id.ts
  src/identity/replica-id.ts
  src/model/adapters.ts
  src/model/ids.ts
  src/model/ordering.ts
  src/model/read-model.ts
  src/model/write.ts
  src/model/diff.ts
  src/state/save-label.ts
  src/state/errors.ts
  src/transfer/filename.ts
  src/transfer/export.ts
  src/transfer/import.ts
  src/offline/sw-register.ts
  src/offline/status-copy.ts
  src/session/session-controller.ts
  src/ui/h.ts
  src/ui/app-view.ts
  src/ui/join-view.ts
  src/ui/status-bar.ts
  src/ui/incident-view.ts
  src/ui/checklist-view.ts
  src/ui/transfer-view.ts
  src/ui/error-views.ts
  tests/document-id.test.ts
  tests/replica-id.test.ts
  tests/ids.test.ts
  tests/adapters.test.ts
  tests/ordering.test.ts
  tests/fc-report.ts                  shared fast-check reporter (no .test.ts suffix, so not collected); mirror of packages/capsule/tests/fc-report.ts
  tests/ordering.property.test.ts
  tests/kit-integration.test.ts       real createKit replicas in Node for write helpers and merge semantics
  tests/kit-integration.property.test.ts
  tests/save-label.test.ts
  tests/errors.test.ts
  tests/filename.test.ts
  tests/diff.test.ts
  tests/status-copy.test.ts
  tests/dist-scan.test.ts             post-build scan of dist for injection names and inline scripts (runs after build)
```

`dist-scan.test.ts` needs the build output, so it is excluded from the default `test` include and run through its own
script `test:dist` after `build` (see tasks for its position in the verification order).

## 13. Dependencies and build order

`apps/fieldledger/package.json` (future; exact pins reused from the repo, nothing new):

```json
{
  "name": "@ghostsync/fieldledger",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "build": "vite build",
    "test:dist": "vitest run --config vitest.dist.config.ts",
    "preview": "vite preview --port 4329 --strictPort",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@ghostsync/capsule": "workspace:*",
    "@ghostsync/kit": "workspace:*",
    "@ghostsync/persist": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "1.65.0",
    "@types/node": "24.19.2",
    "fast-check": "4.10.2",
    "typescript": "7.0.2",
    "vite": "8.3.6",
    "vitest": "5.1.0"
  }
}
```

No UI framework is
added (D-1), so no new version needs verification. If a framework were chosen later, its current
stable version would have to be verified against official documentation and pinned before use.

Build order (each step consumes the previous step's `dist/`): kit, capsule, persist, fieldledger.
The three libraries expose `types` and `import` at `./dist/index.*`, so `typecheck` and `build` of
the app require them built. The `dist/` folders are git-ignored.

## 14. Acceptance test design (Playwright, real Chromium)

### 14.1 Common rules

- Config: `testDir: "./e2e"`, `timeout: 30_000`, `expect.timeout: 10_000`, `workers: 1`,
  `fullyParallel: false`, `retries: 0`, project `chromium` (`devices["Desktop Chrome"]`),
  `baseURL http://localhost:4329`, `webServer` runs `node e2e/static-server.mjs` serving the BUILT
  `dist/`. No `test.skip`, `test.fixme`, retries or timeout overrides. Waits use observable
  signals (`data-*` attributes through auto-waiting `expect(locator).toHaveAttribute(...)` with
  the normal `expect.timeout`, `waitForEvent("download")`). No arbitrary sleeps.
- Single-action rule: every action button or control is clicked EXACTLY ONCE, then the test
  awaits the observable result with a bounded `expect`. `expect.poll` may only READ state (for
  example the Web Locks list). It never wraps a click or other action, and there is no click
  loop.
- Two profiles are two `browser.newContext({ baseURL, acceptDownloads: true })`. Each has its own
  IndexedDB, `localStorage`, Cache Storage and service worker.
- Online-then-offline discipline: load online, await `data-offline-ready="true"` (bounded 20 s),
  then `context.setOffline(true)` before the interaction under test, as in `offline-assets.spec.ts`.
- Synthetic data only.

### 14.2 Persisted-state observation (no app hook)

The app exposes no test hook. The tests read what Persist actually stored:

```ts
// e2e/helpers.ts (future)
async function readStoredRecords(page: Page): Promise<StoredRecordView[]>;
// page.evaluate: indexedDB.open("fieldledger") -> transaction("replicas","readonly")
//   -> objectStore.getAll() -> map { app, documentId, replicaId, sequence, checksum, savedAt, bytes: number[] }
function decodePersisted(rec: StoredRecordView, documentId: string): { incident: GetResult<IncidentDetails>; items: Array<[string, GetResult<ChecklistItem>]> };
// Node: const r = createKit().createReplica(documentId, Uint8Array.from(rec.bytes));
//       r.collection(incidentAdapter).getResult("incident"); r.collection(checklistItemAdapter).listResults(); r.destroy();
```

The raw `getAll` read uses a readonly transaction and does not need the Web Lock. The store name
`replicas` and the `StoredRecord` shape are Persist internals documented in `record.ts` and
`idb.ts`. The existing harness also reads them directly, and this coupling is accepted for tests only.
This design makes persisted-state assertions independent of app internals and proves real IndexedDB
persistence, not a Node mock. Kit decoding in Node uses the built `@ghostsync/kit` and the app's
pure adapters.

### 14.3 Failure injection (test-only; D-7)

Recommended: a Playwright `page.addInitScript` snippet, owned by `e2e/helpers.ts`, that wraps
`IDBDatabase.prototype.transaction`. It installs `window.__ghostsyncTest.armWriteAbortOnce()`
(defined only in the test page). When armed, the NEXT `readwrite` transaction aborts right after its
first `put` is enqueued (the same mechanism as the harness `installWriteAbortHook`, but owned by the
test). The shipped bundle contains none of this. Compared with a test-only build entry, this tests
the very bundle that ships. `dist-scan` asserts the names `armWriteAbortOnce` and `__ghostsyncTest`
do not appear in `dist/`.

Two more test-owned helpers follow the same rule (test code only, never shipped):

- A file-read gate (E2E-FL-17): an `addInitScript` wrapper over `File.prototype.arrayBuffer` with
  `holdNextFileRead()` and `releaseFileRead()` on the test-only `window.__ghostsyncTest`. The next
  `arrayBuffer()` call stays pending until released, which makes the "import is running" window
  deterministic.
- A service-worker bump endpoint (E2E-FL-15): `POST /__test/sw-bump` on `e2e/static-server.mjs`
  (test infrastructure) makes later `sw.js` responses carry one extra comment line, so the browser
  sees a byte-different worker and installs it as `waiting`.

`dist-scan` asserts that `armWriteAbortOnce`, `holdNextFileRead`, `releaseFileRead` and
`__ghostsyncTest` do not appear in `dist/`.

One-shot caveat (seen in the existing capsule test): the abort fires for the next readwrite
transaction on ANY connection. Therefore the test must wait until the save indicator shows
`data-save-state="saved"` (setup saves settled) and arm immediately before the import.

### 14.4 Scenarios

Requirement IDs after each name. "UI" = what the test must observe through the page. "Persisted" =
what the test must observe through stored IndexedDB records.

#### E2E-FL-01 Two profiles, one document (REQ-FL-001, 002, 003, 008)

Steps: create contexts A and B (separate profiles). Each loads `/`, awaits offline-ready, goes
offline, enters ` INC-2026-0042 ` in the join form, observes the normalized preview, opens. Each
creates its own data: A creates incident details with title "Pump station leak" and adds two items;
B creates one item "Check valve".
UI: both show document ID `inc-2026-0042` (`main[data-document-id]`); `main[data-replica-id]`
differ and are UUIDs; each indicator reaches `data-save-state="saved"` with `data-save-sequence`
greater than 0 and label "Saved locally"; A does not show B's item and B does not show A's (they
have not exchanged). No request to a different origin was seen (`page.on("request")`).
Persisted: `readStoredRecords` returns exactly one record per profile; both have
`app === "fieldledger"` and `documentId === "inc-2026-0042"`; `replicaId` equals each page's
`data-replica-id` and differs between profiles; decoded A holds A's incident and 2 items and no
"Check valve"; decoded B holds only "Check valve"; `sequence` equals the UI sequence.

#### E2E-FL-02 Offline reload and keep working (REQ-FL-010, 011, 007, 008)

Steps: one context online; await `data-offline-ready="true"`; open the incident; create details and
two items; await saved. `context.setOffline(true)`. Collect responses and `page.reload()` without
re-enabling the network. Assert boot. Edit offline (toggle one item, add an item, change status).
Await saved. Reload offline again.
Network chip (AC-FL-010-9): `[data-testid="network-chip"]` has text "Network: online" before
`setOffline(true)`, "Network: offline" right after it (no reload), and again after the offline
reload; `[data-testid="transfer-mode"]` has text "Transfer: file (.gscap)" in each state.
UI: after the first offline reload the page reaches `data-offline-ready="true"` again; the incident
reopens without the join form (same document and the same `data-replica-id`); all data is shown;
the document response and the `assets/index-*.js` response report `fromServiceWorker() === true`;
`navigator.onLine === false`; offline edits are visible after the second reload; the indicator shows
"Saved locally" after each edit; no request leaves the origin. The test records whether the hash route or the `localStorage` fallback reopened the
incident and fails if neither did.
Persisted: after the offline edits, the stored record's `sequence` increased; decoded items match
the UI (done flag, new item, status); `replicaId` unchanged across reloads.

#### E2E-FL-03 Real file exchange and merge (REQ-FL-006, 012, 013, 015, 004, 005)

Steps: A and B online then offline. A creates the incident ("Pump station leak", severity medium) and
items X "Close inlet", Y "Check valve", Z "Log pressure". A downloads a capsule (`waitForEvent("download")`
plus `download.saveAs(path)`), checks the file starts with `GSCAP` and the name matches
`^fieldledger_inc-2026-0042_[0-9a-f]{8}_\d{8}T\d{6}Z\.gscap$`. B imports it with
`setInputFiles(path)` into the file input. Baseline reached on B. Then concurrent offline edits: A
edits X.text ("Close inlet valve"), toggles Z.done, sets title "Title from A". B edits Y.text
("Check valve seat"), edits Z.text ("Log pressure hourly"), sets title "Title from B". Exchange: A
downloads, B imports; B downloads, A imports (both real files). Re-import B's second file into A.
UI: B sees A's baseline and the "What changed" panel lists the three added items; after the final
exchange both pages show identical incident fields and identical ordered lists; X.text is A's, Y.text
is B's, Z.done is true and Z.text is B's (different fields of one record both survived); the title
is exactly one of the two values and equal on both; the panel states that only one value is kept
for a changed same field; the duplicate import shows "no changes", `data-import-state="applied-saved"`;
the object URL stats are not observable (no hook), so the test asserts the download works twice.
Persisted: after each import the importing profile's `sequence` increased and `readStoredRecords`
decodes (Node) to the same model as the UI; the two decoded models deep-equal each other after the
exchange; for the same-field title the decoded value equals the UI value and is one of the two
submitted values; after the duplicate import the decoded model is unchanged.

#### E2E-FL-04 Rejection without mutation (REQ-FL-014, 013, 017)

Steps: A has saved data for `inc-2026-0042`. Capture `before`: visible model, `data-save-sequence`,
and the stored record (`sequence`, `checksum`, `savedAt`, `bytes`). Build capsule files in Node with
the built Capsule and Kit packages and write them to `testInfo.outputPath(...)`:
(1) genuine capsule for `inc-2026-9999`; (2) genuine capsule with app `patchboard` for
`inc-2026-0042`; (3) a genuine capsule with one update byte flipped; (4) a genuine capsule
truncated; (5) a text file that is not a capsule; (6) a buffer of 16 MiB + 1 bytes. Import each.
UI per file: `data-import-state="rejected"`; `data-import-code` equals `DocumentIdentityMismatch`,
`AppIdentityMismatch`, `ChecksumMismatch`, `Malformed`, `Malformed`, `OversizedRaw` respectively;
message names the other document `inc-2026-9999` for (1) and `patchboard` for (2); the text
"Nothing was changed." is visible; the visible model and indicator are identical to `before`; the
indicator stays `saved` with the same sequence.
Persisted: after every file, `readStoredRecords` returns the same `sequence`, `checksum`,
`savedAt` and bytes as `before`. Afterwards a new edit still saves (sequence increases), proving the
session stayed usable.

#### E2E-FL-05 Save failure then recovery (REQ-FL-009, 008, 012, 019)

Steps: A and B online then offline. A has saved baseline (await `data-save-state="saved"`). B creates a
new item "Replace gasket" and downloads a capsule. In A, inject `addInitScript` before navigation
(helper), then after A is saved, call `armWriteAbortOnce()` in the page and immediately import B's
file. Observe. Click "Download backup capsule" (real download). Click "Retry save". Reload offline.
UI: right after the import, `data-import-state="applied-unsaved"` with `data-import-code="TransactionAbortError"`;
an element with `role="alert"` contains "applied" and "NOT saved" and the lines about closing the
tab; "Retry save" and "Download backup capsule" are visible and keyboard focusable; the merged item
"Replace gasket" and A's own data are visible; indicator `data-save-state="error"` with label
"NOT saved to this device". After Retry: indicator `data-save-state="saved"`, the result text
"Saved locally. The imported changes are now stored on this device.", alert removed.
After reload (offline): "Replace gasket" is shown.
Persisted: right after the failure (before Retry) the stored record's `sequence` and bytes equal the
pre-import values and the decoded model does NOT contain "Replace gasket" (truth: unsaved). The
backup capsule file decodes (Node, `decodeCapsule` then Kit) to a model that contains "Replace
gasket" and A's own data. After Retry the stored `sequence` is greater than before and the
decoded model contains "Replace gasket". After reload the decoded model and the UI both contain it.

#### E2E-FL-06 Second tab of the same profile (REQ-FL-003)

Steps: one context. Page 1 opens the incident. Page 2 (same context) loads `/`.
UI: page 2 shows `html[data-session="in-use"]` and the in-use message with "Try again"; page 2
shows no incident data; page 1 stays `saved` and editable (an edit still saves). Then
`await page1.close()`. The test first waits, by READING state only, until the Web Lock is
released: `expect.poll(() => page2.evaluate(async () => (await navigator.locks.query()).held?.some((l) => l.name?.startsWith("ghostsync:lock:fieldledger")) ?? false)).toBe(false)`
(normal `expect.timeout`). Only then does it click "Try again" EXACTLY ONCE and await
`expect(page2.locator("html")).toHaveAttribute("data-session", "ready")` (normal `expect.timeout`),
then asserts the incident data is shown.
Persisted: still exactly one record for the profile; page 2 caused no write (sequence unchanged
between the in-use screen and the moment page 1 closed after its last save).

#### E2E-FL-07 Concurrent inserts and ordering (REQ-FL-005, 006)

The expected order is NEVER computed by `compareItems`, `sortEntries` or any other app helper. It is
the hand-written literal sequence of the fixture below (14.4.1).

Steps (fixture ORD-FIX-1, 14.4.1): the test builds the baseline capsule `ord-base.gscap` in Node
(built Kit and Capsule, the app adapters, items inserted in the scrambled order listed in 14.4.1).
Profiles A and B each import it through the file input. Offline, A imports `ord-a.gscap` (baseline
plus `ci-n2`) and B imports `ord-b.gscap` (baseline plus `ci-n1`), both built in Node. Then A
exports, B imports; B exports, A imports (real app-made files).
UI: on each page, `await page.locator('[data-testid="checklist"] li[data-item-id]').evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")))`
deep-equals the literal sequence `ORD_BASE_EXPECTED` after the baseline import, and
`ORD_CONCURRENT_EXPECTED` after the exchange, on BOTH profiles.
Persisted: the raw record decodes to items whose `sortKey` for `ci-n1` and `ci-n2` are both `5120`
(precondition asserted), the decoded item ID set equals the literal set, and the decoded models
are deep-equal across profiles.
Second part (app-generated IDs): fresh profiles from the same baseline each press "Add item" offline
with text "A item" / "B item". Decoded `sortKey` values are equal (both `max + 1024 = 5120`).
After exchange both pages show the two new IDs last, in the order of
`[idA, idB].sort()` (the default JavaScript string sort is code-unit order, written in the test
itself and not taken from the app).

#### 14.4.1 Ordering fixture ORD-FIX-1 and its literal expectation

Rule under test (requirements AC-FL-005-2): ascending `sortKey`, then item ID in JavaScript code-unit
order. Record IDs here are arbitrary strings (the Kit accepts any ID), chosen to exercise ties,
a prefix relation and upper versus lower case.

| ID | sortKey | text |
| --- | --- | --- |
| `ci-c3` | 2048 | Check valve |
| `ci-f6` | 4096 | Sign off |
| `ci-a1` | 2048 | Close inlet |
| `ci-b2` | 2048 | Record flow |
| `ci-e5` | 512 | Tag out valve |
| `ci-B2` | 2048 | Photograph gauge |
| `ci-d4` | 1024 | Isolate pump |
| `ci-a` | 2048 | Log pressure |

(The table is in the scrambled INSERTION order used by the test.) Hand derivation:

```ts
// Group by sortKey ascending: 512 | 1024 | 2048 (x5, tied) | 4096
//   512  -> ci-e5
//   1024 -> ci-d4
//   2048 -> tie, break by ID in code-unit order, comparing the text after "ci-":
//           "B2" (U+0042) < "a" (U+0061) < "a1" < "b2" (U+0062) < "c3" (U+0063)
//           "a" sorts before "a1" because a proper prefix is smaller.
//   4096 -> ci-f6
export const ORD_BASE_EXPECTED = [
  "ci-e5", "ci-d4", "ci-B2", "ci-a", "ci-a1", "ci-b2", "ci-c3", "ci-f6",
] as const;
```

Concurrent-insert case (same baseline): `ord-a.gscap` adds `ci-n2` "A item" with `sortKey` 5120;
`ord-b.gscap` adds `ci-n1` "B item" with `sortKey` 5120. 5120 is `max(4096) + 1024`, the value the
app assigns on append. Equal keys tie on ID: `"n1" < "n2"`, so `ci-n1` precedes `ci-n2` although
`ci-n2` is the item A created first locally.

```ts
export const ORD_CONCURRENT_EXPECTED = [
  "ci-e5", "ci-d4", "ci-B2", "ci-a", "ci-a1", "ci-b2", "ci-c3", "ci-f6", "ci-n1", "ci-n2",
] as const;
```

Unit-level counterpart (`tests/ordering.test.ts`): pass the eight fixture entries in the
scrambled order, and again reversed, to the app's exported `sortEntries`, and assert
`sortEntries(entries).map(([id]) => id)` equals `ORD_BASE_EXPECTED` literally (`toEqual`). The same
test with the two extra entries equals `ORD_CONCURRENT_EXPECTED`. The test never calls
`compareItems` to build an expectation. Both constants are written in the test file by hand. Their
reasoning is the comment above.

#### E2E-FL-08 Delete versus concurrent edit of an existing field: CHARACTERIZATION (REQ-FL-006, 004)

This test does not assert which operation wins (5.1). It asserts convergence and an enumerated
set of acceptable shapes.
Steps: shared baseline with item Q (text "Check valve", all fields present), imported into A and B.
Offline, A deletes Q and B edits the EXISTING field `Q.text` to "Check valve seat". Exchange both
ways (A exports, B imports; B exports, A imports; real files).
UI: (c) both pages show the same checklist (`li[data-item-id]` ID list deep-equal across pages);
no uncaught page error (`page.on("pageerror")` collected nothing); IF Q is shown as a "Conflicted
or incomplete item" row, it has "Restore" and "Discard" and nothing was repaired or hidden.
Persisted: (a) the two decoded states (Node decode of each raw record) are deep-equal. (b) The
decoded shape of Q is exactly one of: (i) absent on both; (ii) valid on both with `text`
"Check valve seat"; (iii) `invalidRecord` on both with identical `fields`. The test fails on any
other shape or on a difference between the profiles.
Evidence rule: the test logs the observed shape, and the implementer records it in 5.1 and in
tasks.md BEFORE any spec text names a winner. A violation of (a) to (c) is reported as a Kit
finding. It is not worked around.

#### E2E-FL-18 Invalid record rendering and explicit repair (REQ-FL-004)

Deterministic counterpart of the characterization above, so AC-FL-004-4 and AC-FL-004-5 do not
depend on the Kit's delete-versus-edit outcome. Steps: the test builds `incomplete.gscap` in Node
with the real Kit and a test-local partial adapter that has the SAME schema identity
(`app fieldledger`, `entityType checklistItem`, `schemaVersion 1`) but writes only `text`, giving
record `ci-q1` with `text` "Half item" and no other field. Profile A imports it.
UI: `li[data-item-id="ci-q1"]` is a "Conflicted or incomplete item" row whose text preview contains
"Half item" and which has "Restore" and "Discard"; nothing was repaired automatically (the
checklist has no normal row for `ci-q1`). Click "Restore" once: the row becomes a normal item with
text "Half item", `done` unchecked, and `data-save-state="saved"`.
Persisted: before Restore the raw record decodes `ci-q1` as `invalidRecord` with `fields`
containing only `text`; after Restore it decodes as `ok` with `text` "Half item" and the fallback
values of design 3.3.

#### E2E-FL-09 Keyboard-only operation (REQ-FL-016, 001, 005, 012)

Steps: using only `keyboard.press`/`type` (no clicks except the unavoidable native file chooser): focus the
join input, type an ID, press Enter; create incident details; add two items (Enter); toggle one with
Space; move one down; delete one; press the export button with Enter (download event). Observe focus.
UI: each focused control satisfies `toBeFocused()` and has a visible outline (computed
`outline-style` not `none` and `outline-width` exactly `3px`, matching AC-FL-016-2 and the CSS in
10.3); every action above completed; the export
download event fired. Import is checked as: the file input is reachable by Tab and has an accessible
name; `setInputFiles` completes the import.
Persisted: items and flags decoded from the stored record match the keyboard-made edits.

#### E2E-FL-10 First visit offline fails honestly; readiness gates "ready" (REQ-FL-010)

Steps: fresh context with `setOffline(true)`: `page.goto("/")` must reject (network error). Then
set online, load, and observe the readiness attributes.
UI: the offline `goto` rejects; online, `data-offline-state` reaches `ready` before the test goes
offline, and the first-visit notice is hidden when ready.
Persisted: not applicable (no session opened).

#### E2E-FL-11 Sub-path deployment (REQ-FL-010; optional, SHOULD)

Steps: serve the same `dist` at `/deploy-fl/`. Load, await ready, go offline, reload.
UI: boots from the service worker under the sub-path; `fromServiceWorker()` true for the document
and the JS asset; registration scope ends with `/deploy-fl/`.
Persisted: not applicable.

#### E2E-FL-12 Change incident: close first, failed close keeps the session (REQ-FL-001, 007)

File `e2e/session-lifecycle.spec.ts`. Covers AC-FL-001-7 and AC-FL-007-5.
Steps (a, success): open the incident, make one edit, await `data-save-state="saved"` and read its
`data-save-sequence` (S). Click `[data-testid="change-incident"]` once.
UI (a): `html[data-session]` becomes `join`; the join form is shown.
Persisted (a): the raw record `sequence` equals S, and the decoded model contains the edit.
Steps (b, failed close): reopen the incident, await `saved`, `armWriteAbortOnce()`, make an edit,
await `[data-testid="save-indicator"][data-save-state="error"]`, click Change incident once
(Persist `close()` rejects `CloseFailedError` because the final save cannot succeed).
UI (b): `html[data-session]` becomes `recovery`; `main[data-document-id]` still shows the old ID;
`[data-testid="recovery-panel"]` contains "Download backup capsule" and "Discard unsaved changes
and switch"; the join form is absent; the checklist is still readable. Click "Download backup
capsule" once (real download). Click "Discard unsaved changes and switch" once: `html[data-session]`
becomes `join`.
Persisted (b): the backup file decodes (Node) to a model containing the unsaved edit. After
reopening the same ID, the raw record `sequence` equals S and the decoded model lacks the unsaved
edit (nothing was silently saved).

#### E2E-FL-13 Page hide commits a focused draft (REQ-FL-007)

File `e2e/session-lifecycle.spec.ts`. Covers AC-FL-007-4.
Steps: one item exists and is saved (sequence S). Focus its "Item text" input and `fill("Check valve seat")`
without pressing Enter or blurring. Run `page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))`.
Then, on a second item, `fill("Log pressure hourly")`, override `document.visibilityState` to `hidden`
and dispatch `visibilitychange` on `document`.
UI: after each hide event `[data-testid="save-indicator"]` reaches `data-save-state="saved"` with
`data-save-sequence` greater than before, and the inputs show the committed texts.
Persisted: the raw record decodes to items with the two committed texts, so the drafts were part of
the replica and not lost. Before each hide event the test asserts the raw record does NOT yet
contain the draft (it was uncommitted, L-7).

#### E2E-FL-14 Failed edit save: alert and the beforeunload guard (REQ-FL-009, 008)

File `e2e/session-lifecycle.spec.ts`. Covers AC-FL-009-7 and AC-FL-009-9. Registers
`page.on("dialog")` to record dialog types.
Steps: one saved item (sequence S). `armWriteAbortOnce()` right before an edit of that item's text.
Await `[data-testid="save-indicator"][data-save-state="error"]`. Call
`page.close({ runBeforeUnload: true })` and dismiss the resulting dialog. Click "Retry save" once and
await `data-save-state="saved"`. Call `page.close({ runBeforeUnload: true })` again.
UI: `[data-testid="save-error-alert"]` has `role="alert"`, `data-save-error-kind="edit"`,
`data-save-error-code="TransactionAbortError"` and contains "Your latest changes are NOT saved to
this device." and the AC-FL-009-4 sentence. It does not contain "Capsule applied", and
`[data-testid="import-result"]` has no `data-import-state="applied-unsaved"`. "Retry save" and
"Download backup capsule" are visible. Guard: while in `error` the first `page.close` produces one
dialog of type `beforeunload` (dismissed, `page.isClosed()` is false). After Retry succeeds the alert
is gone, and the second `page.close` produces no dialog and `page.isClosed()` is true.
Persisted: while in `error` the raw record `sequence` and bytes equal the pre-edit values and the
decoded model lacks the edit. After Retry the decoded model contains the edit.
Note: the scenario closes the page. It never reloads in `error` (A5).



Failed edits (added 2026-11-15, AC-FL-009-10). `SessionController.guard()` stores a failed edit in
`editError` (`kind` `schema-mismatch` or `unexpected`, copy from `mapEditError`) and leaves `phase`,
`save` and `importView` untouched. The workspace renders it in its own host below the save alert as
`[data-testid="edit-error-alert"]` (`role="alert"`, `data-edit-error-kind`) with "Dismiss", "Download backup
capsule" (same export path as the save alert) and, for `schema-mismatch` only, "Reload app". The host is
rebuilt only when `editError` changes, so focus on its buttons survives other updates. Dismiss clears it
and moves focus to the title input (or the new-item input). A later successful edit also clears it. The
error and in-use screens still use `errorMessage` unchanged.
#### Note 2026-11-16: failed edit keeps the last good model (E2E-FL-20)

`guard()` no longer calls `refresh()` after a failed edit. It sets `editError`, notifies, and returns, so the model
shown stays the last one read successfully. `refresh()` now returns a boolean and keeps the last good model if the
read throws (for example a remote change that brings a newer schema), with no phase change. Open-time schema
mismatch is unchanged (error screen). The view redraws focused fields from the model when an edit error appears, so
an unapplied draft is not left looking applied. E2E-FL-20 (`e2e/session-lifecycle.spec.ts`) makes the mismatch REAL:
a Node-built capsule (the page's stored state plus schema meta for both collections at schemaVersion + 1, written
with the Kit's own meta key via the Kit's Yjs) is imported through the file input, then a title edit fails. Backup
uses `session.exportState()`, which does not touch the collections, and decodes with test-local higher-version
adapters. Metadata display (AC-FL-013-7): `ImportView.metadata` carries `result.metadata`; `src/transfer/capsule-meta.ts`
caps each value at 80 shown characters.

#### E2E-FL-19 Failed edit in the ready workspace (REQ-FL-009, AC-FL-009-10; added 2026-11-15)

File `e2e/session-lifecycle.spec.ts`, test "a failed edit in the ready workspace is shown, the workspace
stays usable, and it is not shown as saved". Real failure, test-side only: after creating incident details
and one checklist item (saved), the test sets the title input to 121 characters through the DOM (a value that
bypasses `maxlength`, as paste or autofill can) and fires `change`. The app's own `validate()` rejects the
put while reads still work, so `html[data-session]` stays `ready` and `guard()` catches the throw. A
schema-mismatch cannot be used here: the Kit re-checks the schema on every read, so `refresh()` would fail
first and show the error screen. That kind is covered by `tests/edit-error.test.ts`.
UI: `[data-testid="edit-error-alert"]` is visible, `role="alert"`, `data-edit-error-kind="unexpected"`, says
"Your edit was NOT applied" and "try the edit again, or reload the page". Incident inputs and the checklist
row stay visible and enabled, the title input shows the old value. `save-indicator` stays
`data-save-state="saved"` with an unchanged `data-save-sequence`; no `save-error-alert`; no `import-result`
state; no "saved" or "Capsule applied" wording in the alert. Keyboard: Tab moves from Dismiss to
"Download backup capsule". One click on the backup button yields a download that decodes to the pre-edit
state. One click on Dismiss removes the alert and returns focus to the title input.
Persisted: raw record `sequence` and bytes equal the pre-edit values and the decoded title is unchanged.
#### E2E-FL-15 Waiting worker and explicit "Update now" (REQ-FL-010)

File `e2e/offline-reload.spec.ts`. Covers AC-FL-010-8. Online, ready, with saved data.
Steps: `POST /__test/sw-bump` (14.3), then `page.reload()` while online. Read
`performance.timeOrigin` (T0). Observe the banner. Await `data-save-state="saved"`. Click "Update now"
once.
UI: `html[data-offline-state="waiting"]`; `[data-testid="update-banner"]` contains "A new version is
ready. Save your work, then update." and the button "Update now";
`(await navigator.serviceWorker.getRegistration()).waiting` is non-null and `performance.timeOrigin`
equals T0 while the banner is shown (no automatic `skipWaiting`). After the click the page reloads
(`performance.timeOrigin` differs from T0), `html[data-offline-state="ready"]` and `registration.waiting`
is null.
Persisted: the raw record decodes to the same model before and after the update.
Assumption A6 (to verify): Chromium installs the bumped worker as `waiting` after a navigation. If
that cannot be made deterministic, the result is reported as a finding and the criterion is then
explicitly downgraded to a documented manual check in a spec update. It is not silently dropped.

#### E2E-FL-16 320 px layout (REQ-FL-016)

File `e2e/session-and-keyboard.spec.ts`. Covers AC-FL-016-4.
Steps: open a workspace with one item whose text is 200 characters and with an import result
visible; `page.setViewportSize({ width: 320, height: 640 })`, then `1280 x 800`.
UI: at each size `document.documentElement.scrollWidth - document.documentElement.clientWidth` is
`<= 0`; at 320 no element inside `main` has `getBoundingClientRect().right` greater than 320.5
unless an ancestor inside `main` has `overflow-x: auto` (the test lists offenders in its failure
message). The primary actions (Export, Import input, Add item) are visible without horizontal
scrolling.
Persisted: not applicable.

#### E2E-FL-17 Import input disabled while an import runs (REQ-FL-013)

File `e2e/file-exchange.spec.ts`. Covers AC-FL-013-6 (and AC-FL-013-5). Uses the file-read gate (14.3).
Steps: profile B has saved data (sequence S). Call `holdNextFileRead()`. `setInputFiles` with a valid
capsule from A. Observe. Call `releaseFileRead()`.
UI: while held, `[data-testid="import-input"]` `toBeDisabled()` and
`[data-testid="import-result"]` has `data-import-state="importing"`. After release the input
`toBeEnabled()`, `data-import-state="applied-saved"`, and the input's `value` is `""`.
Persisted: while held the raw record `sequence` equals S. After release it is greater than S and
decodes to a model containing A's data.

### 14.5 Unit and component tests (Vitest, Node)

Pure tests need no browser. Browser tests are the Playwright scenarios above. A Node mock alone does
not establish browser persistence: persistence claims rest only on E2E-FL-01, 02, 03, 05.

| Test file | Type | Covers |
| --- | --- | --- |
| `document-id.test.ts` | pure | normalize, validate, route parse/format, preview |
| `replica-id.test.ts` | pure with in-memory store | stable reopen, distinct per document, malformed value regenerated |
| `ids.test.ts` | pure | `ci-` prefix, uniqueness over 10,000 generated IDs, format |
| `adapters.test.ts` | pure | validate/toFields/fromFields round trip; each invalid input; partial fields throw; extra keys ignored; bounds |
| `ordering.test.ts` | pure | compare, tie by ID, nextSortKey, keyBetween, renormalize minimal writes, invalid after valid; ORD-FIX-1 literal sequences through `sortEntries` (14.4.1) |
| `ordering.property.test.ts` | property, 3 properties x 4 batches x 50 runs (14.6) | order is permutation invariant; sort is a total order; renormalize preserves relative order |
| `kit-integration.test.ts` | Node with real `createKit` | write helpers write only changed fields; different items and fields both survive; same field converges to one submitted value; delete versus edit of an existing field (CHARACTERIZATION, 5.1): decoded states equal on both and the shape is one of absent, valid with the edit, or `invalidRecord`; a partial-adapter record is an `invalidRecord` with its preserved field; schema mismatch error recognized by `isSchemaMismatch`; stale form not used |
| `kit-integration.property.test.ts` | property, 2 properties x 4 batches x 50 runs (14.6) | random op sequences on two replicas, exchange both ways: replicas equal; every surviving field value was submitted by some op |
| `save-label.test.ts` | pure | full table of section 7.1 including sequence 0 |
| `errors.test.ts` | pure | every `CapsuleErrorCode`, every `PersistenceErrorCode`, schema mismatch, TypeError, read failure |
| `filename.test.ts` | pure | convention, UTC formatting, backup suffix, sanitization |
| `diff.test.ts` | pure | added, removed, changed, no changes, becameInvalid |
| `status-copy.test.ts` | pure | every `OfflineState` copy and the first-visit notice rule |
| `dist-scan.test.ts` | post-build | no failure-injection names, no `window.__` test hooks, no inline script when CSP meta present |

The Kit-integration tests use only public Kit API. They are Node tests and do not claim browser
behavior.

### 14.6 Property-test batching (mirrors the capsule suite)

Source pattern: `packages/capsule/tests/merge.property.test.ts` (`registerBatches`, `BATCH_SEEDS`,
`afterAll` totals) and the helper `packages/capsule/tests/fc-report.ts`. The capsule suite adopted
it because 200-run async properties exceeded the 5 s default as a single test. FieldLedger does
the same from the start.

- Every FieldLedger property is split into FOUR separately named Vitest tests of EXACTLY 50
  generated cases each, 200 per property.
- Fixed, distinct seeds per batch: batch 1 = `424242`, batch 2 = `424243`, batch 3 = `424244`,
  batch 4 = `424245` (the same four are reused by every property, as in the capsule suite).
- Each batch calls `fc.check(property, { numRuns: 50, seed })` with an explicit per-call seed and
  `numRuns`, which override the global `fc.configureGlobal({ numRuns: 200, seed: 424242 })` in
  `vitest.setup.ts` (same global as `packages/capsule/vitest.setup.ts`).
- Each batch asserts `result.numRuns === 50` and `result.numSkips === 0` (so generators use no
  `fc.pre` and no filter that discards cases) and adds `result.numRuns` to a per-property total.
- An `afterAll` in the same `describe` asserts the total of each property equals
  `4 x 50 = 200`.
- Failure replay: a shared helper `tests/fc-report.ts` (named WITHOUT `.test.ts`, so Vitest does not
  collect it), a mirror of `packages/capsule/tests/fc-report.ts`, prints
  `result`, `seed`, `numRuns`, `numSkips`, `numShrinks` for every batch and, on failure, the
  original error, the counterexample and `replay: seed=<seed> path=<counterexamplePath>`.
  Shrinking stays at fast-check's default.
- Test names: `<label>: <title> [batch <i>/4, seed <seed>, 50 runs]`.
- Default 5 s Vitest timeout. No `testTimeout`, no `hookTimeout`, no retries, no skips. No timeout
  increase is specified anywhere in this plan.
- Generators are bounded: at most 6 distinct item IDs, at most 12 operations per history, text
  at most 12 characters, `sortKey` integers within 0 to 8192 (plus a few fixed edge values). The
  properties are synchronous or use only the Kit's synchronous API, with no hashing, so they are
  light. The suite must still pass under full-suite parallel load, that is, with Vitest's default
  file parallelism (no `fileParallelism: false` is planned). If it does not, that is a finding to
  report and diagnose, not something to hide by raising a timeout.

Expected batch-test counts: `ordering.property.test.ts` = 3 properties x 4 = 12 batch tests;
`kit-integration.property.test.ts` = 2 properties x 4 = 8 batch tests; total 20 property batch
tests, 5 properties x 200 = 1000 generated cases. None of these has run.

### 14.7 Acceptance-criterion coverage

The AC-level table for the MUST criteria that review F-1 found uncovered is in `requirements.md`
section 9 and is mirrored in `tasks.md` section 7A. The scenarios above (E2E-FL-02, 12 to 17)
define the observations.

## 15. Consistency decisions and assumptions to verify at implementation

- A1: `session.collection(adapter)` marks a fresh session dirty on first open (Kit writes schema
  meta). The label mapping tolerates either outcome. Verify in E2E-FL-01 (sequence becomes > 0
  without a user edit is acceptable).
- A2: Whether the service worker request URL for `/#/i/<id>` matches the exact navigation URLs.
  Handled by the fallback; settled by E2E-FL-02 evidence.
- A3: `File.size` for a Playwright `setInputFiles` buffer payload equals the buffer length
  (needed by E2E-FL-04 (6)).
- A4: The Kit's `subscribe` fires for remote applies (origin `"remote"`) so the UI re-renders after
  import. If not observed, the import controller calls render explicitly after the import resolves.
  Either way the UI shows real state.
- A5: Playwright reload while a `beforeunload` guard is active would raise a dialog. No scenario
  reloads in `error` state. E2E-FL-14 deliberately closes the page with `runBeforeUnload` in `error`
  and dismisses the dialog to observe the guard (D-8: the guard exists only in `error`).
- A6: see E2E-FL-15 (a bumped worker becomes `waiting` after a navigation in Chromium).
- A7: the delete-versus-edit outcome on an existing field is unknown until observed (5.1).

## Implementation notes, 2026-11-14 (review history above is unchanged)

- Read path: one path, `listResults()`; the real contract matched section 3.3. Hosting: root only is required; `base: "./"` verified (see requirements note).
- A2 resolved by evidence: Chromium keeps the URL fragment on navigation requests seen by the service worker, so the copied worker's exact-URL shell match failed for `/#/i/<id>` offline. The adapted worker now clears `url.hash` before matching (the only logic change to the copied plugin besides the cache prefix `ghostsync-fieldledger-`, the removal of the test-only failing worker, and text). After the change, the hash route reloads offline (E2E-FL-02 prints the evidence); the `localStorage` fallback is also exercised.
- A6 verified: a byte-different `sw.js` installs as `waiting` after an online reload; `Update now` flushes first, then activates (E2E-FL-15).
- Deviations: (1) E2E-FL-01 and E2E-FL-03 are one test, `two-profile.spec.ts`. (2) The import flow lives in `session-controller.ts` (`importFile`, `buildCapsule`), not in a separate `transfer/import.ts`. (3) E2E-FL-12(b) uses a TEST-ONLY sticky abort (`setWriteAbortSticky`, installed by `addInitScript`) because a one-shot abort is consumed by the first failed save and `close()` would then succeed; no hook ships (dist-scan). (4) A restored session shows "Nothing to save yet" until its first save, because Persist does not expose the restored sequence; this is honest, not a "saved" claim. (5) No install-failure test: the copied plugin dropped the test-only failing worker, as section 8.2 specified.
- Not verified: A4 (the app calls `refresh()` after every action and import, so it does not depend on `subscribe` for remote applies); real browser quota exhaustion; subpath hosting beyond the optional test.
- 2026-11-16: `importFile()` uses the boolean from `refresh()`. On false, `ImportView.workspaceStale = true` and `diff` is omitted, so the view renders the notice and no diff. `onSaveState` spreads the existing view, so the flag and absent diff survive applied-unsaved to applied-saved after Retry save. The next import result replaces the view.
