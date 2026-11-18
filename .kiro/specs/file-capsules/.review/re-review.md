# file-capsules — Re-Review (correction pass)

Review type: **revision**. A prior review (`.review/review.md`,
`.review/verdict.json`: CHANGES_REQUESTED — 1 HIGH, 3 MEDIUM, 4 NIT) is named, so
this pass re-checks each prior finding against the corrected
`requirements.md` / `design.md` / `tasks.md`, marks it **Closed** or
**Unchanged**, then reviews what changed. All Kit/Persist signatures were
re-verified against the real source at `packages/kit/src/*` and
`packages/persist/src/*`. No specs were edited by this review (read-only gate).

Verdict: **APPROVED** (0 HIGH, 0 MEDIUM; remaining notes are NIT only).

---

## Prior findings — disposition

### HIGH-1 — `PersistTarget extends ReplicaTarget` not satisfied by a real `PersistSession` → **CLOSED**
`design.md` Public API now defines `PersistTarget` structurally as
`{ readonly identity: ResolvedIdentity; applyUpdate(carrier: unknown): ApplyOutcome;
flush(): Promise<void>; getState(): State }`, states explicitly it **does NOT
extend `ReplicaTarget`** and requires **no** top-level `documentId`, and reads the
governing id from `target.identity.documentId`. Verified against
`packages/persist/src/types.ts`: a real `PersistSession` exposes
`identity: ResolvedIdentity`, `applyUpdate(carrier): ApplyOutcome`,
`flush(): Promise<void>`, and `getState(): State` — so it satisfies the structural
target **with no wrapper and no change to `PersistSession`**. Consistent across
`requirements.md` (Assumption 2, AC-CAP-003-3), `design.md` (Public API, Identity
rules per path, Decision summary), and `tasks.md` (4.1, 4.3). Resolved correctly.

### MEDIUM-1 — redundant / conflicting document-id sources on the persisted path → **CLOSED**
The explicit `documentId` parameter was removed from
`importCapsuleIntoPersisted(target, bytes, expected, opts)`; `expected` is
`{ app }` only. The single governing document identity is
`target.identity.documentId`. Validation-order step 8 now reads
`metadata.documentId === target.documentId` for the replica helper and
`metadata.documentId === target.identity.documentId` for the persisted helper,
with the text "There is no third source." No dual-source ambiguity remains. Agrees
across requirements (REQ-CAP-003, AC-CAP-003-3), design, and tasks (4.3). Resolved.

### MEDIUM-2 — SDK types not stated as imported; strict/no-any path unspecified → **CLOSED**
`design.md` "Confirmed signatures" and Public API now show `State`,
`ApplyOutcome`, `TransportUpdate` **imported from `@ghostsync/kit`** and
`ResolvedIdentity` **imported (type-only) from `@ghostsync/persist`**, re-exported,
and redefined nowhere ("defines **none** of them locally"). Verified these are
real exports: `@ghostsync/kit` `types.ts` exports `State`, `ApplyOutcome`,
`TransportUpdate`; `@ghostsync/persist` `types.ts` re-exports them and exports
`ResolvedIdentity` (from `identity.ts`). The design states strict TS
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`, no `any`) and **runtime validation** on
`unknown`/`Uint8Array` inputs rather than casting. Task 4.1 restates the import
discipline. Resolved.

### MEDIUM-3 — save-failure "state is error and recoverable" over-claim → **CLOSED**
`design.md` "Import helper semantics" and the Error-handling table now split two
honest cases:
- **Open session**: `flush()` rejects via `#failSave` → `#setState("error")`
  (confirmed in `session.ts`: `QuotaExceededError` on oversize, and
  `TransactionAbortError` on checksum/write failure all route through `#failSave`);
  in-memory data stays readable via `getState()`; session `state === "error"`;
  recoverable by retry. AC-CAP-009-2 is explicitly scoped to this still-readable
  case.
- **Terminal/closing session**: `flush()` on `closed`/`recovery` rejects a
  `ClosedError` (confirmed: `flush()` early-returns
  `Promise.reject(new PersistenceError("ClosedError", …))` when
  `#phase === "closed" || "recovery"`), and after a successful `close()`/`dispose()`
  `getState()` throws `ClosedError` (confirmed: `getState()` calls
  `#assertReadable()` which throws `ClosedError` when `#phase === "closed"`). The
  design does **not** claim in-memory access survives disposal on this path and
  flags it as a programmer-error path outside the recoverable guarantee. Honest and
  source-accurate. Resolved.

### NIT-1 — `encodeCapsule` silently assumes `kind: "full"` → **CLOSED**
`EncodeCapsuleInput.update` is `Uint8Array | TransportUpdate`; a `TransportUpdate`
with `kind !== "full"` rejects with a `TypeError` at the boundary before hashing.
Covered by AC-CAP-002-3 and `encode-kind.test.ts` (tasks 3.1, 5.1). Resolved.

### NIT-2 — `createdAt` admits non-ISO strings → **CLOSED**
One concrete choice: **strict ISO-8601 UTC**, enforced by
`new Date(s).toISOString() === s` **and**
`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`. Stated identically in
`requirements.md` (AC-CAP-002-1/4) and `design.md` (Metadata rules, validation,
Decision summary). Resolved.

### NIT-3 — hard-coded test counts (112/8/50/30) → **CLOSED**
Those case-level totals are gone. AC-CAP-010-2 and tasks now assert suites pass
"unchanged from the pre-change baseline captured at implementation time" and
distinguish confirmable test-**file** counts (42 Kit / 7 Persist unit / 9 e2e)
from unasserted test-**case** counts. Resolved.

### NIT-4 — shared fast-check helper must not match the test glob → **CLOSED**
The shared reporter is `tests/fc-report.ts` (no `.test.ts` suffix), listed in
design "Files to create" with the explicit note and reinforced in tasks 5.1,
mirroring `packages/kit/tests/fc-report.ts`. Resolved.

### Async-contract correction → **CLOSED**
`encodeCapsule`, `decodeCapsule`, `importCapsuleInto`,
`importCapsuleIntoPersisted` all return `Promise`. A dedicated "Which functions
are async vs sync" table marks only non-hashing internal helpers (framing,
metadata validation, duplicate-key scan, `isCapsuleError`) as sync. Reflected in
signatures, the throw-vs-Result decision (reject = throw), the error table,
examples, tasks (2.4/3.1/3.2/4.2/4.3), and planned tests (`await … .rejects`).
Consistent with `crypto.subtle.digest` being async (and `sha256Hex` in
`record.ts` is itself `async`). Resolved.

### Checksum-ambiguity correction → **CLOSED**
`sha256` is a fixed-width 64-char lowercase-hex field appearing exactly once;
duplicate/ambiguous top-level keys are rejected as `Malformed` by a **raw-text
scan** before hashing (because `JSON.parse` keeps only the last value). Encode
writes `"0".repeat(64)`, hashes offsets 7..end, then overwrites the 64 placeholder
bytes in place. Verify operates on received bytes, locates the single `sha256`
span, swaps it to the placeholder, recomputes, and compares — and **must not**
`JSON.stringify` parsed metadata. Covered region (metaLength prefix + metadata +
update) is consistent between design "Checksum coverage" and AC-CAP-004-2.
Validation order is preserved end-to-end: raw-size → magic+version → length
framing → metadata parse + fields + duplicate-key + `updateByteLength === M` →
decoded-size → checksum → (import only) identity → Kit `applyUpdate`. Nothing
mutates before step 9. Resolved.

---

## New findings in the corrected specs

### NIT-5 — covered-region phrasing could be read as including the checksum field's own live bytes
**Severity:** NIT. **Where:** `design.md` "Checksum coverage" (step 1: "the 4
`metaLength` bytes … the `metadata` JSON bytes … the `update` bytes").

The covered region is "offsets 7..end", which includes the `sha256` field bytes
themselves; correctness depends entirely on the placeholder swap (encode writes
`"0"×64`, verify swaps the span to `"0"×64` before hashing). The design does state
the placeholder mechanism clearly a few lines below, so there is no ambiguity for
a careful implementer — but the plain-language "metadata JSON bytes" bullet does
not itself restate "with the 64 `sha256` bytes neutralized to the placeholder."

**Concrete fix (optional):** append to the coverage list a parenthetical — "(the
`sha256` field's 64 bytes are the `\"0\".repeat(64)` placeholder during both
encode-time and verify-time hashing; see the Canonical hashing rule)" — so the
covered-region definition and the placeholder rule are stated in the same place.

### NIT-6 — locating the `sha256` span by a "64-byte lowercase-hex run" is under-specified vs. "the JSON `sha256` value"
**Severity:** NIT. **Where:** `design.md` Checksum "Verify" step (1): "Locate the
single `sha256` value span in the received metadata region (a 64-byte
lowercase-hex run …)".

A metadata region could legitimately contain another 64-char lowercase-hex run
inside a different string value (e.g. a `documentId` that happens to be 64 hex
chars). The intent is clearly "the value bound to the top-level JSON key
`sha256`," which the duplicate-key rejection makes unique for that *key* — but the
"locate a 64-byte lowercase-hex run" phrasing, read literally, is a weaker
predicate than "the value of the `sha256` key." This is an implementation-note gap,
not a contract defect (the metadata schema forbids unknown keys and the field
regex is fixed), so it cannot corrupt state — worst case an implementer picks a
wrong locating strategy and the roundtrip/tamper tests catch it.

**Concrete fix (optional):** reword to "locate the value span bound to the
top-level JSON key `sha256` (its position is derivable from the parsed key's
offset within the raw metadata bytes; its uniqueness is guaranteed by the
duplicate-key rejection)" so the span is defined by the key, not by a hex-run
heuristic.

Both NIT-5 and NIT-6 are polish on an already-unambiguous mechanism; neither
blocks.

---

## Verified Assumptions (checked against real source this pass)

1. **`PersistSession` shape** — `packages/persist/src/types.ts`:
   `identity: ResolvedIdentity`, `applyUpdate(carrier: unknown): ApplyOutcome`,
   `flush(): Promise<void>`, `getState(): State`, `exportBytes(): Uint8Array`,
   `state: SaveState`. No top-level `documentId`. The structural `PersistTarget`
   is satisfied with no wrapper. **Correct (HIGH-1 resolved).**
2. **`ResolvedIdentity`** — `packages/persist/src/identity.ts`:
   `{ app; documentId; replicaId }`; re-exported from `types.ts`. Importable
   type-only by the capsule. **Correct.**
3. **Kit value types** — `packages/kit/src/types.ts` exports `State`
   (`Record<string, Scalar>`), `ApplyOutcome` (reasons `documentIdMismatch` |
   `invalidCarrier` | `malformedUpdate`), `TransportUpdate`
   (`{ documentId; kind: "full"|"diff"; bytes }`); `@ghostsync/persist` re-exports
   all three. The capsule importing/re-exporting them (never redefining) is
   **correct (MEDIUM-2 resolved).**
4. **Open-session save failure → `"error"`, data readable** —
   `packages/persist/src/session.ts`: oversize → `#failSave(QuotaExceededError)`,
   checksum/write failure → `#failSave(TransactionAbortError)`, and `#failSave` →
   `#setState("error")` while retaining dirty data; `getState()`/`exportBytes()`
   stay available while open/recovery. **Correct (MEDIUM-3 open-session case).**
5. **Terminal path** — `flush()` early-returns
   `Promise.reject(PersistenceError("ClosedError"))` on `closed`/`recovery`;
   `getState()` throws `ClosedError` via `#assertReadable()` when `closed`;
   `exportBytes()` throws `ClosedError` when `closed`. The design's "in-memory
   access not guaranteed after disposal" is **accurate (MEDIUM-3 terminal case).**
6. **`sha256Hex` format** — `packages/persist/src/record.ts`: async,
   `crypto.subtle.digest` over a `.slice()` copy, lowercase hex via
   `b.toString(16).padStart(2,"0")`. Matches the capsule's 64-char lowercase-hex
   field and the async contract. **Correct.**
7. **`DEFAULT_MAX_BYTES = 8 MiB`** — `record.ts`. The capsule's 8 MiB decoded cap
   alignment claim is **correct.**
8. **Kit `applyUpdate` no-mutation + carrier gate** — `packages/kit/src/replica.ts`:
   `isValidCarrier` requires `bytes.length > 0`; kind gate and documentId precede
   decode; on throw the doc is rebuilt from a pre-apply snapshot →
   `malformedUpdate`. The REQ-CAP-008 reasoning and the zero-length →
   `invalidCarrier` → `SdkRejection` edge case are **correct.**
9. **`exportState()` is `kind: "full"`** — `replica.ts`
   `{ documentId, kind: "full", bytes: Y.encodeStateAsUpdate(doc) }`; the
   encode full-state-only rule and the carrier the import helper builds
   (`{ documentId, kind: "full", bytes }`) are **correct (NIT-1).**
10. **`SchemaIdentity.app`** — `packages/kit/src/adapter.ts`
    `{ app; schemaVersion; entityType }`. The capsule's single top-level `app`
    maps to this namespace and adds no competing schema system. **Correct.**

## Unverified / Wrong Assumptions

- No **wrong** assumptions remain. The prior "WRONG — `PersistSession` has a
  top-level `documentId`" is now corrected: the specs consistently use
  `session.identity.documentId`.
- **UNVERIFIED (by design, acceptable):** exact runtime test-case counts — now
  explicitly *not* asserted (baseline-to-capture at implementation time);
  lockfile change scoped to task 6.1 when `@ghostsync/capsule` is added to
  `packages/persist/package.json`. Both are correctly deferred to implementation
  and are not planning defects.

---

## Requirement → test coverage

Unchanged from the prior pass and still complete: every REQ-CAP-001..010 and
NFR-CAP-001/003 maps to at least one named planned test in both `requirements.md`
and `tasks.md`, and the two tables agree. The corrected contracts gained named
coverage: `encode-kind.test.ts` (AC-CAP-002-3, diff rejection),
`metadata.test.ts` (AC-CAP-002-4, duplicate/ambiguous key + strict `createdAt`),
the persisted-identity case in `identity.test.ts` (AC-CAP-003-3, governed by
`session.identity.documentId`), `checksum.test.ts` (AC-CAP-004-2, recompute over
received bytes without reserialization), and `capsule-persistence.spec.ts`
(AC-CAP-009-2, open-session `armWriteAbortOnce` → `applied:true, persisted:false`,
readable, `"error"`). No test is claimed to have run. No application code or
existing tests are modified. Stable requirement IDs retained; all tasks pending.

**Bottom line:** every prior HIGH/MEDIUM/NIT finding plus the async-contract and
checksum-ambiguity corrections are resolved and consistent across requirements,
design, tasks, and examples, and each contract was re-verified against the real
Kit/Persist source. Only two NITs remain (polish on already-unambiguous checksum
prose). Mechanical count: 0 HIGH, 0 MEDIUM → **APPROVED**.
