# core-sync-proof — Requirements

> GhostSync Kit (`@ghostsync/kit`) — Requirements-First Feature Spec.
> Branch: `feat/kiro-steering`. This document covers requirements only. Design and tasks are authored in later phases after this requirements review gate is passed.

## Summary

Prove that two independent Yjs replicas of the same logical document can make edits offline and converge after exchanging binary updates. This is the first correctness proof for the Kit's sync foundation. It is deliberately scoped to in-memory replicas and raw binary Yjs updates — no browser storage, no app UI, no capsule format, no QR transport, no deployment. The proof establishes that the CRDT layer (Yjs) and the Kit's thin update-application boundary behave correctly before any storage or transport tier is built on top.

The requirements align with workspace steering:
- **Architecture** — Yjs is the CRDT layer; each device holds an independent replica; merge is a pure function of updates; storage and transport stay separate from merge logic.
- **Testing** — actual test outputs are required (pass/fail counts), not "should work" claims; convergence, duplicate-import safety, update ordering, persistence-after-reload, invalid-input rejection, and offline behavior are all required coverage; property-based tests cover merge invariants (commutativity, associativity, idempotency).
- **Security** — every update is untrusted; size is bounded before decoding; format/version/document-identity/checksum are validated before applying in the full capsule path; a checksum detects corruption, it does not authenticate the sender. For this in-memory proof the carrier is a raw binary Yjs update plus a caller-supplied logical document ID; the full capsule format (version, checksum, size bounds) is out of scope and is explicitly listed as work required before external file/QR ingestion.

## Definitions

These definitions apply to every requirement and acceptance criterion below.

- **Replica.** A Node.js in-memory handle that wraps an independent `Y.Doc` instance and a caller-supplied logical document ID. Each replica owns its own `Y.Doc`; two replicas never share mutable state.
- **Document model.** One top-level `Y.Map` with string keys and scalar values. A **scalar** is a `string`, a finite `number` (not `NaN`, not `±Infinity`), a `boolean`, or `null`.
- **Observable state** (a replica's `state`). A **fresh** plain snapshot of the top-level `Y.Map` returned by `getState()`: an object whose own enumerable keys are the map's string keys and whose values are the contained scalars. The snapshot preserves every supported string key — including reserved-looking names `__proto__`, `constructor`, and `toString` — as its own data property, and mutating a returned snapshot must not mutate the replica (each call returns a fresh object). Comparison of observable state is **deep equality** — a recursive value-by-value comparison of these plain projections (same set of keys, deeply equal scalar values), asserted in tests with Vitest's `expect(...).toEqual(...)`. State equality is **not** object-identity (`===` on the same reference) and is **not** byte-for-byte equality of encoded Yjs bytes (`Y.encodeStateAsUpdate` output), because encoded bytes are sensitive to insertion/client order and are not a stable equality basis. Deep equality is a **test concern only**; no runtime deep-equality helper lives in the Kit's `src`.
- **Update carrier.** A `{ documentId: string; bytes: Uint8Array }` pair carried alongside a raw Yjs update. The `bytes` are the output of a full-state export `Y.encodeStateAsUpdate(doc)` performed with no state vector. (Differential, state-vector-based updates are a future concern and are out of scope for this proof.)
- **Convergence.** Two replicas have converged when their observable states are deeply equal after all required updates have arrived on both.
- **Deeply equal / deeply unequal.** Used throughout below as defined above.

## Functional Requirements

### REQ-001 — Independent offline replicas with no shared mutable state

Two replicas of the same logical document start from the same initial state but hold independent mutable state. Each replica can apply local edits with no server and no network connection. Before any update exchange, an edit made on one replica is not visible on the other.

**Acceptance criteria**

- AC-001-1: WHEN two replicas are created from the same logical document and replica A applies a local edit while no network connection exists between the replicas, THE SYSTEM SHALL accept replica A's edit on replica A and SHALL NOT reflect that edit in replica B's observable state until an update is explicitly exchanged.
- AC-001-2: WHEN replica A and replica B each apply disjoint local edits while offline, THE SYSTEM SHALL allow both edits to be applied locally without raising an error and without either replica requiring a server or network connection.
- AC-001-3: WHEN the two replicas are inspected before any exchange, THE SYSTEM SHALL report that their observable states have diverged (the states are deeply unequal: each reflects only its own edits), demonstrating that they do not share mutable state.

**Expected verification.** A unit test creates two in-memory replicas from a shared logical document, takes the network offline (no transport wired), applies one distinct edit per replica, and asserts: (a) each replica's observable state contains its own edit, (b) neither replica's observable state contains the other's edit, (c) no exception is raised while offline, (d) the two pre-exchange states are deeply unequal. The test run prints actual pass/fail counts (e.g. `N passed, 0 failed`); a "should work" narrative is not accepted as a result. Property-based variant: for arbitrary nonempty sets of disjoint offline edits, each replica's pre-exchange state is deeply equal to its own applied edits only and deeply unequal to the other replica's.

### REQ-002 — Two-way binary update exchange converges both replicas

Each replica can export its updates as binary bytes and apply binary updates received from another replica. After a full two-way exchange of all exported updates, both replicas reach deeply equal observable state. Nonconflicting edits made before the exchange are preserved; concurrent writes to the same key resolve to exactly one of the submitted values (one survives, the others are superseded), and no nonconflicting edit is silently dropped.

**Acceptance criteria**

- AC-002-1: WHEN replica A and replica B each apply disjoint local edits offline and then export their updates as binary bytes and apply each other's exported updates in both directions, THE SYSTEM SHALL produce deeply equal observable state on replica A and replica B.
- AC-002-2: WHEN the two-way exchange in AC-002-1 completes, THE SYSTEM SHALL preserve every nonconflicting edit made on either replica before the exchange (no nonconflicting edit is silently dropped); concurrent same-key writes SHALL resolve to exactly one of the submitted values on both replicas.
- AC-002-3: WHEN a replica exports its updates as binary bytes, THE SYSTEM SHALL produce a byte payload that can be applied to another replica of the same document via the Kit's public apply path (the bytes are self-contained for a single document).
- AC-002-4: WHEN a replica exports its state for this proof, THE SYSTEM SHALL produce a full-state export via `Y.encodeStateAsUpdate(doc)` performed with no state vector, such that applying those bytes to a fresh empty replica of the same document reproduces the exporting replica's observable state. This full-state export is distinct from future differential (state-vector-based) updates, which are out of scope for this proof.
- AC-002-5: WHEN replica A sets field F to a scalar and then deletes F before exporting, and the exported update is exchanged with replica B, THE SYSTEM SHALL converge both replicas to observable state in which F is absent (the deletion survives sync).
- AC-002-6 (deletion regression, correction 6): WHEN replica A sets field F = "x" and syncs it to replica B, then replica A deletes F and sends another full-state update, THE SYSTEM SHALL remove F on replica B; AND WHEN the deleted full state is restored into a fresh replica C and the OLDER pre-deletion update is subsequently replayed into C, THE SYSTEM SHALL leave F absent on C (a stale earlier update SHALL NOT resurrect the deleted key).

**Expected verification.** A unit test performs the sequence: seed both replicas, offline-edit A, offline-edit B, export A→bytes, export B→bytes, apply A's bytes to B, apply B's bytes to A, then assert `deepEqual(state(A), state(B))` and that both disjoint edits are present in both. A second test sets F then deletes F on A, exchanges with B, and asserts F is absent in both `state(A)` and `state(B)`. The harness reports actual pass/fail counts. A property-based test asserts that for arbitrary nonempty sets of disjoint edits, two-way exchange always converges (`deepEqual(state(A), state(B))`) and all nonconflicting edits are preserved. A property test for AC-002-2 asserts that for two concurrent same-key writes to distinct scalar values, the resolved value on both replicas is deeply equal and is one of the two submitted values.

### REQ-003 — Concurrent same-field edits resolve to one value on both replicas

When two replicas concurrently edit the same field, the updates conflict at the field level. After all updates from both replicas are delivered to both, the field resolves to a single identical value on both replicas, and that value is one of the values the replicas submitted. The proof does not promise wall-clock ordering: the resolved value is whatever the CRDT merge semantics produce, not necessarily the wall-clock-later edit.

**Acceptance criteria**

- AC-003-1: WHEN replica A sets field F to value X and replica B sets field F to value Y concurrently (X ≠ Y), and all updates from both replicas are delivered to both, THE SYSTEM SHALL resolve field F to exactly one value on replica A and the same value on replica B (the two replicas agree), and that resolved value SHALL be one of the submitted values (X or Y).
- AC-003-2: WHEN the concurrent-edits scenario in AC-003-1 completes, THE SYSTEM SHALL NOT guarantee that the resolved value equals the wall-clock-later edit (the resolved value is determined by native Yjs CRDT merge semantics, not by arrival or edit timestamp; no custom timestamp ordering is imposed).

**Expected verification.** A unit test sets F="alpha" on replica A and F="beta" on replica B concurrently (no exchange between the two sets), then exchanges all updates both ways and asserts `deepEqual(state(A), state(B))`, that `state(A).F === state(B).F`, and that the agreed value is one of `{"alpha","beta"}`. The test does not assert which specific value wins; it asserts agreement plus membership in the submitted set. The run prints actual pass/fail counts and records which value the CRDT produced as observed behavior (not as a guaranteed rule). A property-based variant generates two distinct scalars for the concurrent same-key write and asserts the resolved value on both replicas is deeply equal and is one of the two submitted scalars.

### REQ-004 — Application is idempotent and order-independent

Reapplying an already-delivered update is a no-op on observable state. Delivering the same set of updates in different orders still converges once all required updates have arrived. Applying updates grouped via `Y.mergeUpdates` converges to the same observable state as applying the same updates sequentially to an equivalent fresh receiver. These are the merge invariants the testing steering requires: idempotency, commutativity, and associativity.

**Acceptance criteria**

- AC-004-1 (idempotency): WHEN an update that has already been applied to a replica is reapplied to the same replica, THE SYSTEM SHALL leave that replica's observable state deeply equal to its state before re-application (re-application is a no-op).
- AC-004-2 (commutativity): WHEN the same set of updates is delivered to two replicas in different orders, THE SYSTEM SHALL converge both replicas to deeply equal observable state once all required updates have arrived.
- AC-004-3 (associativity / grouping invariance): WHEN a sequence of updates [U1, U2, …, Un] is applied sequentially to a fresh receiver R-seq, and the same updates are combined with `Y.mergeUpdates([U1, …, Un])` and applied as a single merged update to an equivalent fresh receiver R-merged, THE SYSTEM SHALL converge R-seq and R-merged to deeply equal observable state once all updates have arrived on each.

**Expected verification.** A unit test applies update U to replica R, records `s0 = state(R)`, applies U again, and asserts `deepEqual(state(R), s0)` (unchanged). A second test builds updates [U1, U2, U3] and delivers them to R1 in order [U1, U2, U3] and to R2 in a shuffled order, then asserts `deepEqual(state(R1), state(R2))` once all arrive. A third test applies [U1, U2, U3] sequentially to a fresh R-seq and applies `Y.mergeUpdates([U1, U2, U3])` to an equivalent fresh R-merged, then asserts `deepEqual(state(R-seq), state(R-merged))`. The harness prints actual pass/fail counts. Property-based tests (per the testing steering) generate arbitrary nonempty update sequences and assert the three invariants hold for all generated cases — these are merge-invariant property tests, run with a deterministic seed and a stated run/shrink count, and each generated case is asserted nonempty so a vacuous pass is impossible.

### REQ-005 — Exported state bytes restore a fresh replica that can sync again

A replica can export its full state as bytes. Those bytes can be saved and the original instance destroyed; the saved bytes then initialize a fresh replica that holds a fresh session client ID while preserving the logical document ID. The restored replica retains the saved state and can subsequently sync with another replica via normal update exchange.

**Acceptance criteria**

- AC-005-1: WHEN a replica's exported state bytes are saved, the original instance is destroyed, and a fresh replica is initialized from those bytes with a fresh session client ID while preserving the logical document ID, THE SYSTEM SHALL restore the fresh replica to observable state deeply equal to the saved replica's pre-destroy observable state.
- AC-005-2: WHEN the restored fresh replica applies a new local edit AND a peer replica applies a disjoint new local edit, then the two exchange updates in both directions, THE SYSTEM SHALL converge the restored replica and the peer to deeply equal observable state with both new nonconflicting edits preserved.
- AC-005-3: WHEN a field has been set and then deleted before the state is exported, and the exported state is restored into a fresh replica, THE SYSTEM SHALL restore the fresh replica to observable state in which that field is absent (the deletion survives restore).

**Expected verification.** A unit test: build replica R1, apply edits E1 and E2, export R1 state to bytes `S`, destroy R1, create fresh replica R2 from `S` (fresh client ID, same logical document ID), assert `deepEqual(state(R2), state(R1-before-destroy))`. Then apply a new edit E3 on R2 and a disjoint new edit E4 on a peer R3, exchange R2↔R3 both directions, assert `deepEqual(state(R2), state(R3))` with both E3 and E4 present. A second test sets F then deletes F on R1, exports, destroys R1, restores R2, and asserts F is absent in `state(R2)`. This covers the testing steering's "persistence after reload" concern at the in-memory level (export-state-then-restore as a reload surrogate; actual IndexedDB persistence is out of scope). The run prints actual pass/fail counts.

### REQ-006 — Document-ID mismatch and basic carrier validation reject before applying

An update carries a caller-supplied logical document ID alongside its raw Yjs bytes. Before any update operation is applied, the Kit performs basic carrier validation (the document ID is present and is a string, and the bytes are a `Uint8Array`) and checks that the update's document ID matches the target replica's document ID. A mismatch or an invalid carrier is rejected before any raw bytes are decoded, and the target replica's observable state is left unchanged. Raw Yjs update bytes do not prove document identity and do not authenticate the sender; the document ID is a separate, minimal in-proof identity guard, and a checksum (when present) detects corruption but does not authenticate the sender.

This proof's validation scope is deliberately limited. The following protections are **not** implemented in this proof and are explicitly required work before any external file/QR ingestion path is enabled: hostile-byte handling (graceful rejection of malformed/truncated Yjs bytes), payload size limits (bounding bytes before decoding), capsule versioning (a versioned envelope), and checksums (corruption detection). This proof implements only basic carrier validation and document-ID rejection, and it does not claim the above protections are already implemented.

**Acceptance criteria**

- AC-006-1: WHEN an update carrying document ID D-in is presented for application to a replica whose document ID is D-target and D-in ≠ D-target, THE SYSTEM SHALL reject the update before applying any of its operations and SHALL leave the target replica's observable state deeply equal to its state before the attempt (unchanged).
- AC-006-2: WHEN an update is rejected under AC-006-1, THE SYSTEM SHALL surface a distinguishable rejection result (not a silent no-op and not a thrown crash that corrupts state) so a caller can tell identity-mismatch apart from a successful apply and from an invalid-carrier rejection.
- AC-006-3 (documented invariant, verified behaviorally): The proof SHALL document that raw Yjs update bytes do not prove document identity and do not authenticate the sender; the document-ID check is an integrity/identity guard, not authentication. This invariant is verified by a **real behavioral test** — a carrier bearing a wrong document ID is rejected and leaves state unchanged (the guard is identity, not authentication) — NOT by searching source comments for a sentence. (Correction 2.)
- AC-006-4: WHEN an update carrier is presented with a missing or wrong-type document ID (not a non-empty `string`), with non-`Uint8Array` bytes, OR with zero-length bytes (`bytes.length === 0`), THE SYSTEM SHALL reject the update as an invalid carrier before decoding any raw Yjs bytes and SHALL leave the target replica's observable state unchanged. Zero-length bytes are rejected up front because `new Uint8Array(0)` is NOT assumed to be a valid Yjs no-op update (correction 3). A full-state export of an EMPTY `Y.Doc` is non-empty Yjs bytes and therefore still imports successfully. The public `applyUpdate` boundary accepts `unknown` and safely checks the carrier shape (non-null object, non-empty string `documentId`, `Uint8Array` `bytes`, nonzero length) before reading any field. (Basic carrier validation only; broader hostile-byte handling, payload limits, capsule versioning, and checksums are future work, not implemented here.)

**Expected verification.** A unit test creates replica R with document ID D-target, builds an update whose carried document ID is D-other (≠ D-target) but whose raw bytes are otherwise valid, attempts to apply it to R, and asserts: (a) the apply returns a document-ID-mismatch rejection result (not success), (b) `deepEqual(state(R)_before, state(R)_after)` (unchanged). A companion test confirms a matching document-ID update applies normally, ruling out a blanket-reject bug. A third test presents carriers with a missing document ID, a non-string document ID, non-`Uint8Array` bytes, AND zero-length bytes, and asserts each is rejected as an invalid carrier before decoding with state unchanged. The run prints actual pass/fail counts. Security steering alignment: size bounding and format/version/checksum validation are required before applying in the full capsule path, but that path is out of scope for this proof; only basic carrier validation and the document-ID check are exercised here, with the integrity-vs-authentication distinction documented.

### REQ-007 — Runtime scalar validation and a defined destroy lifecycle

The Kit validates scalar types at runtime and defines an enforced lifecycle after a replica is destroyed. (Correction 5.)

**Acceptance criteria**

- AC-007-1 (scalar validation): WHEN `set(key, value)` is called with a value that is not a supported scalar — `undefined`, an array, a non-null object, a function, a symbol, a `bigint`, `NaN`, `+Infinity`, or `-Infinity` — THE SYSTEM SHALL reject the write by throwing a `TypeError` BEFORE mutating the map, leaving observable state unchanged. Allowed values are `string`, finite `number`, `boolean`, and `null`.
- AC-007-2 (documentId validation): WHEN `createReplica` is called with a `documentId` that is not a non-empty string, THE SYSTEM SHALL throw a `TypeError`; the same non-empty-string check governs the `documentId` inside an `UpdateCarrier` during carrier validation.
- AC-007-3 (post-destroy behavior): WHEN any operation other than `destroy()` (`set`/`delete`/`get`/`has`/`exportState`/`applyUpdate`/`getState`) is called on a replica after `destroy()`, THE SYSTEM SHALL throw a clear `Error` ("replica has been destroyed"). This behavior is defined, documented, and enforced.
- AC-007-4 (idempotent destroy): WHEN `destroy()` is called more than once, THE SYSTEM SHALL treat the repeated calls as a safe no-op (no throw).

**Expected verification.** A unit test asserts each disallowed `set` value throws `TypeError` and leaves state unchanged, and that each allowed scalar is accepted. A lifecycle test calls `destroy()` then asserts every other operation throws `Error`, and that a second `destroy()` does not throw. The run prints actual pass/fail counts.

## Illustrative scenarios

These scenarios live inside the requirements above as concrete instantiations of the acceptance criteria. They are written so a test can follow them step by step and assert a pass/fail outcome.

### Scenario S-003 — Concurrent edits converge ( REQ-003 )

1. Seed replica A and replica B from the same logical document with field F unset.
2. Offline, replica A sets F = "alpha". Offline, replica B sets F = "beta" (no exchange between the two sets).
3. Replica A exports its update; replica B exports its update.
4. Apply A's update to B; apply B's update to A (both directions).
5. Assert `deepEqual(state(A), state(B))` and that `state(A).F === state(B).F`; assert the agreed value is one of the submitted values `{"alpha", "beta"}`. The test does not assert that the agreed value is specifically "alpha" or "beta"; it asserts agreement plus membership in the submitted set (no wall-clock ordering promised). The actual resolved value is recorded as observed output.

### Scenario S-004a — Duplicate delivery is a no-op ( REQ-004 )

1. Seed replica R, apply update U once, record `s0 = state(R)`.
2. Apply the exact same update U to R a second time.
3. Assert `deepEqual(state(R), s0)` (unchanged). Re-delivery of an already-applied update leaves state untouched.

### Scenario S-004b — Shuffled delivery still converges ( REQ-004 )

1. Build updates U1, U2, U3 (e.g. three independent field sets, or three sequential edits to one field).
2. Deliver [U1, U2, U3] to replica R-forward in that order; deliver a shuffled order (e.g. [U3, U1, U2]) to replica R-shuffled.
3. Assert `deepEqual(state(R-forward), state(R-shuffled))` once all three updates have arrived on each. Different arrival orders converge to the same state.

### Scenario S-004c — Grouping invariance ( REQ-004 )

1. Build updates U1, U2, U3 on separate source replicas (or sequentially on one), capturing each as exported bytes.
2. Apply [U1, U2, U3] sequentially to a fresh receiver R-seq.
3. Compute `M = Y.mergeUpdates([U1, U2, U3])` and apply `M` as a single update to an equivalent fresh receiver R-merged.
4. Assert `deepEqual(state(R-seq), state(R-merged))`. Sequential application and merged-batch application converge to the same state on equivalent fresh receivers.

### Scenario S-005 — Restore then sync again ( REQ-005 )

1. Build replica R1, apply edits E1 and E2, export R1's state to bytes `S`.
2. Destroy R1 (release its `Y.Doc`).
3. Create a fresh replica R2 initialized from `S` (fresh session client ID, same logical document ID).
4. Assert `deepEqual(state(R2), state(R1-before-destroy))` (restored state retained).
5. Apply a new edit E3 on R2 and a disjoint new edit E4 on a peer replica R3.
6. Exchange updates between R2 and R3 in both directions.
7. Assert `deepEqual(state(R2), state(R3))` with both E3 and E4 present (the restored replica can sync again and converge with a peer, and both new nonconflicting edits are preserved).

### Scenario S-006 — Set-then-delete survives sync and restore ( REQ-002 , REQ-005 )

1. On replica A, set field F = "x", then delete F.
2. Export A's update; apply it to replica B. Assert F is absent in both `state(A)` and `state(B)` (deletion survives sync).
3. Export A's full state to bytes `S`; destroy A; create fresh replica C from `S` (fresh client ID, same logical document ID).
4. Assert F is absent in `state(C)` (deletion survives restore).

### Scenario S-007 — Stale update does not resurrect a deletion ( REQ-002 , correction 6 )

1. On replica A, set F = "x". Export A's full state as the OLDER update `U_old`; apply `U_old` to replica B. Assert F = "x" on both A and B.
2. On replica A, delete F. Export A's full state as `U_del`; apply `U_del` to B. Assert F is absent on both A and B (deletion survives sync).
3. Restore the deleted full state `U_del` into a fresh replica C (fresh client ID, same logical document ID). Assert F is absent on C.
4. Replay the OLDER pre-deletion update `U_old` into C.
5. Assert F is still absent on C — the stale earlier update does not resurrect the deleted key.

## Non-functional requirements

- **Offline behavior.** Every requirement above SHALL be demonstrable with no network connection. The proof runs entirely in-memory in Node.js; no server, no network mock dependency that would fail offline. (Aligns with testing steering: offline behavior is required coverage.)
- **Deterministic test output.** Test runs SHALL print actual pass/fail counts and a deterministic result. Property-based tests SHALL use a fixed seed and report the number of generated/shrunk cases so a run is reproducible.
- **Strict TypeScript.** Any code authored in later phases for this proof SHALL use strict TypeScript with no `any` by default (coding steering). The Kit exposes a clear, versioned public interface and keeps internals private.
- **No secrets or PII in artifacts.** The proof and its outputs contain no keys, tokens, or personal data (security steering).

## Out of scope for this first proof

- **Browser storage** (e.g. IndexedDB persistence). The proof is in-memory only; "persistence after reload" is approximated by export-state-then-restore (REQ-005), not by actual browser storage.
- **App screens / UI.** No FieldLedger, PatchBoard, or Studio UI is involved. The `ui.md` steering does not apply to this proof.
- **File capsule format.** The full capsule envelope (version, checksum, size-bounds framing) is not built here. Only a minimal document-ID carrier alongside raw Yjs update bytes is in scope (REQ-006). Hostile-byte handling, payload size limits, capsule versioning, and checksums are explicitly listed as work required before external file/QR ingestion and are not implemented in this proof.
- **Differential (state-vector) updates.** This proof uses full-state exports (`Y.encodeStateAsUpdate(doc)` with no state vector). Differential updates based on state vectors are future work.
- **QR transport** (small QR and animated QR). Not built.
- **Schema editor.** Not built.
- **Deployment / packaging for distribution.** Not in scope.
- **Sender authentication.** Out of scope by design — a checksum detects corruption, it does not authenticate the sender (security steering). The proof documents this; it does not implement authentication.
- **Hostile-byte handling, payload limits, capsule versioning, checksums.** Out of scope for this proof; required work before external file/QR ingestion (see REQ-006).

## Resolved decisions

The following decisions were resolved for this proof and apply across requirements, design, and tasks.

1. **Runtime.** The proof runs in Node.js using independent in-memory `Y.Doc` instances (no browser profiles for this first proof).
2. **Document model.** One top-level `Y.Map` with string keys and scalar values, where a scalar is a `string`, a finite `number` (not `NaN`, not `±Infinity`), a `boolean`, or `null`.
3. **Document identity.** The logical document ID is caller-supplied and carried alongside the update `Uint8Array` in the update carrier; it is not derived from Yjs internals.
4. **Full-state export.** Exports use `Y.encodeStateAsUpdate(doc)` with no state vector. Differential (state-vector-based) updates are future work.
5. **Observable state and equality.** Observable state is the `Y.Map`'s plain JSON projection, compared by deep equality (not object-identity `===` and not byte-for-byte encoded-Yjs equality).
6. **Conflict resolution.** The proof uses native Yjs conflict resolution; no custom timestamp ordering is imposed.
7. **Restore.** Restore creates a fresh `Y.Doc` with a fresh session client ID and preserves the logical document ID separately (not from Yjs internals).
8. **Browser-compatible SDK (correction 1).** The Kit's `src` contains no Node-only imports (no `node:util`); deep-equality is a test concern using Vitest `expect(...).toEqual(...)`. There is no runtime `deepEqualState` helper in `src`.
9. **Empty payloads (correction 3).** Zero-length `bytes` are rejected as `invalidCarrier` before decoding; `new Uint8Array(0)` is not assumed to be a valid Yjs no-op. A full-state export of an empty `Y.Doc` is non-empty and imports successfully.
10. **Safe projection (correction 4).** `getState()` returns a fresh null-prototype snapshot preserving `__proto__`/`constructor`/`toString` as own data properties; snapshot mutation cannot mutate the replica.
11. **Validation and lifecycle (correction 5).** All scalar types are validated at runtime in `set`; the `applyUpdate` boundary accepts `unknown` and checks the carrier shape before reading fields; after `destroy()` every other operation throws a clear `Error`, and repeated `destroy()` is a safe no-op.
