# sdk-foundation — Tasks

> Ordered implementation checklist for the sdk-foundation spec. Each task links to the requirement IDs it satisfies. **Implemented and verified** (see `docs/progress.md` for commands, exit codes, test totals, and per-property RunDetails). Tasks are marked `- [x]` as completed and verified by a real command run (`pnpm.cmd -F @ghostsync/kit typecheck`/`test`/`build` all exit 0; 39 test files / 102 tests pass incl. the 14 baseline files / 37 tests unchanged; 8 fast-check properties pass seed 424242 / 200 runs). The three spec docs are reconciled with the six implementation clarifications and the actual implementation below.
>
> **Verified baseline:** commit `ab37419` (independently verified). All work is **additive** on top of the baseline; the 37 existing tests and six fast-check properties must stay green and unedited (NFR-SDK-005).
>
> **Architecture-correction revision (revision 4).** Tasks are updated to the **flat-composite-key** data model (defect A), **changed-fields `put`** (defect B), **key-delta-derived notifications** (defect C), the **kind-gated direct-apply + snapshot-rollback** apply boundary, **schema identity recorded in-doc**, and the **browser-compat / union-growth** doc fixes. Consistent with `requirements.md` and `design.md`.
>
> **Revision 5 (MEDIUM-1 — two separate top-level maps).** Tasks are updated so the structured composite keys live in a dedicated top-level map `doc.getMap("ghostsync:records:v1")`, separate from the legacy `doc.getMap("root")`. The bare-vs-structured discriminator is removed everywhere: `getState()` projects every `root` key unconditionally, and map membership (not a key-shape predicate) decides ownership. No legacy key is reserved or rejected. Notifications inspect the key delta of **both** maps. Consistent with `requirements.md` and `design.md`.

## Status legend

- `- [ ]` — pending (not started / not yet verified).
- `- [x]` — complete and verified by a real command run. **All implementation and test tasks are marked `- [x]`; verification is recorded in `docs/progress.md`.**

## Implementation clarifications applied (six)

These six clarifications were applied in code AND reconciled across `requirements.md`, `design.md`, and this file:

1. **Collection addressing.** `collection(adapter)` derives a deterministic collection identifier from the `(app, entityType)` tuple, encoded collision-safe via the composite-key escaping: `collectionId = esc(app) + SEP + esc(entityType)` (`src/keys.ts`). Two distinct tuples can never encode to the same string. `schemaVersion` stays in the persisted schema meta key — it does NOT open a separate namespace. Schema-identity components are validated at runtime (`assertSchemaIdentity`). Tested: same entity id across two distinct collections never mixes fields (`key-escaping.test.ts`).
2. **Preserve pending updates.** The false "pending-update loss is acceptable" claim is removed everywhere. Yjs 13.6.33 `encodeStateAsUpdate` includes pending updates, so the pre-apply snapshot carries them through a rollback — VERIFIED by a regression delivering a dependent update before its prerequisite across an intervening failed-then-recovered apply (`malformed-update.test.ts`), plus delete-before-insert and snapshot/restore. Fresh `clientID` per `new Y.Doc()` is preserved (never copied).
3. **Apply recovery and lifecycle.** Implemented as **direct-apply + snapshot-rollback-on-throw** (see design.md U6): a pre-apply snapshot (`Y.encodeStateAsUpdate`, which includes pending updates) is captured; the durable change observer is DETACHED for the raw apply so no mid-throw partial state can reach subscribers (a one-shot probe computes the observable delta); on failure the partially-mutated doc is destroyed and the committed doc is REBUILT from the snapshot (untouched observable projection), with no notification; on success exactly one remote notification fires iff a key changed; listeners and `Collection` handles are preserved (handles resolve the current committed doc lazily via `CollectionHost`); discarded docs are destroyed; a subscriber exception never turns a successful apply into a rejection. Tested after both a successful swap and a rejected apply.
4. **Typed reads and deletion.** `get`/`getResult`/`list` run `fromFields` + `validate` on reads; an incomplete/invalid record is a CONTROLLED outcome (`getResult` → `{ ok:false, reason:"invalidRecord", fields }`; `get` throws `IncompleteRecordError`) that preserves the underlying fields. Regression in `incomplete-record.test.ts`. Entity-wide business deletion policy is future app-layer work.
5. **Schema checks.** Schema meta persisted in the records map; compatibility is RECHECKED for existing `Collection` handles on every op (`put`/`open`), not only at initial open, so a conflicting version arriving via `applyUpdate` is detected deterministically (`schema-identity.test.ts`).
6. **put semantics.** `put` validates and computes all changes before mutation, writes only changed fields, deletes omitted fields, and performs NO write for unchanged fields. Comparison is against CURRENT LOCAL state — a stale full entity can still express an overwrite; no stale-form safety is promised. Shared-baseline A-title/B-priority regression in `put-changed-fields.test.ts`.

## Ordered task list

### T1 — Confirm tooling and browser-compat config (no change expected) [ NFR-SDK-001 , NFR-SDK-004 , NFR-SDK-005 ]

- [x] 1.1 Confirm `packages/kit/tsconfig.json` already compiles with `strict`, `lib: ["ES2022"]` (no `DOM`), `module/moduleResolution NodeNext`, `declaration true`; no edit expected. (NFR-SDK-001)
- [x] 1.2 Confirm `tsconfig.build.json` still emits `src`-only to `dist/`; no edit expected. (NFR-SDK-004)
- [x] 1.3 Confirm no new dependency is needed — `yjs@13.6.33` provides `encodeStateVector`, `encodeStateAsUpdate(doc, sv)`, `mergeUpdates`, and `afterTransaction` with a readable key delta (verified present). Do NOT edit `package.json` or the lockfile. (NFR-SDK-004)

### T2 — Adapter contract [ REQ-SDK-001 ]

- [x] 2.1 Create `src/adapter.ts` — `SchemaIdentity`, `Fields`, `EntityAdapter<T>` (`schema`, `validate`, `toFields`, `fromFields`). Structural scalar/shape validation only; no engine code references an app type. (AC-SDK-001-1/4)
- [x] 2.2 Export the adapter types from `src/index.ts`. (AC-SDK-001-1)

### T3 — Flat-composite-key data model + changed-fields put + field guard [ REQ-SDK-002 , REQ-SDK-003 , REQ-SDK-003A , REQ-SDK-007 ]

- [x] 3.1 Create `src/keys.ts` — composite-key codec scoped to the records map: `RECORDS_MAP="ghostsync:records:v1"`, `SENTINEL="\u0001"`, `SEP="\u001f"`, NUL-introducer `esc`/`unesc`, `fieldKey(collection,id,field)`, `metaKey(collection)`, `parseFieldKey(key)` → `{collection,id,field}`. Pure, browser-safe, no `node:`. (AC-SDK-002-9) Do NOT export a bare-vs-structured predicate (`isStructuredKey`/`isBareKey`): map membership decides ownership, so no key-shape classification exists. The codec and its sentinels/escaping are used ONLY against `doc.getMap("ghostsync:records:v1")` and NEVER against `root`.
- [x] 3.2 Keep baseline `set/delete/get/has/getState` operating **directly on the legacy `doc.getMap("root")` map**, unchanged from `ab37419`; do NOT introduce a `__default__` nested map, do NOT create nested per-entity maps, and do NOT change the encoded structure of `root`. `getState()` stays the flat projection of **every** `root` key (reuse `src/state.ts` `project(root)` as-is, NO filtering, NO sentinel inspection). No `root` key is reserved or rejected — a key beginning with `\u0001` or byte-identical to a structured field key is a valid legacy key. This preserves the baseline byte fixture and `projection.test.ts`. (NFR-SDK-005, AC-SDK-002-8/10/11)
- [x] 3.3 Create `src/collection.ts` — `Collection<T>` + `CollectionImpl` over the **`ghostsync:records:v1`** map via the codec (never touching `root`):
  - `put(id, entity)` = **changed-fields diff** (REQ-SDK-003A): `adapter.validate` then `assertScalar` each `toFields` value BEFORE any mutation (throw, no mutation); compute diff vs currently-stored fields; in ONE `doc.transact(LOCAL_ORIGIN)` set only changed leaf keys, delete leaf keys for omitted fields, NO write for unchanged fields. (AC-SDK-003A-1/2/3, AC-SDK-001-1/2, AC-SDK-007-1)
  - `get(id)` groups this collection's live field keys in the records map, projects a null-prototype field object, runs `fromFields`; `undefined` if no live field key. (AC-SDK-001-4, AC-SDK-002-8)
  - `list()` enumerates by scanning the records-map field keys; `delete(id)` removes all of id's field keys in ONE transaction (local atomicity); `has(id)` iff ≥1 live field key. (AC-SDK-002-1/5)
- [x] 3.4 Record each collection's `SchemaIdentity` as a reserved meta leaf key (`metaKey(collection)`, JSON value) in the `ghostsync:records:v1` map on first open/write so it travels in exported bytes (both maps share one `Y.Doc`); on open, if a meta key exists, reject an incompatible adapter with `Error("GhostSync Kit: schema mismatch for collection …")` and mutate nothing. Must work after restore and remote import, not just first process-local open. (AC-SDK-003-2, AC-SDK-007-2)

### T4 — Identity dimensions [ REQ-SDK-003 ]

- [x] 4.1 Keep logical `documentId` stored separately from Yjs; confirm fresh `clientID` per `new Y.Doc()` and that it is never used as identity. (AC-SDK-003-1/3)
- [x] 4.2 Document the local-persistence identifier derivation (`"ghostsync:" + documentId`) as a storage-tier concern; do NOT implement storage. (AC-SDK-003-4)
- [x] 4.3 Add the "metadata does not authenticate bytes or senders; a checksum detects corruption, not authenticity" docblock on the apply boundary; verify behaviorally, not by comment scan. (AC-SDK-003-5)

### T5 — Incremental synchronization [ REQ-SDK-004 , REQ-SDK-007 ]

- [x] 5.1 Implement `exportStateVector(): StateVector` = `{ documentId, kind:"stateVector", bytes: Y.encodeStateVector(doc) }`. (AC-SDK-004-2)
- [x] 5.2 Implement `exportDiff(remoteStateVector: unknown): ExportDiffResult` — validate the peer carrier at the boundary (it is a future transport message, not trusted same-process): shape → `invalidStateVector`; `documentId` → `documentIdMismatch`; `kind !== "stateVector"` → `invalidStateVector`; SV bytes that make `Y.encodeStateAsUpdate(doc, bytes)` throw → `invalidStateVector`. On success `{ ok:true, update:{ documentId, kind:"diff", bytes } }`. NEVER mutate the doc, NEVER notify. (AC-SDK-004-1, AC-SDK-007-8)
- [x] 5.3 Keep full-state `exportState()` using `Y.encodeStateAsUpdate(doc)` (no state vector), returning `kind:"full"`. Additive, not a replacement. (AC-SDK-004-6)
- [x] 5.4 Confirm a legitimate no-op diff is non-empty Yjs bytes and still passes carrier validation; do NOT special-case zero-length as a no-op (zero-length stays `invalidCarrier`). (AC-SDK-004-3)

### T6 — Lifecycle notifications (key-delta-derived) + feedback-loop prevention [ REQ-SDK-005 ]

- [x] 6.1 Add module-private `LOCAL_ORIGIN`/`REMOTE_ORIGIN` symbols; wrap all mutations in `doc.transact(fn, origin)`. (AC-SDK-005-1/2)
- [x] 6.2 Implement `subscribe(listener): Unsubscribe` backed by one `doc`-level `afterTransaction` subscription and a listener `Set`; `unsubscribe` removes just that listener. (AC-SDK-005-1/2/4)
- [x] 6.3 In the `afterTransaction` handler, derive the observable change from the transaction's key delta across **both** top-level maps, using the single accessor `transaction.changed.get(map)` (a `Set<string|null>`; undefined/empty = no change for that map) for `doc.getMap("root")` and `doc.getMap("ghostsync:records:v1")`. Notify AT MOST ONCE per transaction with `{ documentId, origin: tx.origin===REMOTE_ORIGIN?"remote":"local" }` **iff the combined key delta of the two maps is non-empty** (a transaction touching either or both maps yields a single notification). Do NOT infer change from the event firing — a no-op fires `afterTransaction` once (defect C) and must notify ZERO subscribers. (AC-SDK-005-1/2/6)
- [x] 6.4 Wrap each listener dispatch in `try/catch` so a throwing listener does not stop other listeners and does not change the triggering `applyUpdate`/write outcome, and is never reported as `malformedUpdate`. (AC-SDK-005-7)
- [x] 6.5 On `destroy()` clear all listeners + `doc.destroy()`; post-destroy ops (incl. `subscribe`) throw the baseline `Error`; repeated `destroy` is a no-op. (AC-SDK-005-5)

### T7 — Transport-neutral contract + kind-gated, direct-apply + snapshot-rollback apply [ REQ-SDK-006 , REQ-SDK-007 ]

- [x] 7.1 Define `TransportUpdate`, `StateVector`, `TransportEnvelope`, `ExportDiffResult` in `src/types.ts`; keep `UpdateCarrier` as a structural supertype alias (U2). (AC-SDK-006-1/4)
- [x] 7.2 Extend `ApplyOutcome` with `{ ok:false, reason:"malformedUpdate" }`; record in docs that union growth is a potential MINOR breaking change for an exhaustive consumer `switch` with no `default` (NFR-SDK-004, U7). (AC-SDK-007-5)
- [x] 7.3 Rewrite `applyUpdate(carrier: unknown)` with the ordered boundary + direct-apply + snapshot-rollback-on-throw, observer detached for the raw apply (DONE — `src/replica.ts`):
  1. shape check → `invalidCarrier`;
  2. **kind gate** — `kind` absent/`"full"`/`"diff"` proceeds; `"stateVector"` or unknown → `invalidCarrier` BEFORE treating bytes as an update (AC-SDK-007-4);
  3. document-id check → `documentIdMismatch`;
  4. **guarded live merge with snapshot-rollback** — capture `snapshot = Y.encodeStateAsUpdate(doc)` (serializes BOTH maps AND any pending out-of-order updates), DETACH the durable `afterTransaction` observer (so a partially-mutated mid-throw state can never be dispatched to subscribers), attach a one-shot delta probe, then apply the foreign bytes DIRECTLY to the live doc under `try/catch`; on throw, rebuild the committed doc from the snapshot (restoring the observable projection incl. pending updates), reattach the observer, destroy the old doc, return `malformedUpdate` with no notification; on success, reattach the durable observer and notify once iff the combined key delta of `root` and `ghostsync:records:v1` was non-empty. The `Collection` handles and subscriptions survive because they reference the replica and resolve `this.#doc` lazily.
  **Implementation decision (reconciled here):** the recovery uses **direct-apply-to-live-doc + snapshot-rollback-on-throw**, NOT a staging-copy-then-swap and NOT a separate empty scratch decode. Rationale: applying to a staging copy and swapping on success did a full `encodeStateAsUpdate` + `new Y.Doc()` + double `applyUpdate` on EVERY apply, ~6× the cost, which pushed the unmodified baseline `merge-invariant.property.test.ts` (~19200 applies × 200 runs) past its 5s per-test timeout under parallel worker load. Direct-apply keeps only the cheap pre-apply snapshot (used solely for the rare throw rollback) and preserves the exact guarantee: the live doc is never exposed to subscribers mid-throw (observer detached), and any `ok:false` leaves the observable projection deep-equal to before with no notification. Applying to the live doc also keeps pending out-of-order updates directly (no round-trip needed).
  No mutation and no notification on any rejection. Do NOT assume `Y.applyUpdate` auto-rolls-back or that the live apply cannot throw; bound the guarantee to the observable projection. **Verified:** pending out-of-order Yjs updates are preserved (Yjs 13.6.33 `encodeStateAsUpdate` serializes pending structs/ds; the rollback snapshot carries them, and the regression in 9.21 delivers a dependent update before its prerequisite across an intervening apply and converges with no edit lost). (AC-SDK-007-3/4/5/6/7)
- [x] 7.4 Keep capsule encoding, checksums, size bounds, QR, and transport UI OUT; document them as the capsule/transport tier's job (size bounded before decode there). (AC-SDK-006-3, AC-SDK-007-9)

### T8 — Two adapter consumers (proof of schema-agnostic engine) [ REQ-SDK-001 ]

- [x] 8.1 Author a FieldLedger `incidentAdapter` fixture (`app:"fieldledger"`, `entityType:"incident"`) in the test tree (not an app package). (AC-SDK-001-3)
- [x] 8.2 Author a PatchBoard `cardAdapter` fixture (`app:"patchboard"`, `entityType:"card"`) in the test tree. (AC-SDK-001-3)
- [x] 8.3 Prove the same engine serves both with no engine change — two distinct schemas over one SDK. Do NOT build app UI. (AC-SDK-001-3)

### T9 — Tests (all planned; none run in this milestone) [ all REQ , testing ]

- [x] 9.1 `adapter.test.ts` — `toFields`/`fromFields` round-trip; non-scalar field rejected before mutation. (AC-SDK-001-1/2/4)
- [x] 9.2 `fieldledger-adapter.test.ts` — incident create/get/update/delete/list via `Collection<Incident>`. (AC-SDK-001-3)
- [x] 9.3 `patchboard-adapter.test.ts` — card create/get/update/delete/list via `Collection<Card>`; same engine, different schema. (AC-SDK-001-3)
- [x] 9.4 `entities.test.ts` — structured convergence: two replicas create/edit entities, exchange, deep-equal via `list()`; entities are scalar-field sets not JSON strings nor nested maps; null-prototype field safety. (AC-SDK-002-1/8)
- [x] 9.4a `two-map-layout.test.ts` — assert the two-map layout: `doc.getMap("root")` and `doc.getMap("ghostsync:records:v1")` are distinct top-level maps in one `Y.Doc`; `getState()` includes ALL legacy `root` keys and NO structured records (collision test 4 / AC-SDK-002-8); a full-state export AND a differential export both transfer BOTH maps so a structured record and a legacy key both converge after exchange (collision test 5, ties AC-SDK-004-1/6); no nested per-entity map is ever created. (AC-SDK-002-8, AC-SDK-004-1/6)
- [x] 9.5 `concurrent-create.structured.test.ts` — **defect-A regression:** two replicas each independently create the SAME entity id OFFLINE (no server/pre-sync), each writing some fields; after two-way exchange BOTH sides' fields survive (field union; any shared field by LWW). Assert the exact scenario that lost data under nested maps now converges with no loss. (AC-SDK-002-4)
- [x] 9.6 `conflict.structured.test.ts` — concurrent different-field edits both survive; same-field conflict resolves to one submitted value on both (no which-wins, no wall-clock). (AC-SDK-002-2/3)
- [x] 9.7 `deletion.structured.test.ts` — entity deletion (one transaction removing all field keys) converges to absent; edit-concurrent-with-deletion converges to one identical state (record actual field-level outcome: a concurrent different-field write survives as a single-field entity); reused-deleted-id recreates the entity. (AC-SDK-002-5/6/7)
- [x] 9.8 `key-escaping.test.ts` — collection/entity/field names containing `SEP`, `SENTINEL`, NUL, or the kind words `"f"`/`"m"` round-trip through the records-map codec unambiguously; two collections with entity id `"1"` never mix fields. Also the two collision regressions (collision tests 1 and 2): (a) **collision test 1** — a legacy key written via `replica.set` that is byte-identical to a structured field key (e.g. `"\u0001f\u001fcol\u001fE\u001ftitle"`) coexists with that structured field; `replica.get`/`getState` read the LEGACY value from `root` while `Collection#get` reads the STRUCTURED value from the records map, neither shadowing the other; (b) **collision test 2** — a legacy key beginning with `SENTINEL` (`"\u0001anything"`) is a valid legacy key: `set`/`get`/`has`/`delete`/`getState` all operate on it and it is never rejected, reserved, or reclassified. (AC-SDK-002-9/10/11, AC-SDK-003-2)
- [x] 9.9 `convergence.structured.property.test.ts` — fast-check (seed 424242, 200 runs via `tests/fc-report.ts`): arbitrary nonempty entity/field edit sets incl. concurrent same-id creation converge; idempotency/commutativity/associativity carried to the composite-key model; report real `RunDetails`. (AC-SDK-002-1/4, NFR-SDK-003)
- [x] 9.10 `put-changed-fields.test.ts` — **defect-B regression:** both peers start `{title:"old", priority:"low"}`; A `put`s only a title change, B `put`s only a priority change via the documented `put` API; after exchange BOTH survive (`{title:A, priority:B}`). Also assert unchanged fields generate no write and omitted fields are removed. (AC-SDK-003A-1/2/3)
- [x] 9.11 `identity.test.ts` — `documentId` separate from `clientID`; two replicas of one doc have distinct `clientID`; behavioral metadata-is-not-auth (wrong-doc carrier rejected, state unchanged). (AC-SDK-003-1/3/5)
- [x] 9.12 `schema-identity.test.ts` — `SchemaIdentity` recorded as an in-doc meta key travels through export/restore AND remote import; opening with an incompatible adapter after restore/import is rejected and mutates nothing. (AC-SDK-003-2, AC-SDK-007-2)
- [x] 9.13 `diff-sync.test.ts` — initial sync via state vector + diff; already-synced peers produce a non-empty no-op diff that leaves state unchanged and fires no notification; duplicate diff delivery idempotent; restore-then-sync converges; full-state export still works. (AC-SDK-004-1/3/4/5/6)
- [x] 9.14 `diff-sync.property.test.ts` — fast-check: for arbitrary disjoint edit sets, diff-based convergence equals full-state convergence; report real `RunDetails`. (AC-SDK-004-1, NFR-SDK-003)
- [x] 9.15 `notifications.test.ts` — local write to EITHER map (a legacy `set` on `root` and a `Collection.put` on the records map) → `origin:"local"` exactly once per transaction (collision test 6 local path); applied remote update changing either/both maps → `origin:"remote"` once; a no-op (both maps' key deltas empty) fires ZERO notifications even though `afterTransaction` fired (defect C); unsubscribe stops one listener; a throwing listener does not stop others and does not change the apply outcome (listener-isolation); post-destroy `subscribe` throws. (AC-SDK-005-1/2/4/5/6/7)
- [x] 9.16 `no-feedback-loop.test.ts` — two replicas cross-wired via `subscribe`, each re-broadcasting **only when `event.origin === "local"`**; assert (a) both converge and (b) the already-known remote apply has an EMPTY combined key delta and fires ZERO notifications (collision test 6 no-op path; tie to AC-SDK-005-6) → provable fixpoint, not coincidental halt. (AC-SDK-005-3/6)
- [x] 9.17 `transport-contract.test.ts` — `exportState`/`exportDiff`/`exportStateVector` return the correct `kind` and non-empty `bytes`; a `TransportUpdate` satisfies the baseline carrier at `applyUpdate`. (AC-SDK-006-1/2/4)
- [x] 9.18 `validation.structured.test.ts` — `put` rejects invalid T / non-scalar field before mutation; schema-mismatch rejected; rejection leaves state unchanged. (AC-SDK-007-1/2)
- [x] 9.19 `apply-kind-boundary.test.ts` — a `StateVector` carrier (`kind:"stateVector"`) and an unknown-`kind` carrier are rejected `invalidCarrier` BEFORE their bytes are decoded, with no mutation and no notification; a `kind:"full"`/`"diff"`/absent carrier proceeds. (AC-SDK-007-4)
- [x] 9.20 `export-diff-rejection.test.ts` — `exportDiff` rejects each bad peer carrier with the stable reason (malformed shape → `invalidStateVector`; wrong documentId → `documentIdMismatch`; wrong kind → `invalidStateVector`; undecodable SV bytes → `invalidStateVector`); no mutation, no notification. Also assert a VALID no-op diff is non-trivial non-empty bytes (not zero-length). (AC-SDK-007-8, AC-SDK-004-3)
- [x] 9.21 `malformed-update.test.ts` — (a) truncated/garbage `bytes` past shape+kind+id → `malformedUpdate`, projection deep-equal to before (the staging decode discards without touching the committed doc); (b) documentId mismatch and zero-length still rejected with correct reasons; (c) **continued edit + sync AFTER a rejected apply**: after a rejection the SAME `Collection` handle still reads/writes, the replica exports, and converges with a peer (subscriptions and `Collection` handles survive); (d) **clarification 2 — out-of-order incremental updates WITH DEPENDENCIES**: deliver a later diff before its prerequisite (held pending), perform ANOTHER successful swap-exercising apply in between, then deliver the prerequisites; assert convergence and that every expected edit (incl. the title that depended on the base structure) is preserved; (e) **delete-before-insert** delivery converges (deletion wins); (f) **snapshot/restore** round-trips through the swap-based apply and still accepts further updates; every staging `Y.Doc` destroyed. (AC-SDK-007-3/4/5/6/7) DONE + verified.
- [x] 9.22 `baseline-fixture.test.ts` — **collision test 8:** restore bytes produced by the baseline `ab37419` build (a committed fixture of `exportState().bytes` for a known flat state, written before the records map existed) into a fresh replica; assert `getState()` deep-equals the known flat projection (baseline encoded data preserved because the `root` map's encoded structure is unchanged by adding a separate `ghostsync:records:v1` map). (NFR-SDK-005)
- [x] 9.23 `no-node-imports.test.ts` — scan `src/**` for `node:` imports / Node-only globals; assert none, as a STATIC build-time check of NFR-SDK-001 (explicitly NOT browser-execution evidence, which is pending). (NFR-SDK-001)
- [x] 9.24 Confirm all 14 existing test files / 37 tests + six fast-check properties remain present and unedited. (NFR-SDK-005)

### T10 — Final verification (commands listed; NOT run in this planning milestone) [ NFR-SDK , testing ]

Run from the workspace root on Windows PowerShell. Exit codes are PowerShell `$LASTEXITCODE`. **These are the exact future commands; do not run them in the planning milestone.**

- [x] 10.1 Install and prove the lockfile is reproducible (no new dependency expected):
  ```powershell
  pnpm.cmd install --frozen-lockfile
  ```
- [x] 10.2 Strict typecheck (src + tests + config, no emit):
  ```powershell
  pnpm.cmd -F @ghostsync/kit typecheck
  ```
- [x] 10.3 Tests (capture actual pass/fail totals and the real fast-check `seed`/`numRuns`/`numSkips`/`numShrinks`):
  ```powershell
  pnpm.cmd -F @ghostsync/kit test
  ```
- [x] 10.4 Build (emit `src`-only `.js` + `.d.ts` to `dist/`):
  ```powershell
  pnpm.cmd -F @ghostsync/kit build
  ```
- [x] 10.5 Built-entry smoke check (pattern; write a temp script, run it, then delete it): import the BUILT public entry `dist/index.js`, create two replicas of one `documentId`, open a `collection` with each of the FieldLedger and PatchBoard adapters, have BOTH independently create the same entity id with disjoint fields (defect-A path), `put` a single-field change on each (defect-B path), ALSO set a legacy key via `replica.set` (including one byte-identical to a structured field key) to exercise the two-map layout, exchange a `diff` both ways, assert both converge to deep-equal structured state AND legacy state with all fields preserved and the legacy/structured values independent, assert a `subscribe` listener fired `origin:"local"` for a local write and `origin:"remote"` for an applied update and ZERO for a re-applied no-op, then `destroy()` both:
  ```powershell
  # pattern only — exact script authored in the implementation milestone
  node -e "import('@ghostsync/kit').then(m => { /* two replicas, two adapters, concurrent same-id create, changed-field put, diff exchange, converge+no-op-notify asserts */ })"
  ```
- [x] 10.6 Confirm the test run prints actual counts and configured seed/run counts; a "should work" narrative is not accepted (testing steering). Do NOT claim any planned test passed in this planning milestone.

## Coverage matrix

Every requirement maps to at least one task above and at least one planned test.

| Requirement | Acceptance criteria | Tasks | Planned tests |
| --- | --- | --- | --- |
| REQ-SDK-001 | AC-SDK-001-1..4 | T2, T8, T11 | 9.1, 9.2, 9.3, 11.4 (list-results.test.ts) |
| REQ-SDK-002 | AC-SDK-002-1..11 | T3, T9 | 9.4, 9.4a, 9.5, 9.6, 9.7, 9.8, 9.9 |
| REQ-SDK-003 | AC-SDK-003-1..5 | T3.4, T4, T11 | 9.11, 9.12, 11.2 (schema-recheck-all-ops.test.ts) |
| REQ-SDK-003A | AC-SDK-003A-1..3 | T3.3 | 9.10 |
| REQ-SDK-004 | AC-SDK-004-1..6 | T5 | 9.4a, 9.13, 9.14, 9.20 |
| REQ-SDK-005 | AC-SDK-005-1..7 | T6 | 9.15, 9.16 |
| REQ-SDK-006 | AC-SDK-006-1..4 | T7 | 9.17 |
| REQ-SDK-007 | AC-SDK-007-1..9 | T3, T5.2, T7, T11 | 9.18, 9.19, 9.20, 9.21, 11.2 (schema-recheck-all-ops.test.ts), 11.5 (partial-mutation-recovery.test.ts) |
| NFR-SDK-001 | browser-compat static check | T1, T9.23 | 9.23 |
| NFR-SDK-003 | deterministic property output | T9 | 9.9, 9.14 |
| NFR-SDK-005 | regression + baseline fixture + two-map layout | T1, T3.2, T9.24 | 9.4a, 9.8, 9.22, all existing 14 files / 37 tests + six properties |

No acceptance criterion is left without an implementation task and a concrete planned test. No implementation task is marked complete in this planning milestone, and no planned test is claimed passing.

## T11 — Independent-review corrections (implemented + verified)

Correction round after the SDK implementation. Scope limited to `packages/kit/src/collection.ts`
plus new test files and spec/docs; the two-map architecture and the direct-apply + snapshot-rollback
recovery strategy are unchanged. Every box below is checked only because it was implemented AND
verified by the run recorded in `docs/progress.md` (typecheck/test/build exit 0; 112 tests pass).

- [x] 11.1 Correction 1 — `#assertSchemaCompatible()` now runs BEFORE every public `Collection`
  operation (`put` already did; ADDED to `get`/`getResult`/`list`/`listResults`/`delete`/`has`). A
  mismatch raises the documented schema-mismatch `Error`, never an `absent`/`invalidRecord` outcome; a
  delete through an incompatible handle throws before any scan/transaction (no mutation, no notify). The
  parsed meta is validated (`assertSchemaIdentity`) before comparison, so corrupt meta → controlled
  error. (AC-SDK-007-2, AC-SDK-003-2)
- [x] 11.2 Correction 1 test — `tests/schema-recheck-all-ops.test.ts`: v2 meta written as a CAUSAL
  SUCCESSOR of v1 (deterministic, no LWW coin-flip); every v1-handle op rejects with schema mismatch; a
  fresh v2 handle works; corrupt meta (`null` and a non-string number) yields a controlled error; the
  bad-delete path fires zero notifications and mutates nothing.
- [x] 11.3 Correction 2 — added `Collection<T>.listResults(): ReadonlyArray<readonly [string,
  GetResult<T>]>` enumerating EVERY stored id (incl. invalid records) using the existing `GetResult<T>`
  shape, repairing/deleting/fabricating nothing; `list()` stays valid-only. `GetResult` was already a
  public export in `index.ts` (no index change needed). (AC-SDK-001-1)
- [x] 11.4 Correction 2 test — `tests/list-results.test.ts`: valid + incomplete records enumerated
  together, before AND after synchronization (incomplete built via concurrent field deletion/partial
  delivery); `listResults` yields both ok and `invalidRecord` results with fields intact; `list()`
  returns only the valid ones.
- [x] 11.5 Correction 3 test — `tests/partial-mutation-recovery.test.ts`: CONTROL asserts the final-byte
  truncation partially mutates a raw `Y.Doc` (throws yet `injected` present); the SAME bytes through the
  public `applyUpdate` return `malformedUpdate` with legacy+structured state preserved, `injected`
  absent, zero notifications, surviving handles/subscribers, and converging subsequent edit+sync; a
  pending dependent update survives the rejected apply and integrates on prerequisite delivery; every
  raw doc/replica destroyed in `finally`. No production failure-injection API added.
- [x] 11.6 Docs — `design.md` (Collection interface + identity recheck note + recovery regression note),
  `requirements.md` (AC-SDK-001-1 operation list incl. `listResults`; AC-SDK-007-2 every-operation
  recheck + corrupt-meta validation + the honest "read/enumeration/delete paths previously did NOT
  recheck" statement), and this T11 section updated. Prior APPROVED verdict and earlier findings left in
  the record.
