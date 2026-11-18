# sdk-foundation — Design

> GhostSync Kit (`@ghostsync/kit`) — design for the sdk-foundation spec.
> Branch: `feat/sdk-foundation`. Design document only; no code is written in this step. Implementation begins only after the design-and-tasks review gate passes.
>
> **Verified baseline:** commit `ab37419` (independently verified). Real current `src` was read before writing this design; the signatures quoted under "Existing API (baseline, verified from source)" are copied from `packages/kit/src/types.ts` and `packages/kit/src/replica.ts` as they exist at `ab37419`.
>
> **Architecture-correction revision (revision 4).** An independent reviewer reproduced three real Yjs `13.6.33` behaviors that invalidated the previously-approved nested-`Y.Map<Y.Map<Scalar>>` model and two prose claims. This revision replaces the data model with **flat composite keys**, makes `put` a **changed-fields diff**, derives change notifications from **actual key deltas**, hardens the **state-vector/`applyUpdate` boundary**, and corrects the browser-compat and union-growth prose. All three documents (`requirements.md`, `design.md`, `tasks.md`) are kept mutually consistent. The ground-truth defects:
> - **A — nested-map identity loss:** two replicas each doing `parent.set(id, new Y.Map())` offline do not converge to one shared map; one side's fields are lost after sync.
> - **B — full-rewrite clobber:** rewriting all fields of an entity overwrites a concurrent edit to a different field.
> - **C — no-op still fires `afterTransaction`:** an empty no-op update fires `afterTransaction` once and `update` zero times.
>
> **Revision 5 (MEDIUM-1 correction — two separate top-level maps).** Revision 4 placed the flat composite keys in the **same** top-level `root` `Y.Map` as the legacy scalar keys and then needed a bare-vs-structured discriminator so `getState()` would project only legacy keys. The reviewer's MEDIUM-1 found that discriminator self-contradictory and undefined where a legacy user key is byte-identical to a structured key. This revision removes the discriminator entirely by using **two separate top-level shared maps in the same `Y.Doc`**: `doc.getMap("root")` holds the legacy scalar keys exactly as the `ab37419` baseline, and `doc.getMap("ghostsync:records:v1")` holds the structured composite-key records. Map membership — not a key-shape predicate — decides which API a key belongs to, so no legacy key is ever reserved, rejected, reclassified, or dropped. Both maps live in the same `Y.Doc`, so full-state and differential exports/imports carry both automatically.

## Overview

This design extends the verified scalar-`Y.Map` replica into a reusable SDK foundation for two genuinely different apps (FieldLedger incidents, PatchBoard cards) while keeping all sync logic in the Kit. It makes five additive moves: (1) a **flat-composite-key** data model held in a **second, dedicated top-level `Y.Map`** named `ghostsync:records:v1` (the existing top-level `root` map is left exactly as the baseline) — one leaf key per structured field whose key string encodes `collection + entityId + field`, so real records are represented without opaque JSON blobs **and without independently-created nested maps** (defect A); (2) a typed `EntityAdapter<T>` + `Collection<T>` layer that keeps each app's schema and validation out of the engine, with `put` implemented as a **changed-fields diff** (defect B); (3) richer identity (logical `documentId`, app/schema identity + version recorded as a reserved meta key so it travels with the data, Yjs `clientID`, future local persistence id) with an explicit "metadata does not authenticate" statement; (4) incremental sync via `Y.encodeStateVector` + `Y.encodeStateAsUpdate(doc, sv)` alongside the existing full-state export, with a validated `exportDiff`/`applyUpdate` boundary; and (5) origin-tagged transactions plus a change-notification subscription whose observable-change signal is derived from the transaction's **key delta** (defect C) and whose listener dispatch is exception-isolated. A small transport-neutral update contract is defined for the future file/QR tiers to consume. Foreign bytes are staged before merge so a rejected or malformed update cannot partially mutate the live document, with guarantees bounded honestly.

The design honors architecture steering: merge stays a pure function of updates; storage and transport remain pluggable seams the merge path never imports; IndexedDB and offline loading stay out of scope. It honors coding steering: strict TypeScript, no `any`, versioned public surface, private internals, and **no new dependency** (Yjs/Vitest/fast-check/TypeScript only). It preserves the baseline public API as a compatibility facade so the existing 37 tests and six fast-check properties keep passing unchanged.

## Technology stack (locked once approved)

- **Runtime:** Node.js (`v24.14.0`) for the proof suite. The library target is browser-compatible (NFR-SDK-001): `src` has no `node:` imports; `tsconfig` compiles with `lib: ["ES2022"]` and no `DOM`. Note: `packages/kit/tsconfig.json` sets `types: ["node"]`, which pulls Node ambient types into **type-checking only** (the proof suite runs on Node). This introduces **no runtime `node:` dependency into the emitted `dist`**. The `no-node-imports` source scan (task 9.16) over `src` is a **static** check of the compatibility requirement ("no `node:` imports, no DOM lib"); it is **not** proof of browser runtime behavior, and browser-executed evidence is **pending** (future work). No `tsconfig` edit is expected.
- **Language:** TypeScript (pinned `7.0.2`), `strict`, no `any` by default.
- **CRDT:** `yjs@13.6.33` (already pinned; the only runtime dependency). Verified APIs used: `Y.Doc`, `Y.Map`, `Y.encodeStateAsUpdate(doc)` / `Y.encodeStateAsUpdate(doc, stateVector)`, `Y.encodeStateVector(doc)`, `Y.applyUpdate(doc, bytes, origin?)`, `Y.mergeUpdates`, `Y.Doc#transact(fn, origin)`, `doc.on("afterTransaction", (tx) => ...)` (where `tx.changed` / `tx.changedParentTypes` expose the changed types and `tx.origin` the origin), `doc.on("update", ...)`.
- **Test runner:** `vitest@5.1.0`.
- **Property testing:** `fast-check@4.10.2`, global `numRuns: 200`, `seed: 424242` (existing `vitest.setup.ts`, unchanged), metrics via `tests/fc-report.ts`.
- **Package manager:** `pnpm@10.34.9` (pinned). No new lockfile, no new dependency.
- **Build:** `tsc` emitting `.js` + `.d.ts` to `dist/` via `tsconfig.build.json` (src-only emit), unchanged tooling.

## Existing API (baseline, verified from source)

Quoted verbatim from `packages/kit/src/types.ts` at `ab37419`:

```ts
export type Scalar = string | number | boolean | null;
export type State = Record<string, Scalar>;

export interface UpdateCarrier {
  readonly documentId: string;
  readonly bytes: Uint8Array;
}

export type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidCarrier" };

export interface Replica {
  readonly documentId: string;
  set(key: string, value: Scalar): void;
  delete(key: string): void;
  get(key: string): Scalar | undefined;
  has(key: string): boolean;
  exportState(): UpdateCarrier;
  applyUpdate(carrier: unknown): ApplyOutcome;
  getState(): State;
  destroy(): void;
}

export interface Kit {
  createReplica(documentId: string, seedBytes?: Uint8Array): Replica;
}
```

And from `packages/kit/src/replica.ts`: `export function createKit(): Kit`. Internally the replica stores the top-level map under the name `"root"` (`const ROOT_MAP = "root"`), applies `seedBytes` with `Y.applyUpdate` on construction, exports with `Y.encodeStateAsUpdate(doc)` (no state vector), validates the carrier shape (`invalidCarrier` for a non-object, missing/empty `documentId`, non-`Uint8Array` or zero-length `bytes`) before the `documentId` guard (`documentIdMismatch`), and guards every op after `destroy()` with `#assertAlive()` that throws `Error("GhostSync Kit: replica has been destroyed")`. `getState()` is `project(this.#map())` from `src/state.ts` — a flat `Record<string, Scalar>` of the `root` map's keys.

### Compatibility decision (what stays, what changes, and why)

**Stays, unchanged and backward-compatible:**

- `Scalar`, `State`, `UpdateCarrier`, `ApplyOutcome` — all exported types stay. `ApplyOutcome` **gains one additional `ok: false` reason** (`"malformedUpdate"`, REQ-SDK-007). This is additive for consumers that read the `reason` field, but it is a **potential minor breaking change for an exhaustive consumer** — a `switch (outcome.reason)` with no `default` branch would need a new case to stay exhaustive under `strict`. We record this honestly per NFR-SDK-004 rather than calling it universally source-compatible.
- `createKit()` and `Kit.createReplica(documentId, seedBytes?)` — same signature.
- `Replica.set/delete/get/has/getState/exportState/applyUpdate/destroy` — all stay with identical signatures and semantics. **`getState()` remains the FLAT baseline projection** of the `root` map — it projects **every** key in the `root` map, unchanged from the baseline `project()`, with no filtering, no sentinel inspection, no escaping, and no reserved prefixes (see Storage layout); it is **not** redefined to return all structured entities. Baseline flat keys are written by `set` directly into the `root` map exactly as before, so `replica.set("alpha", 1)` / `replica.getState()` behave byte-for-byte as the baseline. A legacy key is **never** rejected or reserved — including a key that begins with the structured sentinel character or that is byte-identical to a structured field key — because structured keys live in a **different map** and can never appear in `root`.

**Why two separate top-level maps rather than one shared `root` map or a reserved nested map.** NFR-SDK-005 requires the 37 existing tests and six properties to keep passing without edits, and the baseline tests assert `replica.set("alpha", 1)` → `getState()` deep-equals `{ alpha: 1, beta: 2 }` — a flat projection of the `root` map's keys. `packages/kit/tests/projection.test.ts` additionally pins that a user may `set("__proto__", …)`, `set("constructor", …)`, `set("toString", …)` and `getState()` must project **exactly** those keys and no others. So the legacy API MUST keep operating on `root` and `getState()` MUST stay the unconditional projection of **every** `root` key.

Revision 4 stored structured fields as additional composite keys in the **same** `root` map and then needed a bare-vs-structured discriminator so `getState()` would skip the structured keys. The reviewer's MEDIUM-1 showed that discriminator is self-contradictory: "first char ≠ `SENTINEL`" wrongly drops a legacy key that happens to start with `\u0001` (and a legacy key can be made byte-identical to a structured field key), while the alternative "keys the engine wrote" predicate needs an ownership index the design never defined and that would itself be conflictable CRDT state.

This revision removes the discriminator by giving the structured model its **own** top-level shared map, `doc.getMap("ghostsync:records:v1")`, in the **same** `Y.Doc` as `root`. The two maps are disjoint by construction: the legacy `set/get/has/delete/getState` path touches only `root`, and the structured `Collection`/codec path touches only `ghostsync:records:v1`. **Map membership decides** which API owns a key — there is no key-shape predicate, no sentinel inspection on `root`, and no reserved prefix in `root`. A legacy key byte-identical to a structured field key is simply a different key in a different map; each API reads its own value from its own map. We do **not** introduce a `__default__` nested map and do **not** create nested per-entity maps (that is exactly defect A). Because both maps belong to one `Y.Doc`, `Y.encodeStateAsUpdate(doc)` (full) and `Y.encodeStateAsUpdate(doc, sv)` (differential) serialize both maps together, so sync carries legacy and structured state in one pass. This is the additive, lowest-risk, collision-free path, and it preserves the baseline byte fixture because `root`'s encoded structure is untouched.

**Additive changes (new surface, no break):**

- New types: `SchemaIdentity`, `Fields`, `EntityAdapter<T>`, `Collection<T>`, `ChangeEvent`, `ChangeListener`, `Unsubscribe`, `TransportUpdate`, `StateVector`, `TransportEnvelope`, `ExportDiffResult`.
- New `Replica` methods: `collection<T>(adapter)`, `exportDiff(remoteStateVector)`, `exportStateVector()`, `subscribe(listener)`. Added to the interface; existing methods unchanged.

The one place a consumer could observe a difference is the internal Yjs structure of exported bytes (a second top-level `ghostsync:records:v1` map alongside `root`). Because equality in tests is the **plain projection** (legacy keys via `getState()`, structured entities via `Collection#list`), not byte identity, and the `root` map is untouched, the existing tests remain valid and the baseline byte fixture still restores to the same flat projection.

## Storage layout (two separate top-level maps)

The document is one `Y.Doc` holding **two separate top-level shared maps**:

1. **`doc.getMap("root")` — the legacy scalar map.** This is the baseline map, name and behavior unchanged from `ab37419`. `replica.set/get/has/delete` operate **directly** on it with bare keys, and `getState()` projects **every** key in it via the baseline `project()` — no sentinel filtering, no escaping, no reserved prefixes, no migration, no parser or heuristic classification of any key. A legacy key is **never** rejected or reserved: a key beginning with the structured sentinel character, or a key byte-identical to a structured field key, is a perfectly valid legacy key because structured keys live in a different map and can never appear in `root`. The baseline byte fixture restores unchanged because `root`'s encoded structure is identical to the baseline.
2. **`doc.getMap("ghostsync:records:v1")` — the structured records map.** This holds the flat composite-key structured records: one leaf scalar key per entity field and one reserved meta key per collection. Every value is a scalar; there are **no nested `Y.Map` values** (defect-A avoidance) and **no nested per-entity maps**. All internal prefixes, sentinels, and escaping described below apply **only inside this map** — they never touch `root`.

**Map membership, not a key-shape predicate, decides ownership.** There is no bare-vs-structured discriminator anywhere. The legacy path reads and writes only `root`; the structured path reads and writes only `ghostsync:records:v1`. A key string that could in principle appear in both maps denotes two unrelated values — the legacy `get` reads its value from `root`, the `Collection` reads its value from the records map — and neither can shadow or reclassify the other.

**Both maps travel together in sync.** Because `root` and `ghostsync:records:v1` are top-level types in the **same** `Y.Doc`, `Y.encodeStateAsUpdate(doc)` (full state) and `Y.encodeStateAsUpdate(doc, stateVector)` (differential) serialize **both** maps in one update, and `Y.applyUpdate` merges both. No extra plumbing is needed for the records map to participate in full or differential sync.

**Reserved bytes (inside the records map only).** Two control bytes are reserved for the composite-key encoding **within `ghostsync:records:v1`** (chosen because they are ASCII control characters never valid in application collection/entity/field names, and they are escaped if they do appear). These reservations have **no effect on `root`**:

- `SENTINEL = "\u0001"` (Start of Heading) — the first character of every structured or meta key in the records map. The `"f"`/`"m"` kind tag follows it.
- `SEP = "\u001f"` (Unit Separator) — the segment separator inside a composite key.

**Composite field key grammar (keys inside `ghostsync:records:v1`).**

```
fieldKey  = SENTINEL "f" SEP esc(collection) SEP esc(entityId) SEP esc(field)
metaKey   = SENTINEL "m" SEP esc(collection)         // value: JSON string of SchemaIdentity
esc(s)    = s with every "\u0000" -> "\u0000\u0000",
                        every SENTINEL ("\u0001") -> "\u0000\u0001",
                        every SEP ("\u001f") -> "\u0000\u001f"
```

`esc` uses `\u0000` (NUL) as the escape introducer and doubles a literal NUL, so the three reserved bytes (`\u0000`, `\u0001`, `\u001f`) in any name are encoded unambiguously and no collection/entity/field name — including names containing a separator, the sentinel, or the reserved words `"f"`/`"m"` — can forge another address. `"f"`/`"m"` are a fixed single-character **kind** segment that sits *before* the first `SEP`, so an escaped name can never be mistaken for the kind tag. Parsing splits on unescaped `SEP` and unescapes each segment. This encoding exists purely to keep records inside the records map collision-free; it is never applied to or consulted for `root` keys. This resolves AC-SDK-002-9 (name escaping) concretely.

**Why this model and not nested maps or JSON blobs.** Three models were considered:

1. **One opaque JSON string per entity** — rejected: explicitly disallowed by the requirements, and it destroys field-level CRDT merge (any concurrent edit to any field conflicts on the whole blob).
2. **`Y.Map<Y.Map<Scalar>>` (nested maps)** — **rejected because of reproduced defect A.** Two replicas that each independently do `entities.set(id, new Y.Map())` offline create two *different* Yjs map objects at the same key; after sync one object wins the top-level key and the other's fields are **lost**. This is fatal for offline-first concurrent creation (no server, no pre-sync), which is the product's core scenario. The previously-approved design chose this model; the independent reproduction invalidates it.
3. **Flat composite keys in a dedicated `Y.Map` (chosen).** Every field is one leaf scalar key in `ghostsync:records:v1`. "Creating" entity E concurrently on two replicas is just concurrent `recordsMap.set(fieldKey, value)` of **sibling leaf keys** — which merge at field level exactly like any other key, so no side's fields are lost (the defect-A guard). Concurrent different-field edits are different keys → both survive. Same-field edits are the same key → native Yjs LWW. "Delete entity E" is deleting all of E's field keys in **one local Yjs transaction** (local atomicity); concurrent deletion semantics are field-level per Yjs. Reusing a deleted id is just writing its field keys again. The previously-stated objection to composite keys — "delete needs a scan-and-delete of many keys" — is answered by distinguishing **local transaction atomicity** (one `doc.transact` deletes all of E's keys atomically on that replica) from **concurrent deletion semantics** (how that delete merges against a concurrent field write, which is native, field-level, and documented). Placing these keys in their own map (rather than alongside the legacy keys in `root`) is what lets the composite encoding stay internal with zero risk to the legacy key space.

**Entity enumeration.** `Collection#list()` and `Collection#get(id)` enumerate by scanning the **records map** (`ghostsync:records:v1`) keys for this collection's structured field keys (prefix `SENTINEL "f" SEP esc(collection) SEP`), grouping by the decoded entity id, and projecting each group's fields. They never read `root`. An entity "exists" iff it has at least one live field key. No separate index structure is stored (keeping the CRDT free of a second source of truth that could itself conflict).

**Merge behavior (native Yjs, asserted in tests, not custom):**

- **Concurrent creation of the same entity id (AC-SDK-002-4, defect-A guard):** A writes `E.title`, `E.severity`; B writes `E.notes`, `E.severity`. These are sibling leaf keys; after exchange both replicas hold the union `{title (A), notes (B), severity (one of A/B by LWW)}`. No side's fields are lost. A test reproduces the exact scenario that failed under nested maps and asserts both sides' fields survive.
- **Concurrent different-field edits (AC-SDK-002-2):** A sets `E.title`, B sets `E.priority`; distinct keys → both survive.
- **Same-field conflict (AC-SDK-002-3):** A sets `E.title="x"`, B sets `E.title="y"`; same key → native Yjs LWW keeps exactly one; the other is discarded. We assert agreement + membership in the submitted set, never which specific value wins, never wall-clock.
- **Deletion (AC-SDK-002-5):** `delete(E)` runs `doc.transact(() => { for (const k of E's field keys) recordsMap.delete(k); })` — one transaction, atomic locally. After exchange E's fields are absent on both.
- **Edit concurrent with deletion (AC-SDK-002-6):** A deletes all of `E`'s fields while B concurrently writes `E.newField`. Native Yjs resolves per key: the keys A deleted stay deleted; the key B wrote survives. The converged entity is the single-field `{ newField }` (a field-level, not entity-level, delete). Both replicas converge to one identical snapshot; the test records that outcome. Documented as field-vs-entity delete granularity.
- **Reused deleted id (AC-SDK-002-7):** after deleting E, writing E's fields again recreates E; a field concurrently deleted-and-rewritten resolves by native LWW. Recommended policy: reuse allowed (rationale: an entity is only its live keys, so there is no tombstone to honor and no extra machinery to deny reuse).

**Projection (AC-SDK-002-8):** `getState()` returns a fresh null-prototype object of **every `root` key**, reusing the baseline `project(this.#map("root"))` unchanged (own data properties for `__proto__`/`constructor`/`toString`, fresh object each call, no filtering). Because structured keys live in a separate map, `getState()` never sees them and needs no predicate to exclude them. `Collection#get`/`list` build each entity on a fresh null-prototype field object the same way from the records map, then run `fromFields`.

## Public API additions

```ts
// packages/kit/src/adapter.ts (public)

/** App/schema identity an adapter declares and a collection records inside the doc. */
export interface SchemaIdentity {
  readonly app: string;            // e.g. "fieldledger" | "patchboard"
  readonly schemaVersion: number;  // monotonic per app
  readonly entityType: string;     // e.g. "incident" | "card"
}

/** Scalar field record an entity is stored as. Field values are scalars only. */
export type Fields = Record<string, Scalar>;

/**
 * App-supplied, typed contract for ONE entity type. The engine never imports an
 * adapter; a consumer passes it to `replica.collection(adapter)`. Keeps app
 * schema + validation out of the sync engine (REQ-SDK-001).
 */
export interface EntityAdapter<T> {
  readonly schema: SchemaIdentity;
  /** Throw (TypeError) if `entity` is not a valid T for this schema. Structural
   *  scalar/shape validation only; deferred app business rules are out of scope. */
  validate(entity: T): void;
  /** Project a validated T to a flat scalar field record for storage. */
  toFields(entity: T): Fields;
  /** Reconstruct a typed T from a stored scalar field record. */
  fromFields(fields: Fields): T;
}
```

```ts
// packages/kit/src/collection.ts (public)

/** A typed view over one entity type inside a document (REQ-SDK-001/002/003A). */
export interface Collection<T> {
  /** Create-or-overwrite the entity at `id` by CHANGED-FIELDS DIFF (REQ-SDK-003A):
   *  validate (throw before mutating on failure), then in ONE local transaction
   *  write only the leaf keys whose scalar value changed, delete leaf keys for
   *  fields omitted from `entity`, and leave unchanged fields untouched. Never a
   *  full rewrite — an unchanged field generates no write (defect-B guard). */
  put(id: string, entity: T): void;
  /** Read and reconstruct the entity at `id`, or undefined if absent. Runs
   *  fromFields + validate on the read; an incomplete/invalid record throws the
   *  controlled `IncompleteRecordError` (clarification 4). */
  get(id: string): T | undefined;
  /** Like get, but returns a controlled outcome instead of throwing on an
   *  incomplete/invalid record (clarification 4). */
  getResult(id: string): GetResult<T>;
  /** List all [id, entity] pairs whose stored fields reconstruct a valid T
   *  (invalid records are skipped, not thrown). */
  list(): ReadonlyArray<readonly [string, T]>;
  /** Enumerate EVERY stored entity id — INCLUDING invalid/incomplete records —
   *  as [id, GetResult<T>] using the SAME GetResult shape getResult() returns,
   *  without deleting, repairing, or fabricating any field (correction round 3).
   *  A caller discovers invalid records by filtering `!r.ok && r.reason ===
   *  "invalidRecord"` and inspects the preserved stored fields on `r.fields`
   *  (and the reconstruction error on `r.cause`); `absent` never appears because
   *  every enumerated id has at least one live field key. list() stays valid-only;
   *  listResults() is the discovery path for records list() omits. */
  listResults(): ReadonlyArray<readonly [string, GetResult<T>]>;
  /** Delete the entity at `id` — remove all its field leaf keys in ONE local
   *  transaction. No-op if absent (AC-SDK-002-5). */
  delete(id: string): void;
  /** Whether an entity has at least one live field key at `id`. */
  has(id: string): boolean;
}

/** Controlled read outcome (clarification 4). */
export type GetResult<T> =
  | { readonly ok: true; readonly entity: T }
  | { readonly ok: false; readonly reason: "absent" }
  | { readonly ok: false; readonly reason: "invalidRecord"; readonly id: string; readonly fields: Fields; readonly cause: unknown };

/** Thrown by get() (not getResult/list) on an incomplete/invalid record; never
 *  corrupts or deletes the underlying fields. */
export class IncompleteRecordError extends Error {}
```

```ts
// packages/kit/src/types.ts (additions — existing types unchanged)

/** Opaque state-vector carrier for incremental sync (REQ-SDK-004). */
export interface StateVector {
  readonly documentId: string;
  readonly kind: "stateVector";
  readonly bytes: Uint8Array;
}

/** Transport-neutral update the future file/QR tiers consume (REQ-SDK-006). */
export interface TransportUpdate {
  readonly documentId: string;
  readonly kind: "full" | "diff";
  readonly bytes: Uint8Array;
}

/** Union a transport layer may move. Each is a plain serializable value. */
export type TransportEnvelope = TransportUpdate | StateVector;

/** ApplyOutcome gains one additive reason (REQ-SDK-007). NOTE: additive for
 *  reason-reading consumers; a potential MINOR breaking change for an exhaustive
 *  switch with no default (NFR-SDK-004). */
export type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidCarrier" }
  | { readonly ok: false; readonly reason: "malformedUpdate" };

/** exportDiff result — a diff on success, or a distinguishable rejection (REQ-SDK-007-8). */
export type ExportDiffResult =
  | { readonly ok: true; readonly update: TransportUpdate }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidStateVector" };

/** Change-notification event (REQ-SDK-005). */
export interface ChangeEvent {
  readonly documentId: string;
  /** "local" for local writes, "remote" for applied updates. */
  readonly origin: "local" | "remote";
}
export type ChangeListener = (event: ChangeEvent) => void;
export type Unsubscribe = () => void;

/** Replica interface additions (existing members unchanged). */
export interface Replica {
  // ...all existing members stay exactly as quoted above, getState() still FLAT...
  /** Typed structured view for one entity type (REQ-SDK-001/002). */
  collection<T>(adapter: EntityAdapter<T>): Collection<T>;
  /** State vector for incremental sync (REQ-SDK-004-2). */
  exportStateVector(): StateVector;
  /** Differential update vs a peer's state vector (REQ-SDK-004-1/3). Validates the
   *  peer StateVector carrier; returns a distinguishable rejection on a bad carrier
   *  (REQ-SDK-007-8). A valid diff is always non-empty Yjs bytes, even for a no-op. */
  exportDiff(remoteStateVector: unknown): ExportDiffResult;
  /** Full-state export, typed as TransportUpdate (kind:"full"). Structurally
   *  still satisfies the baseline UpdateCarrier (REQ-SDK-006-4). */
  exportState(): TransportUpdate;
  /** Subscribe to local/remote OBSERVABLE changes; returns an unsubscribe fn (REQ-SDK-005). */
  subscribe(listener: ChangeListener): Unsubscribe;
}
```

Note: `exportState()`'s return type narrows from `UpdateCarrier` to `TransportUpdate`. `TransportUpdate` is structurally `{ documentId: string; bytes: Uint8Array }` **plus** a `kind` field, so it still satisfies `UpdateCarrier` consumers reading `documentId`/`bytes`. `exportDiff(remoteStateVector: unknown)` takes `unknown` and validates the carrier at the boundary (the state vector is a future **transport** message, not a trusted same-process value). This is **Unresolved decision U2** with a recommended choice below.

## Identity

Four independent dimensions (REQ-SDK-003):

- **Logical `documentId`** — caller-supplied string on the `Replica` and in every carrier; stored separately from Yjs; never derived from `clientID`.
- **Application/schema identity + version** — `SchemaIdentity { app, schemaVersion, entityType }` declared by the adapter and **recorded inside the document** as a reserved meta leaf key `SENTINEL "m" SEP esc(collection)` in the **records map** (`ghostsync:records:v1`) whose value is the JSON string of the `SchemaIdentity`. Because it is a leaf key in a top-level map of the same `Y.Doc`, it is included in `exportState`/`exportDiff` bytes and is therefore **re-derivable on remote import**, not merely a process-local first-open registry. `replica.collection(adapter)`: if no meta key exists for the collection, it is written (first open); if one exists, the stored `SchemaIdentity` must be compatible with the adapter's (`app`, `schemaVersion`, `entityType` equal), else the open is rejected (`Error("GhostSync Kit: schema mismatch for collection …")`) and nothing is mutated. A mismatch after export/restore or remote import is thus detectable (AC-SDK-003-2, AC-SDK-007-2).

**Correction round — schema recheck on EVERY collection operation.** A prior independent review confirmed a real gap: the recheck ran before `put` (and at open), but `get`/`getResult`/`list`/`delete`/`has` did NOT recheck, so a handle opened at v1 kept serving reads/enumeration/deletes after a causally-newer v2 meta arrived. This correction ADDS the recheck to the read, enumeration, and delete paths (and to the new `listResults`): `put`, `get`, `getResult`, `list`, `listResults`, `delete`, and `has` all call the schema-compatibility guard BEFORE doing any work, so a mismatch raises the same documented schema-mismatch `Error` on every operation — it is never degraded into an `absent`/`undefined` result or an `invalidRecord` outcome. A delete through an incompatible handle throws before any key scan or transaction, so it neither mutates nor notifies. The guard also VALIDATES the parsed meta before comparing (`assertSchemaIdentity` on the `JSON.parse` result), so a corrupt persisted meta (a non-string value, unparseable JSON, the literal `null`, a non-object, or a value missing/mistyping `app`/`entityType`/`schemaVersion`) produces a controlled schema-mismatch error rather than a crash or a silent pass. The determinism of the regression comes from writing the v2 meta as a CAUSAL SUCCESSOR of v1 (a raw source doc seeded from the v1 state overwrites the meta key, a happens-after overwrite), so the converged winner is v2 with no concurrent LWW coin-flip.
- **Yjs session `clientID`** — fresh per `new Y.Doc()`; used only by Yjs for CRDT ordering; never used as document identity (AC-SDK-003-3).
- **Local persistence identifier** — a future storage-layer key, defined as derived from `documentId` (e.g. `"ghostsync:" + documentId`), documented as the storage tier's concern and **not** implemented here (AC-SDK-003-4).

**Metadata does not authenticate (AC-SDK-003-5).** `documentId`, `app`, and `schemaVersion` are descriptive intent only. They do not prove the bytes are well-formed, do not prove they belong to the document, and do not authenticate the sender. A checksum (future capsule tier) detects corruption; it does not authenticate the sender. The engine's only boundary guards at `applyUpdate` are the carrier/kind/`documentId` checks; they are integrity/identity, not authentication. Verified behaviorally (wrong-`documentId` → `documentIdMismatch`, state unchanged), never by scanning comments.

## Incremental synchronization

Alongside the full-state export, the replica adds (REQ-SDK-004):

- `exportStateVector(): StateVector` → `{ documentId, kind: "stateVector", bytes: Y.encodeStateVector(doc) }`.
- `exportDiff(remoteStateVector: unknown): ExportDiffResult`. The peer `StateVector` is treated as an **untrusted transport carrier** (it is a future transport message, not inherently same-process). `exportDiff` validates it before use (REQ-SDK-007-8): shape (`{ documentId: string, kind: "stateVector", bytes: Uint8Array }`), `documentId` equal to this replica's, `kind === "stateVector"`, and that `Y.encodeStateAsUpdate(doc, bytes)` does not throw on the encoded state-vector bytes. On success → `{ ok: true, update: { documentId, kind: "diff", bytes } }`; on a bad carrier → a distinguishable `{ ok: false, reason }` (`documentIdMismatch` for a wrong id, `invalidStateVector` for a malformed shape, wrong kind, or state-vector bytes that fail to decode). `exportDiff` never mutates the document and never fires a notification.

Scenarios:

- **Initial sync (AC-SDK-004-1):** B's state vector is the empty-doc vector; A's diff against it carries everything B lacks; applying to B converges B to A.
- **Already-synchronized peers → legitimate no-op (AC-SDK-004-3):** when A and B are fully synchronized, `Y.encodeStateAsUpdate(doc, peerSV)` returns a **valid but content-empty** Yjs update — **non-zero-length** Yjs framing bytes, not `Uint8Array(0)`. The carrier still carries real bytes and passes carrier validation; applying it changes **no key**, so it fires no notification (AC-SDK-005-6). Zero-length bytes remain `invalidCarrier`.
- **Duplicate delivery (AC-SDK-004-4):** re-applying the same diff is idempotent (native Yjs) and changes no key the second time → no notification.
- **Restore-then-sync (AC-SDK-004-5):** restore from a saved full-state export (`createReplica(documentId, seedBytes)`), then `exportStateVector()` and exchange diffs with a peer that made disjoint edits; both converge with all nonconflicting edits.
- **Full-state export unchanged (AC-SDK-004-6):** `exportState()` still calls `Y.encodeStateAsUpdate(doc)` with no state vector; diff is additive.

## Lifecycle notifications and feedback-loop prevention

Every mutation runs inside `doc.transact(fn, origin)` with a module-private origin symbol: `LOCAL_ORIGIN` for `set`/`delete`/`Collection` writes and `REMOTE_ORIGIN` for `applyUpdate`'s merge. The replica subscribes once to `doc.on("afterTransaction", (tx) => ...)`.

**Observable change derived from the key delta of both maps (defect-C correction).** The previously-approved design claimed "Yjs fires no transaction event for a no-op"; the independent reproduction shows a no-op update fires `afterTransaction` **once** (and `update` zero times). So the engine does **not** infer "something changed" from the event firing. Instead, the `afterTransaction` handler inspects the transaction's **key delta for both top-level maps** — the keys added, updated, or deleted in `root` *and* in `ghostsync:records:v1`. The single concrete accessor the implementation uses is `transaction.changed.get(map)`, which returns a `Set<string|null>` of changed keys for that map (undefined or empty for that map means no change there): `transaction.changed.get(doc.getMap("root"))` for the legacy map and `transaction.changed.get(doc.getMap("ghostsync:records:v1"))` for the records map. The engine notifies subscribers **at most once per transaction**, and does so **iff the combined key delta across both maps is non-empty**. A transaction that changes either or both maps yields a **single** notification; a no-op transaction (both deltas undefined/empty) notifies **zero** subscribers even though `afterTransaction` fired. This is derived, not assumed.

- **Local vs remote (AC-SDK-005-1/2):** `tx.origin === REMOTE_ORIGIN ? "remote" : "local"`.
- **No feedback loop (AC-SDK-005-3):** a re-broadcasting subscriber re-exports **only when `event.origin === "local"`** — it already holds the bytes that produced a `"remote"` event. **Termination mechanism (tied to AC-SDK-005-6):** applying an already-known remote update produces an **empty key delta**, so it fires **zero** notifications → the receiver never re-broadcasts → the exchange reaches a fixpoint. A test wires two replicas' subscribers to each other, re-broadcasting only on `origin === "local"`, and asserts (a) convergence and (b) that the second/already-known apply fired zero notifications.
- **No-op does not notify (AC-SDK-005-6):** empty key delta → no notification. Stated as derived behavior, not as "Yjs emits no event".
- **Subscriber exception isolation (AC-SDK-005-7):** each listener is invoked inside its own `try/catch`; a thrown error is swallowed (optionally logged at `warn`) and does not stop other listeners and does not propagate into the `applyUpdate`/local-write caller. A listener error is therefore never reported as `malformedUpdate` or any other apply failure.
- **Unsubscribe (AC-SDK-005-4):** `subscribe` returns a function that removes just that listener from the internal `Set`.
- **Destroy (AC-SDK-005-5):** `destroy()` clears all listeners and `doc.destroy()`; any op except `destroy` after destroy throws the baseline `Error`; repeated `destroy` is a no-op.

**Decision: `afterTransaction` vs `observeDeep`.** We use a single `doc`-level `afterTransaction` subscription and read the key delta of both top-level maps from the transaction (`transaction.changed.get(doc.getMap("root"))` and `transaction.changed.get(doc.getMap("ghostsync:records:v1"))`). Rationale: one notification per transaction (matching "invoke subscribers once per transaction") regardless of how many maps a single transaction touched, native access to `tx.origin` and the per-map key deltas (which is exactly what defect-C correction requires), and O(1) observers regardless of entity count. This is **Unresolved decision U3** with the recommended choice stated below.

## Transport boundary

The transport-neutral contract is exactly the `TransportUpdate` / `StateVector` types above (REQ-SDK-006). They are plain, serializable `{ documentId, kind, bytes }` values. A future file transport serializes one of these into a capsule (adding version, size bound, checksum); a future QR transport chunks `bytes`. None of that — capsule encoding, checksums, size bounds, QR, transport UI — is built here. `applyUpdate` accepts any value structurally satisfying the baseline carrier **whose `kind` is absent, `"full"`, or `"diff"`**; a `kind:"stateVector"` or unknown kind is rejected (see Validation).

## Validation and error behavior

Per-layer responsibilities and the concrete failure table:

| Operation | Failure condition | Layer | Recoverable? | Caller receives | Logged |
| --- | --- | --- | --- | --- | --- |
| `collection.put(id, entity)` | `adapter.validate` throws | adapter (consumer-facing) | Fatal (caller bug) | rethrown `TypeError`/`Error`, no mutation | error |
| `collection.put` | a `toFields` value is non-scalar | engine field guard | Fatal (caller bug) | throws `TypeError` before mutation | error |
| `replica.collection(adapter)` | adapter `SchemaIdentity` incompatible with the collection's recorded meta key | engine | Fatal (caller bug) | throws `Error("…schema mismatch…")`, no mutation | error |
| `set(key, value)` | non-scalar value | engine (`assertScalar`) | Fatal (caller bug) | throws `TypeError` before mutation | error |
| `applyUpdate(carrier)` | not a non-null object / missing-or-empty `documentId` / non-`Uint8Array` or zero-length `bytes` | engine boundary | Recoverable | `{ ok:false, reason:"invalidCarrier" }` before decode, no notification | warn |
| `applyUpdate(carrier)` | `carrier.kind === "stateVector"` or an unknown explicit `kind` | engine boundary | Recoverable | `{ ok:false, reason:"invalidCarrier" }` before decode, no notification | warn |
| `applyUpdate(carrier)` | `carrier.documentId !== replica.documentId` | engine boundary | Recoverable | `{ ok:false, reason:"documentIdMismatch" }` before decode, no notification | warn |
| `applyUpdate(carrier)` | shape+kind+id OK but `bytes` throw during the guarded live merge | engine boundary | Recoverable | `{ ok:false, reason:"malformedUpdate" }`, live doc rebuilt from the pre-apply snapshot (observable projection deep-equal to before; observer was detached so no mid-throw state dispatched), no notification | warn |
| `exportStateVector` | none | engine | n/a | the carrier | — |
| `exportDiff(remoteStateVector)` | malformed carrier shape / wrong `kind` / undecodable SV bytes | engine boundary | Recoverable | `{ ok:false, reason:"invalidStateVector" }`, no mutation, no notification | warn |
| `exportDiff(remoteStateVector)` | wrong `documentId` | engine boundary | Recoverable | `{ ok:false, reason:"documentIdMismatch" }`, no mutation, no notification | warn |
| `exportState` | none | engine | n/a | the carrier | — |
| a change subscriber throws | listener bug | engine (isolated) | Recoverable | exception swallowed/logged; other listeners still run; apply outcome unchanged | warn |
| any op except `destroy` after `destroy` | destroyed | engine | Fatal (caller bug) | throws `Error("…replica has been destroyed")` | error |
| `destroy()` twice | — | engine | Recoverable | idempotent no-op | — |

**`applyUpdate` boundary order (AC-SDK-007-3/4/5).** The checks run strictly in this order, each before the next decodes anything:

1. **Shape** — non-null object, non-empty string `documentId`, `Uint8Array` non-zero-length `bytes`; else `invalidCarrier`.
2. **Kind** — `carrier.kind` is `undefined`, `"full"`, or `"diff"`; a `"stateVector"` or any unknown value is `invalidCarrier`. A shared `{ documentId, bytes }` shape does not make state-vector bytes into update bytes, so the kind gate rejects state vectors **before** the bytes are ever handed to `Y.applyUpdate` (REQ-SDK-007-4).
3. **Document id** — `carrier.documentId === replica.documentId`; else `documentIdMismatch`.
4. **Guarded live merge (snapshot-rollback).** See the "Guarded live merge and recovery" paragraph immediately following this list. The foreign bytes are applied directly to the live doc with the change observer detached and a pre-apply snapshot held for rollback; a separate empty scratch decode and a staging-copy-then-swap are both NOT performed (both roughly doubled/×6 per-apply cost and pushed the baseline property suites past the 5s per-test timeout). The observer detach means the live doc is never exposed to subscribers mid-throw, so the rejection guarantee is unchanged.

**Guarded live merge and recovery (AC-SDK-007-5/6, critical).** The baseline `applyUpdate` called `Y.applyUpdate(doc, bytes)` directly on the live doc; a malformed/adversarial payload could throw mid-mutation, and we must **not** assume Yjs rolls back. The engine therefore (1) captures a committed pre-apply snapshot `Y.encodeStateAsUpdate(doc)` (serializes both maps AND pending out-of-order updates), (2) detaches the durable change observer and attaches a one-shot delta probe, (3) applies the foreign bytes directly to the live doc under `try/catch`, (4) on throw rebuilds the committed doc from the snapshot and reattaches the observer (the possibly partially-mutated doc is destroyed and was never dispatched to subscribers because the observer was detached), and (5) on success reattaches the observer and fires one notification iff a key changed. A staging-copy-then-swap and a separate empty scratch decode were both considered and dropped for performance (~6× and ~2× per-apply cost; they broke the baseline property suites' 5s timeout); direct-apply-with-snapshot-rollback gives the same observable-projection guarantee and keeps pending updates. The sequence, equivalently stated:

1. Before merging, capture a committed snapshot of the live doc: `const snapshot = Y.encodeStateAsUpdate(doc)` (this serializes both maps AND pending out-of-order updates).
2. Detach the durable `afterTransaction` observer and attach a one-shot delta probe that records whether any key changed in **either** top-level map (`root` or `ghostsync:records:v1`) via `transaction.changed.get(doc.getMap(...))`. With the durable observer detached, subscribers cannot see any mid-throw partial state.
3. Apply the foreign bytes directly to the live doc under `try/catch`.
4. **Success:** reattach the durable observer; if the probe saw a non-empty key delta, fire one `remote` notification. Active subscriptions and previously-returned `Collection` handles keep working because they reference the replica, not the doc object (collections resolve `this.#doc` lazily each call).
5. **Reject by rollback:** if the apply throws, rebuild the committed doc from `snapshot` into a fresh `Y.Doc`, reattach the observer to the rebuilt doc, destroy the old (possibly partially-mutated) doc, and return `{ ok:false, reason:"malformedUpdate" }` with **no** notification.

This makes AC-SDK-007-5/7 concrete: any `ok:false` ⇒ the committed live doc's observable projection is deep-equal to before and no notification fired; `ok:true` ⇒ decodable and merged.

**Correction round — real partial-mutation recovery regression.** The snapshot-rollback strategy above is unchanged; a correction-round regression now proves it against GENUINE partial mutation rather than an early-decode no-op. Crafted exactly as the independent reviewer did with the pinned Yjs: encode a full-state update whose `root` map carries `injected="bad"`, then truncate the final byte (`bytes.slice(0, -1)`). A CONTROL assertion first proves these bytes partially mutate a raw `Y.Doc` — applying them throws yet leaves `root["injected"]==="bad"` present — so the regression exercises real partial mutation past a decoded struct. (Verified in this environment: `slice(0, -1)` reproduces the throw-with-`injected`-present; deeper truncations throw before `injected` lands, so the exact final-byte cut is the minimal corruption that proves partial mutation.) The SAME bytes fed through the public `applyUpdate` to a populated replica (legacy keys + structured records + an active subscriber + a held `Collection` handle) return `{ ok:false, reason:"malformedUpdate" }`, the legacy AND structured projection is deep-equal to before, `root` has no `injected`, zero notifications fire, the held handle and subscriber keep working, and subsequent local edits plus differential sync with a peer converge. A pending out-of-order update also survives an intervening rejected malformed apply and integrates once its prerequisite is delivered. The failure is driven purely through crafted bytes at the public boundary — no production API exists to inject failures.

**Honestly-bounded guarantee (AC-SDK-007-6/7).** The guarantee is over the **observable projection** (`getState()` + `Collection#list`), enforced by the detached-observer direct apply + snapshot rollback. We do **not** claim unconditional rollback of arbitrary internal Yjs state merely because the JSON projection was restored. **Pending out-of-order updates ARE preserved (clarification 2, VERIFIED):** Yjs 13.6.33 `encodeStateAsUpdate` incorporates the doc's pending structs/deletes, so (a) the success path applies to the live doc that already holds any pending updates, and (b) the rollback snapshot carries them. The earlier claim that a full-state snapshot might drop pending updates (and that such loss was acceptable) is REMOVED. `malformed-update.test.ts` proves it: a later diff delivered before its prerequisite, across an intervening successful apply, converges with every expected edit preserved; delete-before-insert and snapshot/restore also converge.

> **Implementation note (U6).** Direct-apply + snapshot-rollback is the chosen strategy. The heavier staging-copy-then-swap (and a separate empty scratch decode) were rejected on performance grounds: each did a full `encodeStateAsUpdate` + `new Y.Doc()` + extra `applyUpdate` on EVERY apply (~6× / ~2× cost), which broke the unmodified baseline property suites' 5s per-test timeout under parallel load. The one hazard of direct apply — a partially-mutated doc observed by the `afterTransaction` handler mid-throw — is removed by detaching the observer for the raw apply and computing the delta with a one-shot probe. See U6 below.

**Validation ≠ authentication, bounded scope (AC-SDK-007-9).** In scope now: carrier shape, kind, document identity, decodability via the staging merge, and (at the future capsule tier) size bounded before decode. Deferred to the capsule/schema tier: payload size bounds, capsule version checks, checksums, and **adapter-level field validation of foreign bytes** — a peer could introduce a field the local adapter would reject on a local write; this is a stated, bounded limitation, not silently ignored. Only structural scalar/shape validation is in scope; deferred application business rules are explicitly out of scope now. None of this authenticates a sender.

## Example consumer usage

### FieldLedger — incident adapter (genuinely different schema #1)

```ts
import { createKit, type EntityAdapter } from "@ghostsync/kit";

interface Incident {
  title: string;
  severity: "low" | "medium" | "high";
  reportedAt: number;   // epoch ms
  resolved: boolean;
  notes: string | null;
}

const incidentAdapter: EntityAdapter<Incident> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "incident" },
  validate(i) {
    if (typeof i.title !== "string" || i.title.length === 0) throw new TypeError("title required");
    if (!["low", "medium", "high"].includes(i.severity)) throw new TypeError("bad severity");
    if (!Number.isFinite(i.reportedAt)) throw new TypeError("bad reportedAt");
    if (typeof i.resolved !== "boolean") throw new TypeError("bad resolved");
    if (!(i.notes === null || typeof i.notes === "string")) throw new TypeError("bad notes");
  },
  toFields: (i) => ({ title: i.title, severity: i.severity, reportedAt: i.reportedAt, resolved: i.resolved, notes: i.notes }),
  fromFields: (f) => ({
    title: f.title as string,
    severity: f.severity as Incident["severity"],
    reportedAt: f.reportedAt as number,
    resolved: f.resolved as boolean,
    notes: f.notes as string | null,
  }),
};

const kit = createKit();
const replica = kit.createReplica("ops-incidents-2026");
const incidents = replica.collection(incidentAdapter);
incidents.put("inc-1", { title: "Pump offline", severity: "high", reportedAt: Date.now(), resolved: false, notes: null });
// A later put that changes only `resolved` writes ONLY the `resolved` field key (changed-fields diff).
incidents.put("inc-1", { ...incidents.get("inc-1")!, resolved: true });

const stop = replica.subscribe((e) => { if (e.origin === "local") queueExport(replica.exportState()); });
// ... later: stop();
```

### PatchBoard — card adapter (genuinely different schema #2)

```ts
import { createKit, type EntityAdapter } from "@ghostsync/kit";

interface Card {
  column: "todo" | "doing" | "done";
  title: string;
  order: number;
  assignee: string | null;
}

const cardAdapter: EntityAdapter<Card> = {
  schema: { app: "patchboard", schemaVersion: 1, entityType: "card" },
  validate(c) {
    if (!["todo", "doing", "done"].includes(c.column)) throw new TypeError("bad column");
    if (typeof c.title !== "string") throw new TypeError("bad title");
    if (!Number.isFinite(c.order)) throw new TypeError("bad order");
    if (!(c.assignee === null || typeof c.assignee === "string")) throw new TypeError("bad assignee");
  },
  toFields: (c) => ({ column: c.column, title: c.title, order: c.order, assignee: c.assignee }),
  fromFields: (f) => ({
    column: f.column as Card["column"],
    title: f.title as string,
    order: f.order as number,
    assignee: f.assignee as string | null,
  }),
};

const board = createKit().createReplica("sprint-42");
const cards = board.collection(cardAdapter);
cards.put("card-9", { column: "todo", title: "Wire QR tier", order: 10, assignee: null });
cards.put("card-9", { ...cards.get("card-9")!, column: "doing" }); // changed-fields diff: writes only `column`
```

The same `createKit()`/`Replica`/`collection` engine serves both; the engine references neither `Incident` nor `Card`. This is the two-genuinely-different-schemas proof (AC-SDK-001-3).

## How an external consumer imports the built package

Unchanged from baseline `package.json`: `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`, `"main"/"module"` → `./dist/index.js`, `"types"` → `./dist/index.d.ts`, `"files": ["dist"]`. After `pnpm build` (`tsc -p tsconfig.build.json`), a consumer does `import { createKit, type EntityAdapter, type Collection, type TransportUpdate } from "@ghostsync/kit";` and gets the emitted ESM `dist/index.js` plus `dist/index.d.ts` types. All new public types are re-exported from `src/index.ts`. No exports-map change is needed.

## Proposed implementation files (planning only — not created in this step)

New source files under `packages/kit/src/`:

- `src/adapter.ts` — `SchemaIdentity`, `Fields`, `EntityAdapter<T>` types.
- `src/keys.ts` — composite-key codec used **only** for the records map: `RECORDS_MAP = "ghostsync:records:v1"`, `SENTINEL`/`SEP`, `esc`/`unesc`, `fieldKey(collection, id, field)`, `metaKey(collection)`, `parseFieldKey`. Pure, browser-safe, no `node:`. No bare-vs-structured predicate is exported (map membership decides ownership).
- `src/collection.ts` — `Collection<T>` interface + `CollectionImpl` bound to the `ghostsync:records:v1` map via the key codec: `put` changed-fields diff, `get`/`list`/`delete`/`has`, schema-identity record/compat check, local-origin writes. Never touches `root`.

Modified source files (additive; existing behavior preserved):

- `src/types.ts` — add `StateVector`, `TransportUpdate`, `TransportEnvelope`, `ExportDiffResult`, `ChangeEvent`, `ChangeListener`, `Unsubscribe`; extend `ApplyOutcome` with `malformedUpdate`; extend `Replica` with `collection`/`exportStateVector`/`exportDiff`/`subscribe` and narrow `exportState` to `TransportUpdate`. `getState()` stays the flat projection of every `root` key.
- `src/replica.ts` — origin symbols + `transact`; `collection<T>()` bound to the `ghostsync:records:v1` map; `exportStateVector`/`exportDiff` (with carrier validation); `subscribe`/unsubscribe/listener `Set`; single `afterTransaction` observer that notifies once iff the combined key delta of `root` and `ghostsync:records:v1` is non-empty; kind-gated, direct-apply + snapshot-rollback-on-throw `applyUpdate` (observer detached for the raw apply; see U6); baseline `set/delete/get/has/getState` keep operating directly on the `root` map (every key projected, no key reserved or rejected).
- `src/index.ts` — re-export the new public types.

New test files under `packages/kit/tests/`:

- `adapter.test.ts`, `fieldledger-adapter.test.ts`, `patchboard-adapter.test.ts` — REQ-SDK-001.
- `entities.test.ts`, `two-map-layout.test.ts`, `concurrent-create.structured.test.ts`, `conflict.structured.test.ts`, `deletion.structured.test.ts`, `key-escaping.test.ts` (incl. the legacy/structured byte-collision and sentinel-prefixed-legacy-key regressions) — REQ-SDK-002.
- `convergence.structured.property.test.ts` — REQ-SDK-002 property.
- `put-changed-fields.test.ts` — REQ-SDK-003A (includes the A-title/B-priority defect-B regression).
- `identity.test.ts`, `schema-identity.test.ts` — REQ-SDK-003.
- `diff-sync.test.ts`, `diff-sync.property.test.ts` — REQ-SDK-004.
- `notifications.test.ts`, `no-feedback-loop.test.ts` — REQ-SDK-005.
- `transport-contract.test.ts` — REQ-SDK-006.
- `validation.structured.test.ts`, `malformed-update.test.ts`, `apply-kind-boundary.test.ts`, `export-diff-rejection.test.ts` — REQ-SDK-007.
- `baseline-fixture.test.ts` — NFR-SDK-005 (restore baseline `ab37419` bytes).
- `no-node-imports.test.ts` — NFR-SDK-001 (source scan; static check only).

All 14 existing test files stay as-is (NFR-SDK-005). No `package.json`, lockfile, `tsconfig*`, or `vitest*` change is required by the design.

## Testability

- **Unit-testable:** key codec round-trip + escaping (`key-escaping.test.ts`), adapter round-trip, collection CRUD, changed-fields `put` diff, concurrent-create field union, schema-mismatch rejection across restore/import, structured projection safety, identity separation, state-vector/diff round-trips, no-op diff non-emptiness, kind-gated + snapshot-rollback-recovery `applyUpdate` (incl. the out-of-order-dependency / delete-before-insert / snapshot-restore regressions), `exportDiff` carrier rejection, notification key-delta derivation + unsubscribe + destroy + listener-throw isolation, transport-contract shapes, baseline byte fixture restore. All synchronous, in-memory.
- **Property-testable (fast-check, seed 424242, 200 runs, metrics via `tests/fc-report.ts`):** structured convergence over arbitrary nonempty entity/field edits including concurrent creation of the same id (commutativity/idempotency/associativity carried over), and diff-based convergence matching full-state convergence.
- **Hard-to-test (noted):** actual browser execution (NFR-SDK-001 is a static check only — a lib-config check and a `no-node-imports` scan, NOT browser runtime, which is pending); real transport/capsule behavior (out of scope). Pending out-of-order Yjs updates across a swap ARE covered (clarification 2) by the dependency regression in `malformed-update.test.ts` — they are preserved, not a bounded gap.

## Unresolved decisions (each with a recommended choice)

- **U1 — Baseline compatibility: two separate top-level maps vs one shared `root` map (with a discriminator) vs a reserved nested map.** *Recommendation:* **two separate top-level shared maps in the same `Y.Doc`** — `doc.getMap("root")` keeps the legacy scalar keys exactly as the baseline (`getState()` projects every `root` key, no filtering), and `doc.getMap("ghostsync:records:v1")` holds the structured composite keys. Rationale: preserves the 37 tests and the baseline byte fixture exactly; avoids the nested-map construct (defect A); and removes the self-contradictory bare-vs-structured discriminator the single-shared-`root` approach required (reviewer MEDIUM-1). Map membership decides ownership, so no legacy key is ever reserved, rejected, or reclassified. The prior `__default__` nested-map facade and the single-shared-`root`-with-discriminator approach are both rejected.
- **U2 — `exportDiff` input type: `StateVector` vs `unknown` + validation.** *Recommendation:* type the parameter `unknown` and validate at the boundary, returning `ExportDiffResult`. Rationale: the state vector is a future **transport** message, not a trusted same-process value; the boundary must reject malformed carriers with distinguishable reasons (REQ-SDK-007-8).
- **U3 — Notification mechanism: `afterTransaction` + key delta vs `observeDeep`.** *Recommendation:* single `doc`-level `afterTransaction` subscription, notify at most once per transaction and only when the combined key delta of `root` and `ghostsync:records:v1` (`transaction.changed.get(map)` for each map) is non-empty. Rationale: one event per transaction regardless of how many maps it touched, native `tx.origin`, O(1) observers, and it is exactly the mechanism defect-C correction requires (derive change from the delta, not from the event firing).
- **U4 — Where field-level non-scalar validation lives for `collection.put`.** *Recommendation:* run `adapter.validate` first (app structural rules), then the engine's `assertScalar` on each `toFields` value (structural guard), both before computing the diff. Rationale: keeps app semantics in the adapter and the scalar invariant owned by the engine.
- **U5 — Reused-deleted-id policy.** *Recommendation:* **reuse allowed.** Rationale: an entity is only its live field keys, so there is no tombstone to honor; writing the id's fields again recreates it, and a concurrently deleted-and-rewritten field resolves by native LWW. Denying reuse would require a separate tombstone index that would itself conflict.
- **U6 — Live-merge recovery: staging-on-copy + swap vs direct-apply + rebuild-on-throw.** *Resolved:* **direct-apply + snapshot-rollback-on-throw**, with the change observer detached for the raw apply so no mid-throw partial state can be dispatched. Rationale: staging-copy-then-swap (and a separate empty scratch decode) did a full snapshot + `new Y.Doc()` + extra apply on every call (~6×/~2× cost) and broke the unmodified baseline property suites' 5s timeout; direct-apply keeps the same observable-projection guarantee at a fraction of the cost and preserves pending out-of-order updates (verified, clarification 2). The `Collection` handles and subscriptions survive because they reference the replica and resolve the doc lazily (relevant only on the rare rollback path, which rebuilds `this.#doc`).
- **U7 — `ApplyOutcome` union growth.** *Recommendation:* add `"malformedUpdate"` and record it as a **potential minor breaking change** for an exhaustive consumer `switch` with no `default`. Rationale: honesty per NFR-SDK-004; it is additive for reason-reading consumers but not universally source-compatible.

## Responses to review findings

### Architecture-correction revision (independent review reproduced Yjs defects A/B/C)

This revision is a response to an independent review that **reproduced real Yjs `13.6.33` data-loss defects** in the previously-approved design. The verdict file at `.kiro/specs/sdk-foundation/.review/review.json` was `APPROVED` with 2 NITs, but the independent reproduction supersedes it on the three substantive defects. Each correction and how it maps to a task and a planned test:

- **Defect A (nested-map identity loss). Addressed.** The data model is replaced from `Y.Map<Y.Map<Scalar>>` to **flat composite keys in the dedicated `ghostsync:records:v1` `Y.Map`** (§ Storage layout). Concurrent offline creation of the same entity id is concurrent sibling-key sets that merge field-level; no side's fields are lost. No nested per-entity maps are used. Task T3.1/T3.3; test `concurrent-create.structured.test.ts` reproduces the exact failing scenario and asserts both sides survive.
- **Defect B (full-rewrite clobber). Addressed.** `put` is a **changed-fields diff** (REQ-SDK-003A, § `Collection<T>`): validate, then write only changed leaf keys, delete omitted-field keys, no write for unchanged fields. Task T3.3; test `put-changed-fields.test.ts` runs the A-changes-title / B-changes-priority regression and asserts both survive.
- **Defect C (no-op still fires `afterTransaction`). Addressed.** The false "Yjs never emits for a no-op" claim is removed; notifications are derived from the transaction **key delta** (§ Lifecycle notifications). A no-op (empty delta) notifies zero subscribers even though `afterTransaction` fired once. Task T6.3; tests `notifications.test.ts` / `no-feedback-loop.test.ts`.
- **State-vector / `applyUpdate` boundary. Addressed.** `applyUpdate` gains an explicit **kind gate** (reject `stateVector`/unknown before decoding) and `exportDiff` validates its peer `StateVector` carrier with distinguishable reasons and no mutation/notification (§ Validation; REQ-SDK-007-4/8). Tasks T5.2/T7.3; tests `apply-kind-boundary.test.ts` / `export-diff-rejection.test.ts`.
- **Recovery lifecycle honesty. Addressed (implementation-reconciled).** The live merge uses **direct-apply + snapshot-rollback-on-throw** with the change observer detached for the raw apply (so no mid-throw partial state is dispatched), the committed doc rebuilt from the snapshot on a throw, and subscriptions/`Collection` handles preserved (they resolve the doc lazily). The guarantee is bounded to the observable projection; pending out-of-order updates ARE preserved and verified (§ Validation, U6; REQ-SDK-007-6). Task T7.3; test `malformed-update.test.ts` including the garbage-bytes rollback path, the dependency/out-of-order regression, delete-before-insert, snapshot/restore, and continued-edit-and-sync-after-rejection.
- **Schema identity travels with the data. Addressed.** `SchemaIdentity` is recorded as a reserved meta leaf key in the `ghostsync:records:v1` map, a top-level type of the same `Y.Doc`, so it is in exported bytes and re-derivable on remote import; mismatch is detectable after restore/import (§ Identity; REQ-SDK-003-2). Task T3.4; test `schema-identity.test.ts`.
- **Documentation accuracy. Addressed.** The "guaranteed browser-compatible" claim is downgraded to a static-check-only requirement with browser execution **pending** (§ Technology stack, NFR-SDK-001); the `ApplyOutcome` union growth is recorded as a potential minor breaking change for exhaustive consumers (U7, NFR-SDK-004), not universally source-compatible.
- **Baseline preserved. Addressed.** Baseline keys stay in `root`; `getState()` stays the flat projection of every `root` key; a `baseline-fixture.test.ts` restores `ab37419` bytes; the 37 tests / 6 properties stay unedited (§ Compatibility; NFR-SDK-005). Task T3.2/T9.17/T10.

### Architecture-correction revision 5 (MEDIUM-1: two separate top-level maps)

The independent architecture-correction review (`.review/spec-correction-verdict.json`, `.review/spec-correction-review.md`) returned `CHANGES_REQUESTED` with 1 MEDIUM and 2 NITs against revision 4. It confirmed defects A/B/C were reproduced and the corrections held, but blocked on MEDIUM-1. Each finding and the response:

- **MEDIUM-1 — bare-vs-structured discriminator self-contradictory and undefined at the collision boundary. Addressed by removing the discriminator entirely.** Revision 4 placed structured composite keys in the **same** `root` map as the legacy scalar keys, then needed a bare-vs-structured predicate so `getState()` would project only legacy keys; the reviewer showed the three statements of that predicate disagreed (design item 1's "first char ≠ `SENTINEL`"; the `SENTINEL` paragraph's "keys the engine wrote … deterministic re-derivation; see below"; tasks 3.1's dual definitions), and that a legacy key byte-identical to a structured field key (e.g. `\u0001f\u001fcol\u001fE\u001ftitle`) had undefined projection behavior. The user's chosen fix — applied here across all three docs — is the reviewer's spirit beyond both Option A and Option B: use **two separate top-level shared maps in the same `Y.Doc`** (`root` for legacy, `ghostsync:records:v1` for structured). This **removes the discriminator altogether**: `getState()` projects every key in `root` unconditionally (reusing the baseline `project`), the structured codec and all sentinels/escaping are scoped **inside** `ghostsync:records:v1` only, and **map membership — not a key-shape predicate — decides ownership**. No legacy key is reserved or rejected (the proposed restriction on `\u0001`-prefixed legacy keys is removed), and a legacy key byte-identical to a structured field key simply denotes two unrelated values in two maps. The dangling "see below … deterministic re-derivation" reference is deleted. A collision regression is planned (test 9.8 extended; see `tasks.md`): a legacy `root` key byte-identical to a structured field key coexists with that structured field, and each API reads its own value from its own map (planned collision test 1); legacy keys beginning with the sentinel char remain valid in `root` (planned collision test 2). Both maps export together because they share one `Y.Doc` (test 9.13/9.17).
- **NIT-1 — `tx.changed` accessor described two ways. Addressed.** The § Lifecycle notifications section now states exactly one accessor, `transaction.changed.get(map)` (a `Set<string|null>`; undefined/empty for that map = no change), applied to `doc.getMap("root")` and `doc.getMap("ghostsync:records:v1")`; the vague "/ the `keys` delta" alternative wording is dropped.
- **NIT-2 — superseded "re-seed-on-throw" recovery language in the prior `.review/review.md`. Addressed (docs hygiene).** A dated note was added to `.review/review.md` labelling its revision-3 "pre-apply full-state snapshot + re-seed the live doc on throw" description as **superseded** by the staging-and-swap (U6) strategy, which is the only live recovery strategy in force. The review history itself is preserved (no content deleted).

### NIT findings from the prior `APPROVED` review (`.review/review.json`)

- **NIT-1 — REQ-SDK-007 traceability row (`T3, T5, T7` vs `T3, T7`). Addressed.** The requirements traceability table now maps REQ-SDK-007 to `T3, T7`, matching the tasks coverage matrix.
- **NIT-2 — REQ-SDK-006 intro prose "state-vector request". Addressed.** The REQ-SDK-006 lead sentence now reads "… a `kind` discriminator — `\"full\"` or `\"diff\"` on a `TransportUpdate`, `\"stateVector\"` on a `StateVector`", dropping "request".

### Prior revision history (rounds 1–2, superseded where the model changed)

Earlier revisions closed six round-1 and three round-2 findings against the nested-map design (scratch-staging "cannot throw" over-statement; no-feedback predicate; destroy error string; `types:["node"]` note; `exportState` narrowing; REQ-SDK-003 traceability; `Collection` op names; `StateVectorRequest`→`StateVector` rename; `exportDiff` error-table row). Those fixes are carried forward here where still applicable; the data-model change in this revision supersedes any part of them that assumed nested maps (notably the old scratch-staging-only recovery, now staging-and-swap, and the old merge-semantics section, now composite-key).
