# core-sync-proof — Design

> GhostSync Kit (`@ghostsync/kit`) — design for the core-sync-proof spec.
> Branch: `feat/kiro-steering`. This is a design document only; no code is written in this step. Implementation begins only after the design and tasks review gate is passed.

## Overview

This design implements the core-sync-proof requirements as a small, strict-TypeScript library inside `packages/kit`, exercised entirely by Node.js unit and property tests. The proof centers on a `Replica` that wraps an independent in-memory `Y.Doc`, exposes a scalar-valued top-level `Y.Map`, and provides a full-state export/apply path plus a restore lifecycle. Two or more replicas of the same logical document start from the same seed, edit independently offline, then converge by exchanging raw Yjs bytes carried alongside a caller-supplied logical document ID. Equality is always the plain-JSON projection of the map compared by deep equality — never reference identity and never encoded-byte comparison. Conflict resolution is native Yjs with no custom ordering. Validation is intentionally narrow: basic carrier validation plus a document-ID guard, with hostile-byte handling, payload limits, capsule versioning, and checksums explicitly deferred to future work.

The design honors the architecture steering: merge is a pure function of updates applied to a doc; storage and transport are pluggable adapters that the merge path never imports. The proof uses direct in-memory handoff as the transport surrogate and export-then-restore as the persistence-reload surrogate, with the real adapters described (not implemented) at the end.

## Technology stack (locked once approved)

- **Runtime:** Node.js (env: `v24.14.0`).
- **Language:** TypeScript, `strict`, no `any` by default (coding steering).
- **CRDT:** `yjs` (latest stable) — the only runtime dependency added for the proof.
- **Test runner:** `vitest`.
- **Property testing:** `fast-check`, configured with its supported options `numRuns: 200` and `seed: 424242` (correction 2 — `baseSeed` is NOT a valid option). Run/skip/shrink counts and the counterexample/replay path are read from the runner's result object.
- **Deep-equality assertion:** Vitest `expect(...).toEqual(...)` in tests only (correction 1). The Kit's `src` has NO `node:util` import and NO runtime `deepEqualState` helper — deep-equality is a test concern.
- **Package manager:** `pnpm@10.34.9` (pinned via root `packageManager`); no other lockfiles.
- **Build:** `tsc` emitting declarations to `dist/` (no bundler; minimal dependency graph).

These are the only additions to `packages/kit`. No app packages change.

## Public API

The Kit exposes a small, versioned surface. Internals (`Y.Doc` handle, the map name, projection details) are private; consumers use only these types and the `Kit` factory.

```ts
// packages/kit/src/types.ts (public)

/** A scalar map value. Numbers must be finite (not NaN, not ±Infinity). */
export type Scalar = string | number | boolean | null;

/** Observable state: the plain JSON projection of the top-level Y.Map. */
export type State = Record<string, Scalar>;

/** A raw Yjs update carried alongside a caller-supplied logical document ID. */
export interface UpdateCarrier {
  readonly documentId: string;
  readonly bytes: Uint8Array;
}

/** Distinguishable apply result — never thrown for recoverable cases. */
export type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidCarrier" };

/** A handle to one independent in-memory replica. */
export interface Replica {
  /** The caller-supplied logical document ID this replica belongs to. */
  readonly documentId: string;
  /** Local edit: set a scalar value for a key. */
  set(key: string, value: Scalar): void;
  /** Local edit: delete a key. No-op if the key is absent. */
  delete(key: string): void;
  /** Read a scalar value for a key, or undefined if absent. */
  get(key: string): Scalar | undefined;
  /** Whether the key exists in the map. */
  has(key: string): boolean;
  /** Full-state export: Y.encodeStateAsUpdate(doc) with no state vector. */
  exportState(): UpdateCarrier;
  /**
   * Validate carrier + document ID, then apply. Never throws for recoverable cases.
   * Accepts `unknown` (correction 5): the public boundary safely checks the carrier
   * shape (non-null object, non-empty string documentId, Uint8Array bytes, nonzero
   * length) before reading any field or decoding any bytes.
   */
  applyUpdate(carrier: unknown): ApplyOutcome;
  /** Plain JSON projection of the map (the observable state). */
  getState(): State;
  /** Release the underlying Y.Doc. Idempotent; the handle is unusable after this. */
  destroy(): void;
}

/** Factory for replicas. */
export interface Kit {
  /**
   * Create a fresh Y.Doc (fresh session clientID) for the given logical document ID.
   * If seedBytes is provided, apply them as a full-state restore before returning.
   */
  createReplica(documentId: string, seedBytes?: Uint8Array): Replica;
}

export const createKit: () => Kit;
```

Key design choices behind this surface:

- The logical `documentId` lives on the `Replica` and in the `UpdateCarrier`, **separately from Yjs internals** (resolved decision 3/7). `Y.Doc` gets a fresh session `clientID` per instance; that clientID is never used as the document identity.
- `exportState()` returns a carrier, so a single call both serializes and tags the bytes with identity. Restore is `kit.createReplica(originalDocumentId, carrier.bytes)`.
- `applyUpdate` returns a discriminated `ApplyOutcome` instead of throwing, so callers distinguish identity-mismatch from invalid-carrier from success (AC-006-2). The only throwing paths are local-API contract violations (`set` with a non-scalar/non-finite value, `createReplica` with a bad documentId).
- `getState()` returns a fresh null-prototype snapshot each call (correction 4); tests compare with Vitest `expect(...).toEqual(...)`, not `===` and not `node:util`.

## Scalar domain

A `Scalar` is `string | number | boolean | null`. The domain guard `assertScalar(value)` lives in `src/scalars.ts` and is called by `Replica.set` BEFORE any mutation (correction 5). It rejects, by throwing a `TypeError`, every non-scalar: `undefined`, arrays (`Array.isArray`), non-null objects, functions, symbols, `bigint`, and non-finite numbers (`typeof === "number" && !Number.isFinite(value)` — `NaN`, `+Infinity`, `-Infinity`). Allowed: `string`, finite `number`, `boolean`, `null`.

```ts
// packages/kit/src/scalars.ts (no Node-only imports)
export function assertScalar(value: unknown): asserts value is Scalar {
  if (value === null) return;
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number" && Number.isFinite(value)) return;
  throw new TypeError(/* describes the rejected value */);
}
```

The TypeScript signature already excludes non-scalars at compile time; the runtime guard closes the gap for `unknown`-typed callers and the finite-number constraint. The guard is called before the Y.Map is touched, so a rejected write leaves observable state unchanged (AC-007-1).

Because the only write path in the proof is `set`, and every `applyUpdate` in the proof consumes bytes that some replica produced via `set`, the map only ever holds scalars. `getState()` therefore projects scalars only; it does not recurse into nested structures (there are none). `applyUpdate` does **not** re-validate value types of incoming bytes — that is acceptable because the proof's bytes always originate from a same-document replica; full capsule validation (including value-type checking of foreign bytes) is future work.

## State projection and deep equality

`getState()` builds a **fresh null-prototype** snapshot by iterating the map's entries and assigning each scalar value as an OWN data property (correction 4). A null-prototype target means reserved-looking keys — `__proto__`, `constructor`, `toString` — become ordinary own keys instead of hitting `Object.prototype` accessors/setters:

```ts
// packages/kit/src/state.ts (pure; NO node:util, NO deepEqualState)
export function project(map: Y.Map<unknown>): State {
  const out = Object.create(null) as Record<string, Scalar>;
  for (const [key, value] of map.entries()) {
    // Own data property on a null-prototype object: __proto__/constructor/toString
    // are plain own keys here, never the Object.prototype accessor/setter.
    Object.defineProperty(out, key, {
      value: value as Scalar,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out as State;
}
```

`Y.Map` iterates in insertion order, but deep equality compares by key set and value, so differing insertion orders still compare equal. Each call returns a **fresh** object, so mutating a returned snapshot cannot reach the replica's state (correction 4). Deep equality in tests is Vitest `expect(a).toEqual(b)` — explicitly **not** `a === b` (reference identity) and **not** byte comparison of `Y.encodeStateAsUpdate` output. There is no runtime deep-equality helper in `src` (correction 1).

## Update carrier and full-state export

`exportState()` calls `Y.encodeStateAsUpdate(doc)` with **no state-vector argument** — a full-state snapshot (resolved decision 4). Applying those bytes to a fresh empty replica of the same document reproduces the exporting replica's observable state (AC-002-4). This is distinct from future differential updates, which would use `Y.encodeStateAsUpdate(doc, remoteStateVector)` to emit only the missing operations; that path is out of scope and is described, not implemented, in the storage/transport section.

`applyUpdate(carrier: unknown)` order of operations (correction 3 + 5 — the public boundary accepts `unknown` and never reads a field before the shape is proven):

1. **Carrier-shape validation** — carrier is a non-null object; `documentId` is a non-empty `string`; `bytes` is a `Uint8Array`; `bytes.length > 0`. Any failure → return `{ ok: false, reason: "invalidCarrier" }`. No bytes are decoded. Zero-length bytes are rejected here because `new Uint8Array(0)` is NOT assumed to be a valid Yjs no-op update (correction 3). (AC-006-4)
2. **Document-ID guard** — `carrier.documentId !== this.documentId` → return `{ ok: false, reason: "documentIdMismatch" }`. No bytes are decoded. (AC-006-1, AC-006-2)
3. **Apply** — `Y.applyUpdate(doc, carrier.bytes)`; return `{ ok: true }`.

A full-state export of an empty `Y.Doc` is non-empty Yjs bytes (not length 0), so it passes step 1 and imports successfully into a fresh empty replica — the empty-doc round-trip in `export.test.ts` confirms this (correction 3).

`Y.applyUpdate` is idempotent for an already-applied update on the same doc state (AC-004-1), order-independent across deliveries (AC-004-2), and `Y.mergeUpdates` produces a batch equivalent to sequential application (AC-004-3) — all native Yjs behavior, no custom code.

## Conflict resolution

Concurrent same-key writes resolve via native Yjs `Y.Map` semantics (last-writer-wins by the CRDT's internal order, which is **not** wall-clock order) (resolved decision 6). The proof asserts agreement **and** that the winner is one of the submitted values; it never asserts which specific value wins (AC-003-1, AC-003-2). No custom timestamp or ordering layer is added.

## Restore lifecycle

1. Caller saves `carrier = r1.exportState()` (bytes + logical documentId).
2. Caller calls `r1.destroy()` → `doc.destroy()`, releasing Yjs internals and breaking observer references. The `r1` handle is now unusable.
3. Caller calls `r2 = kit.createReplica(carrier.documentId, carrier.bytes)`. This creates a **fresh** `Y.Doc` (fresh session clientID), then `Y.applyUpdate(doc, carrier.bytes)` to replay the saved full state. The logical documentId is preserved separately (passed in by the caller), not read from Yjs.
4. `r2.getState()` is deeply equal to `r1`'s pre-destroy state (AC-005-1). New edits on `r2` use the fresh clientID, so subsequent sync with a peer works normally (AC-005-2).

A set-then-delete sequence before export is preserved through restore: the deleted key is absent in `r2.getState()` (AC-005-3), because deletions are encoded in the full-state snapshot.

## Validation and rejection/error behavior

The proof's validation scope is deliberately narrow (correction 8). The table makes every failure path concrete.

| Operation | Failure condition | Recoverable? | Caller receives | Logged at |
| --- | --- | --- | --- | --- |
| `createReplica(documentId)` | `documentId` not a non-empty string | Fatal (caller bug) | throws `TypeError` | error (console) |
| `createReplica(documentId, seedBytes)` | `seedBytes` present but not `Uint8Array` | Fatal (caller bug) | throws `TypeError` | error (console) |
| `set(key, value)` | `value` is not a supported scalar (`undefined`, array, object, function, symbol, `bigint`, `NaN`, `±Infinity`) | Fatal (caller bug) | throws `TypeError` before mutation | error (console) |
| `delete(key)` | key absent | Recoverable | no-op (returns void) | — |
| `exportState()` | none (always succeeds) | n/a | `UpdateCarrier` | — |
| `applyUpdate(carrier)` | carrier not a non-null object, missing/non-string/empty `documentId`, non-`Uint8Array` `bytes`, OR zero-length `bytes` | Recoverable | `{ ok:false, reason:"invalidCarrier" }` (before decode) | warn |
| `applyUpdate(carrier)` | `carrier.documentId !== replica.documentId` | Recoverable | `{ ok:false, reason:"documentIdMismatch" }` | warn |
| `applyUpdate(carrier)` | well-formed carrier, malformed/truncated `bytes` (`Y.applyUpdate` throws) | **Not handled in this proof** | uncaught throw | n/a — hostile-byte handling is future work |
| any op except `destroy()` after `destroy()` | replica already destroyed | Fatal (caller bug) | throws `Error("replica has been destroyed")` | error (console) |
| `destroy()` | called twice | Recoverable | idempotent no-op | — |

Notes on the deliberately-unhandled row: the proof's tests only ever feed bytes produced by `exportState()` of a same-document replica, so `Y.applyUpdate` never throws in-scope. Catching malformed bytes and returning a rejection is **hostile-byte handling**, explicitly listed as future work and not claimed as implemented (correction 8). The documented invariant (AC-006-3) — "raw Yjs update bytes do not prove document identity and do not authenticate the sender" — is placed as a comment on `applyUpdate` and in the module docblock, but is **verified by a real behavioral test** (correction 2): a carrier bearing a wrong `documentId` is rejected (`{ ok:false, reason:"documentIdMismatch" }`) and leaves state unchanged, demonstrating the guard is identity, not authentication. No test greps source for a sentence.

**Post-destroy enforcement.** Every operation except `destroy()` begins with an internal `assertAlive()` guard that throws `Error("replica has been destroyed")` once the replica has been destroyed (AC-007-3). `destroy()` sets a destroyed flag and calls `doc.destroy()`; calling it again is a no-op (AC-007-4).

## Shared seeding, independent replica state, and cleanup

- **Shared seeding.** Two replicas of the "same logical document" share the same logical `documentId`. The default seed is empty: `kit.createReplica("doc-1")` twice yields two replicas whose `getState()` is `{}` — deeply equal, the shared starting point. A non-empty shared seed is established by exporting one replica's full state and creating the second from those bytes (`kit.createReplica("doc-1", seedBytes)`). Both count as the same logical document because they share the caller-supplied `documentId`; the Yjs `clientID` differs per instance and is never used for identity.
- **Independent replica state.** Each `Replica` owns its own `Y.Doc` (Yjs generates a fresh session `clientID` per `new Y.Doc()`). `set`/`delete` mutate only that replica's doc; no shared doc or shared map reference exists between replicas. Before any exchange, `state(A)` and `state(B)` are deeply unequal (each reflects only its own edits) — AC-001-3.
- **Cleanup.** `destroy()` calls `doc.destroy()` to free Yjs internals and detach observers. This is required for the restore test (destroy `R1` before restoring `R2`) and prevents cross-test leaks. After `destroy()`, the handle is treated as unusable; the proof's tests never call methods on a destroyed replica. `destroy()` is idempotent (double-destroy is a no-op) so test teardown is safe.

## Edge cases

- **Zero-length bytes (correction 3).** A zero-length `Uint8Array` is rejected as `{ ok: false, reason: "invalidCarrier" }` BEFORE decoding; `new Uint8Array(0)` is not assumed to be a valid Yjs no-op update. This is distinct from the **empty-doc export**: `Y.encodeStateAsUpdate` of an empty `Y.Doc` produces NON-empty bytes, which pass carrier validation and import to `{}` successfully.
- **Delete of absent key.** `delete(k)` is a no-op when `k` is absent; no throw.
- **Set-then-delete before export.** The deletion is part of the full-state snapshot; after sync (AC-002-5) and after restore (AC-005-3) the key is absent on the receiver.
- **Same key set twice on one replica (sequential, no concurrency).** No conflict; the later local value wins on that replica and on any peer after exchange — this is ordinary sequential editing, not the concurrent case.
- **Re-apply of an already-applied update.** `Y.applyUpdate` is idempotent; state is deeply equal before and after (AC-004-1).
- **Merge of overlapping updates.** `Y.mergeUpdates([U1, U2, U3])` merges client clocks; applying the merged batch equals applying sequentially on a fresh receiver (AC-004-3).
- **Different insertion orders across replicas.** Projections compare by key set and value, so insertion-order differences do not break deep equality.

## Invariants and the layer that owns each

- **Scalar-only map values** — owned by `Replica.set` (runtime finite-number guard). The only in-proof write path is `set`, so the map never holds non-scalars. `applyUpdate` does not re-check value types of foreign bytes (full capsule validation is future work).
- **Document identity** — owned by `applyUpdate` (carrier validation + document-ID guard before any decode). The `documentId` is stored on the `Replica`, separate from Yjs.
- **Independent mutable state** — owned by `createReplica` (one `Y.Doc` per replica) and the `Replica` handle (no shared references).
- **Idempotent application / order independence / grouping invariance** — owned by Yjs (`Y.applyUpdate`, `Y.mergeUpdates`); the Kit relies on these and asserts them in tests.
- **Deep-equal convergence** — owned by Yjs CRDT merge plus the deterministic plain projection; equality is asserted in tests with Vitest `toEqual`, not byte comparison and not a runtime helper in `src`.
- **Integrity-vs-authentication distinction** — owned by documentation on `applyUpdate` (AC-006-3).

## Acceptance-criterion → concrete test mapping

Every acceptance criterion maps to a concrete, named test. Unit tests are deterministic, synchronous, in-memory. Property tests are fast-check with a fixed seed (see test infrastructure). File paths are under `packages/kit/tests/`.

### Unit tests

| AC | Test (file :: name) | Asserts |
| --- | --- | --- |
| AC-001-1 | `replica.test.ts :: offline edit isolated on A, invisible on B` | after A.set, `state(A)` has the edit, `state(B)` does not, no throw, no network wired |
| AC-001-2 | `replica.test.ts :: disjoint offline edits both apply without network` | A and B each set disjoint keys offline; both apply, no error, no network |
| AC-001-3 | `replica.test.ts :: pre-exchange states diverge` | `expect(state(A)).not.toEqual(state(B))` before exchange |
| AC-002-1 | `sync.test.ts :: two-way exchange converges` | after A↔B exchange, `expect(state(A)).toEqual(state(B))` |
| AC-002-2 | `sync.test.ts :: nonconflicting edits preserved; same-key one survives` | disjoint edits present in both; concurrent same-key resolved value equals one submitted value and `expect(state(A)).toEqual(state(B))` |
| AC-002-3 | `sync.test.ts :: exported bytes apply via public apply path` | `B.applyUpdate(A.exportState())` returns `{ok:true}` and bytes are self-contained |
| AC-002-4 | `export.test.ts :: full-state export reproduces state on empty replica` | `Y.encodeStateAsUpdate` (no state vector); apply to fresh empty replica → `toEqual` with exporter |
| AC-002-5 | `sync.test.ts :: set-then-delete survives sync` | A sets then deletes F, exchanges with B; F absent in `state(A)` and `state(B)` |
| AC-003-1 | `conflict.test.ts :: same-key agrees and winner is a submitted value` | `state(A).F === state(B).F`, value ∈ `{"alpha","beta"}`, `expect(state(A)).toEqual(state(B))` |
| AC-003-2 | `conflict.test.ts :: no wall-clock guarantee documented` | test asserts agreement + membership only; comment records observed winner is not asserted to be wall-clock-later |
| AC-004-1 | `invariants.test.ts :: idempotency — re-apply is a no-op` | `expect(state(R)).toEqual(s0)` after re-applying U |
| AC-004-2 | `invariants.test.ts :: commutativity — shuffled delivery converges` | `expect(state(R-forward)).toEqual(state(R-shuffled))` |
| AC-004-3 | `invariants.test.ts :: grouping invariance — mergeUpdates equals sequential` | `expect(state(R-seq)).toEqual(state(R-merged))` via `Y.mergeUpdates([U1,U2,U3])` |
| AC-005-1 | `restore.test.ts :: restore equivalence after destroy` | export R1, destroy R1, create R2 from bytes; `expect(state(R2)).toEqual(R1-before-destroy)` |
| AC-005-2 | `restore.test.ts :: restore then sync both sides` | R2 sets E3, R3 sets disjoint E4, exchange; `expect(state(R2)).toEqual(state(R3))` with E3 and E4 present |
| AC-005-3 | `restore.test.ts :: set-then-delete survives restore` | R1 sets then deletes F, export, destroy, restore R2; F absent in `state(R2)` |
| AC-006-1 | `validation.test.ts :: documentId mismatch rejected, state unchanged` | apply returns `{ok:false,reason:"documentIdMismatch"}`; `expect(before).toEqual(after)` |
| AC-006-2 | `validation.test.ts :: distinguishable rejection result` | outcomes for ok / mismatch / invalidCarrier are distinguishable by `ok` and `reason` |
| AC-006-3 | `validation.test.ts :: wrong-documentId rejected, state unchanged (identity, not auth)` | BEHAVIORAL (correction 2): wrong-id carrier → `{ok:false,reason:"documentIdMismatch"}` and state unchanged; no source-comment grep |
| AC-006-4 | `validation.test.ts :: basic carrier validation rejects before decode` | missing/non-string/empty `documentId`, non-`Uint8Array` bytes, AND zero-length bytes → `{ok:false,reason:"invalidCarrier"}`; state unchanged |
| AC-007-1 | `validation.test.ts :: set rejects non-scalar values` | `undefined`/array/object/function/symbol/`NaN`/`±Infinity` throw `TypeError`; state unchanged |
| AC-007-2 | `validation.test.ts :: createReplica rejects empty/non-string documentId` | non-empty-string documentId enforced |
| AC-007-3 | `lifecycle.test.ts :: post-destroy operations throw` | every op after `destroy()` throws `Error` |
| AC-007-4 | `lifecycle.test.ts :: repeated destroy is a no-op` | second `destroy()` does not throw |
| Correction 3 (empty-doc export) | `export.test.ts :: empty-doc export is non-empty and imports to {}` | export of empty `Y.Doc` is non-empty bytes; imports to `{}`; zero-length bytes rejected |
| Correction 4 (safe projection) | `projection.test.ts :: __proto__/constructor/toString are own props; snapshot isolated` | the three keys are own enumerable data properties; mutating a snapshot does not mutate the replica |
| Correction 6 (deletion regression) | `deletion-regression.test.ts :: stale older update does not resurrect a deletion` | after set→sync→delete→sync F absent on B; restore deleted state into C, replay older update, F still absent |

### Property tests (fast-check)

| AC / invariant | Test (file :: name) | Arbitrary | Asserts |
| --- | --- | --- | --- |
| AC-002-1 / REQ-002 convergence | `sync.property.test.ts :: two-way exchange converges for disjoint edits` | nonempty list of DISTINCT keys × scalars (`fc.uniqueArray(..., { minLength: 1 })`) | `expect(state(A)).toEqual(state(B))` and all edits preserved |
| AC-002-2 same-key one survives | `conflict.property.test.ts :: concurrent same-key resolves to a submitted value` | two distinct scalars | resolved value on both is deeply equal and ∈ submitted set |
| AC-004-1 idempotency | `invariants.property.test.ts :: re-apply is a no-op` | arbitrary single update | `toEqual` unchanged |
| AC-004-2 commutativity | `invariants.property.test.ts :: order independence` | nonempty update list + a permutation | `toEqual` of the two receivers |
| AC-004-3 grouping | `invariants.property.test.ts :: mergeUpdates equals sequential` | nonempty update list | `expect(state(R-seq)).toEqual(state(R-merged))` |

Every property test's arbitrary uses `minLength: 1` (or an equivalent nonempty generator) and additionally asserts inside the test body that the generated case is nonempty, so a vacuous pass (empty input → trivially equal) is impossible. For disjoint-edit convergence, keys are DISTINCT via `fc.uniqueArray(..., { selector: e => e.key, minLength: 1 })` (correction 2). Where two values must differ (same-key conflict), the arbitrary guarantees distinctness via a bounded `.filter(([a,b]) => a !== b)`.

**Runner configuration and reporting (correction 2).** Each property test calls `fc.check(fc.property(arb, predicate), { verbose: true })` (NOT `fc.assert`). The global defaults `numRuns: 200` and `seed: 424242` are set once via `fc.configureGlobal({ numRuns: 200, seed: 424242 })` in `vitest.setup.ts` (these are fast-check's supported option names; `baseSeed` is NOT valid). After `fc.check` returns, the test explicitly FAILS the Vitest test when `result.failed` is true, embedding `result.seed`, `result.numRuns`, `result.numSkips`, `result.numShrinks`, `JSON.stringify(result.counterexample)`, and `result.counterexamplePath` in the failure message so a red run is replayable; on success it asserts `result.failed === false` and `result.numRuns === 200`.

## Test infrastructure: strict TypeScript, Vitest, fast-check

- **Vitest config** (`packages/kit/vitest.config.ts`): `environment: "node"`, `include: ["tests/**/*.test.ts"]`, no DOM. Tests are synchronous (Yjs is in-memory/sync), so no async/timeout flakiness.
- **fast-check determinism**: `fc.configureGlobal({ numRuns: 200, seed: 424242 })` set in `vitest.setup.ts` referenced by `setupFiles` (correction 2 — `seed` and `numRuns` are the supported option names; `baseSeed` and `verbose: 2` from the draft are NOT used). The fixed `seed` makes the generated sequence reproducible; each property test reports `result.seed`/`numRuns`/`numSkips`/`numShrinks`/`counterexample`/`counterexamplePath` from the `fc.check` result object so both green and red runs are reproducible for diagnosis.
- **Nonempty cases**: every convergence/invariant property uses `fc.array(arb, { minLength: 1 })` (or `fc.uniqueArray`) and an in-test `assert cases.length > 0` guard. This directly prevents the "both-empty → trivially deep-equal" vacuous pass the testing steering warns about.
- **Actual outputs required**: Vitest's reporter prints `N passed, M failed` and the fast-check case counts. The proof's final verification step captures these counts; a "should work" narrative is not a result (testing steering).
- **Strict TS**: `tsconfig.json` with `"strict": true`, `"noImplicitAny": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `module`/`moduleResolution` `NodeNext`, `lib: ["ES2022"]` (NO `DOM` — correction 1), `types: ["node"]`. A separate `tsconfig.build.json` extends it, includes only `src/**`, excludes tests/config, and emits `.js` + `.d.ts` to `dist/`, so published runtime output is src-only. No `any` in the public or internal code.

## Future storage and transport integration (described, not implemented)

This proof leaves storage and transport as pluggable seams the merge path never imports (architecture steering). Nothing below is implemented here; it is recorded so the implementation phase does not entangle these concerns.

- **Storage adapter (pluggable).** A future interface persists `UpdateCarrier.bytes` keyed by `documentId`:
  ```ts
  interface SyncStorage {
    loadBytes(documentId: string): Promise<Uint8Array | undefined>;
    saveBytes(documentId: string, bytes: Uint8Array): Promise<void>;
  }
  ```
  IndexedDB is one future adapter. The proof's restore test is the in-memory surrogate for "persistence after reload": a real reload calls `loadBytes(docId)` then `kit.createReplica(docId, bytes)`. The merge logic (`applyUpdate`) does not import storage.
- **Transport adapter (pluggable).** A future interface moves carriers between replicas:
  ```ts
  interface SyncTransport {
    send(carrier: UpdateCarrier): void;
    onReceive(handler: (carrier: UpdateCarrier) => void): void;
  }
  ```
  File transfer and QR (small/animated) are future transports (product steering). The proof uses direct in-memory handoff — `B.applyUpdate(A.exportState())` — as the transport surrogate; no network is involved, satisfying the offline requirement.
- **Capsule envelope (future, before file/QR ingestion).** The `UpdateCarrier` is the minimal pre-capsule. Before any external file/QR path is enabled, a versioned envelope adds: a capsule version, a checksum (corruption detection — explicitly **not** sender authentication, per security steering and AC-006-3), a payload size bound (reject oversized before decoding), and hostile-byte handling (graceful rejection of malformed Yjs bytes). These are listed as required work in REQ-006 and are **not** implemented or claimed in this proof (correction 8).

## Files to create in the implementation phase

All under `packages/kit/` (planning only; not created in this step):

- `package.json` — ESM (`"type": "module"`), `main`/`module`/`types`/`exports`/`files: ["dist"]`; `yjs` (dep) and `devDependencies` `typescript`, `vitest`, `fast-check`, `@types/node`, all exact pins; scripts `typecheck` (`tsc --noEmit -p tsconfig.json`), `test` (`vitest run`), `build` (`tsc -p tsconfig.build.json`).
- `tsconfig.json` — strict config as above; `outDir: "dist"`, `declaration: true`; includes `src` + `tests` + config for typechecking.
- `tsconfig.build.json` — extends `tsconfig.json`; `include: ["src/**/*.ts"]`, excludes tests/config; emits src-only to `dist/`.
- `vitest.config.ts` — node environment, test include, `setupFiles: ["./vitest.setup.ts"]`.
- `vitest.setup.ts` — `fc.configureGlobal({ numRuns: 200, seed: 424242 })` (correction 2).
- `src/types.ts` — public types (`Scalar`, `State`, `UpdateCarrier`, `ApplyOutcome`, `Replica` with `applyUpdate(unknown)`, `Kit`).
- `src/state.ts` — pure `project(map): State` only (null-prototype snapshot; correction 4). NO `node:util`, NO `deepEqualState` (correction 1).
- `src/scalars.ts` — `assertScalar(value)` runtime guard rejecting all non-scalars (correction 5); no Node-only imports.
- `src/replica.ts` — `Replica` implementation, `createReplica`, and `createKit`; the documented integrity-vs-authentication comment lives here on `applyUpdate`; `assertAlive()` post-destroy guard.
- `src/index.ts` — public re-exports (`createKit` + public types).
- `tests/replica.test.ts`, `tests/sync.test.ts`, `tests/export.test.ts`, `tests/conflict.test.ts`, `tests/invariants.test.ts`, `tests/restore.test.ts`, `tests/validation.test.ts`, `tests/projection.test.ts` (correction 4), `tests/lifecycle.test.ts` (correction 5), `tests/deletion-regression.test.ts` (correction 6) — unit tests per the mapping above.
- `tests/sync.property.test.ts`, `tests/conflict.property.test.ts`, `tests/invariants.property.test.ts` — fast-check tests per the mapping above.

No app packages (`apps/*`), root manifests, or steering files change in this proof.
