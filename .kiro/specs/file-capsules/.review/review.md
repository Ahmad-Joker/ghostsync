# file-capsules — Specification Review

Review type: fresh (no prior review named). Scope: `requirements.md`,
`design.md`, `tasks.md`, and the appended `docs/progress.md` planning milestone.
All quoted Kit/Persist signatures were cross-checked against the real source at
`packages/kit/src/*` and `packages/persist/src/*`. No specs were edited by this
review.

Verdict: **CHANGES_REQUESTED** (1 HIGH, 3 MEDIUM, 4 NIT).

---

## Findings

### HIGH-1 — `PersistTarget extends ReplicaTarget` is NOT satisfied by a real `PersistSession`
**Where:** `design.md` → *Public API* (`ReplicaTarget`, `PersistTarget`) and
*Confirmed signatures* note.

`ReplicaTarget` is declared with `readonly documentId: string`, and
`PersistTarget extends ReplicaTarget`, so the type requires a **top-level**
`target.documentId`. But the real `PersistSession`
(`packages/persist/src/types.ts`) has **no** top-level `documentId` — the id is
only reachable as `session.identity.documentId` (confirmed:
`PersistSession.identity: ResolvedIdentity`, and `ResolvedIdentity.documentId`
in `identity.ts`). The design itself admits this in prose ("there is no
top-level `documentId` property") yet still defines `PersistTarget extends
ReplicaTarget`. A real `PersistSession` therefore does **not** structurally
satisfy `PersistTarget`, so `importCapsuleIntoPersisted(session, …)` will not
type-check against the actual session — the planned harness wiring
(`AC-CAP-009-1/2`, `capsule-persistence.spec.ts`) cannot compile as specified.

**Concrete fix (pick one and make the API self-consistent):**
- Preferred: do **not** have `PersistTarget` extend `ReplicaTarget`. Define it as
  the structural surface the persisted path actually uses and that
  `PersistSession` really exposes:
  ```ts
  export interface PersistTarget {
    applyUpdate(carrier: unknown): ApplyOutcome;
    flush(): Promise<void>;
    getState(): State;
  }
  ```
  The document identity for the persisted path is supplied by the explicit
  `documentId` parameter already in `importCapsuleIntoPersisted(target,
  documentId, …)` — which is exactly what the caller sources from
  `session.identity.documentId`. Drop any reliance on `target.documentId` in the
  persisted helper.
- Alternative: keep the extension but change the persisted helper to read
  `target.identity.documentId`, and type `PersistTarget` with `readonly
  identity: { readonly documentId: string }` instead of a top-level field. Then
  the separate `documentId` parameter is redundant and should be removed to avoid
  two sources of truth (see MEDIUM-1).

### MEDIUM-1 — Redundant / conflicting document-id sources on the persisted path
**Where:** `design.md` → *Public API* (`importCapsuleIntoPersisted(target,
documentId, …)`) and *Validation order* step 8.

`importCapsuleIntoPersisted` takes an explicit `documentId` parameter **and**,
via `PersistTarget extends ReplicaTarget`, a `target.documentId`. Step 8 of the
validation order says the persisted helper compares against "`=== documentId`
(persisted helper)", but the in-memory helper compares against
"`target.documentId`". With two id surfaces on the same target the contract is
ambiguous: which wins if they disagree, and is the parameter validated against
the target at all? This is an unspecified interpretation gap on the
identity-gating path (REQ-CAP-003, the spec's central safety guarantee).

**Concrete fix:** make the persisted path single-source. After adopting
HIGH-1's preferred shape (no top-level `documentId` on `PersistTarget`), state
explicitly: "the persisted helper trusts only its `documentId` parameter
(sourced by the caller from `session.identity.documentId`); it performs no
cross-check against a target field because the session exposes none." Update
step 8 to read `=== documentId` for the persisted helper and `===
target.documentId` for the replica helper, with no third source.

### MEDIUM-2 — `State` is referenced in the public API but never imported/qualified; browser-safety of the `State` import path unstated
**Where:** `design.md` → *Public API* (`PersistTarget { … getState(): State }`,
`PersistImportResult`) and *Files to create* (`src/types.ts`).

The API uses `State` (and re-exports `ApplyOutcome`) but the design never says
`State` is imported from `@ghostsync/kit` the way `ApplyOutcome` is explicitly
"re-exported from `@ghostsync/kit`". `State` is a `@ghostsync/kit` export
(`packages/kit/src/types.ts`), so this is resolvable, but the spec leaves it
implicit. More importantly, the persisted helper only ever needs `getState()` to
exist for the save-failure recoverability guarantee (REQ-CAP-009) — it does not
need to name `State` at all. Leaving the type source unstated is a missing
detail that an implementer could resolve inconsistently (e.g. redefining a local
`State`, duplicating a Kit type).

**Concrete fix:** state that `State`, `ApplyOutcome`, and any other Kit value
types used in the public surface are imported/re-exported from `@ghostsync/kit`
(never redefined locally). If `getState`'s return type is not otherwise needed,
type it as `Record<string, unknown>` is **not** acceptable under the strict/no-
`any` rule — prefer `import type { State } from "@ghostsync/kit"` and reference
it directly, mirroring how `packages/persist/src/types.ts` re-exports `State`.

### MEDIUM-3 — Save-failure claim "session's own `state` is `"error"`" is only sometimes true; recoverability wording needs tightening
**Where:** `design.md` → *Import helper semantics (REQ-CAP-009)* and the
*Error handling* table row for `flush()` rejects; `requirements.md` AC-CAP-009-2.

The design asserts that on a failed persist "the session's own `state` is
`"error"` (unsaved, recoverable — a later `flush()` retry can succeed)." Against
the real `session.ts`, that holds for the `maxBytes` / `TransactionAbortError` /
stale-generation / write-failure paths (all route through `#failSave` →
`#setState("error")`). But `flush()` also rejects with a `ClosedError`
`PersistenceError` when the session is already `closed`/`recovery` (see
`flush()` early-return `Promise.reject(... "ClosedError" ...)`), in which case
the state is **not** `"error"` and the data may not be recoverable in the sense
implied (a `dispose()` has discarded it). The blanket "state is `error` and
recoverable" claim is therefore not universally correct and would mislead the
`capsule-persistence.spec.ts` assertions.

**Concrete fix:** scope the guarantee to the armed-failure case the test
actually exercises (`armWriteAbortOnce` → genuine `TransactionAbortError` on an
**open** session): "when `flush()` rejects on an open session, `applied` is
true, `persisted` is false, `saveError` carries the typed `PersistenceError`,
the in-memory data remains readable via `getState()`, and the session is
`"error"` (recoverable by a later retry)." Add a separate sentence that a
`ClosedError` from flush on an already-terminated session is a programmer-error
path, out of scope for the recoverable-save guarantee. Align AC-CAP-009-2 to the
open-session abort case (it already names `armWriteAbortOnce` indirectly via the
Chromium spec — make it explicit).

### NIT-1 — `encodeCapsule` does not surface `kind` and silently assumes `"full"`
**Where:** `design.md` → *Public API* (`EncodeCapsuleInput`), *Edge cases*
(zero-length update), and the metadata (no `kind` field).

`Replica.exportState()` returns `TransportUpdate` with `kind: "full" | "diff"`.
`encodeCapsule` takes a bare `update: Uint8Array` and the format stores no
`kind`, hard-committing format v1 to full-state. That is the intended scope
(diffs deferred), but nothing validates that the caller passed **full** bytes
rather than diff bytes — a diff fed to a fresh replica will be accepted or
rejected unpredictably by Yjs. This is a latent misuse gap, not a blocker.

**Concrete fix:** document in `encodeCapsule` that `update` MUST be
`exportState().bytes` (`kind: "full"`), and (optionally) accept the
`TransportUpdate` and assert `kind === "full"` at the boundary, throwing
`TypeError` otherwise. State the rule even if you keep the `Uint8Array` input.

### NIT-2 — `createdAt` validation admits non-canonical/non-ISO strings
**Where:** `design.md` → *Metadata JSON* (`createdAt` rule uses
`!Number.isNaN(Date.parse(createdAt))`).

`Date.parse` accepts many non-ISO forms (e.g. `"1/1/2026"`), so the "ISO-8601"
claim is not actually enforced by the stated rule. It is informational-only, so
low impact, but the requirement text says "ISO-8601".

**Concrete fix:** either relax the prose to "a parseable date string
(informational)" or enforce a strict ISO check (round-trip
`new Date(s).toISOString() === s` or a regex), and pick one consistently across
`requirements.md` and `design.md`.

### NIT-3 — AC-CAP-010-2 hard-codes test counts that do not match the current tree
**Where:** `requirements.md` AC-CAP-010-2 and `tasks.md` "Expected counts"
("SDK 112 tests + 8 fast-check properties; Persist 50 unit + 30 Chromium").

The repo currently has 42 Kit test **files**, 7 Persist unit test **files**, and
9 Persist e2e **spec files**; `docs/progress.md`'s verified SDK milestone records
37 Kit tests at that point. The "112 / 8 / 50 / 30" figures are case-level counts
that cannot be confirmed from the tree without running the suites, and the SDK
figure in particular post-dates the 37-test proof. Pinning exact counts the
planning step did not run risks a false regression signal.

**Concrete fix:** reword AC-CAP-010-2 to "the existing SDK, Persist unit, and
Persist Chromium suites pass unchanged, with the pass counts recorded at
implementation time equal to their pre-change baseline" — i.e. assert
*unchanged* rather than a specific number, and capture the real baseline when the
suites are first run.

### NIT-4 — Vitest include glob vs. the `merge.property.test.ts` / helper naming
**Where:** `design.md` → *Files to create* (`tests/merge.property.test.ts`) and
the Kit precedent (`tests/fc-report.ts` is deliberately NOT `*.test.ts`).

The Kit's `vitest.config.ts` collects `tests/**/*.test.ts`. The planned
`merge.property.test.ts` ends in `.test.ts` and will be collected (good), but if
the implementation adds a shared fast-check reporter helper (the Kit uses
`tests/fc-report.ts`), it must **not** be named `*.test.ts` or it becomes an
empty collected suite. The spec lists the test files but does not note this
convention.

**Concrete fix:** add a one-line note in `tasks.md` 5.1 that any shared test
helper (e.g. a fast-check reporter) is named without the `.test.ts` suffix so the
`tests/**/*.test.ts` include does not collect it as a suite, mirroring the Kit's
`tests/fc-report.ts`.

---

## Verified Assumptions (checked against real source)

1. **Kit `TransportUpdate` / `ApplyOutcome` / `Replica` signatures** — match
   `packages/kit/src/types.ts` exactly: `TransportUpdate { documentId; kind:
   "full"|"diff"; bytes }`; `ApplyOutcome` reasons `documentIdMismatch` |
   `invalidCarrier` | `malformedUpdate`; `Replica.exportState(): TransportUpdate`
   (`kind: "full"`), `applyUpdate(carrier: unknown): ApplyOutcome`,
   `documentId: string`, `getState(): State`. **Correct.**
2. **Kit `applyUpdate` no-mutation-on-reject** — `packages/kit/src/replica.ts`:
   `invalidCarrier`/`documentIdMismatch` return before any decode; on a throw it
   rebuilds the doc from a pre-apply `Y.encodeStateAsUpdate` snapshot and returns
   `malformedUpdate`. The design's REQ-CAP-008 reasoning is **accurate.**
3. **Zero-length update → `invalidCarrier`** — `isValidCarrier` requires
   `bytes.length > 0`; the design's edge-case claim (`M === 0` →
   `invalidCarrier` → `SdkRejection`) is **correct.**
4. **`SchemaIdentity { app; schemaVersion; entityType }`** —
   `packages/kit/src/adapter.ts`; the capsule's single top-level `app` string
   maps to `SchemaIdentity.app` and does not duplicate the per-collection schema
   meta. **Correct, and honors the "no competing schema system" constraint.**
5. **`PersistSession` surface** — `applyUpdate(carrier): ApplyOutcome` marks
   dirty only on `ok`; `flush(): Promise<void>` resolves on durable
   `oncomplete`, rejects a `PersistenceError`; `getState()`, `exportBytes()`,
   `state: SaveState ("dirty"|"saving"|"saved"|"error")`,
   `identity: ResolvedIdentity`. All match `packages/persist/src/{session,types}.ts`.
   **Correct** — except the top-level `documentId` the design's `PersistTarget`
   assumes (see HIGH-1).
6. **`PersistenceError.code` union** — `packages/persist/src/errors.ts` includes
   `QuotaExceededError`, `TransactionAbortError`, `CloseFailedError`,
   `ClosedError`, `InvalidRecordError`, `StorageInUseError` (as
   `StorageUnavailableError`/`StorageInUseError`), etc. The codes the design
   names for the save-failure path exist. **Correct.**
7. **`sha256Hex` + `.slice()` discipline & `DEFAULT_MAX_BYTES = 8 MiB`** —
   `packages/persist/src/record.ts`: `crypto.subtle.digest("SHA-256", bytes.slice())`
   → lowercase hex; `DEFAULT_MAX_BYTES = 8 * 1024 * 1024`. The design's
   8 MiB decoded-cap alignment and copy-before-digest practice are **accurate.**
8. **Harness `armWriteAbortOnce` + `asError` + `window.__gs`** —
   `packages/persist/harness/harness.ts`: a one-shot real IndexedDB abort hook,
   an `asError` helper stringifying `PersistenceError.code`, and the `window.__gs`
   surface all exist as the design describes. **Correct.**
9. **`no-node-imports` static scan precedent** —
   `packages/kit/tests/no-node-imports.test.ts` scans `src/**` for `node:`
   imports/Node globals. The capsule's NFR-CAP-001 mirror is **feasible.**
10. **Package shape / pins** — `packages/kit/package.json` and
    `packages/persist/package.json` confirm `type: module`, `private`, `version
    0.0.0`, `exports`→`dist`, `files: ["dist"]`, `typescript@7.0.2`,
    `vitest@5.1.0`, `@types/node@24.19.2`, `fast-check@4.10.2`, and
    `@ghostsync/kit: workspace:*`. The planned manifest matches; no new runtime
    dependency is introduced. **Correct.**
11. **`crypto.subtle` in node vitest env** — the Kit/Persist already use
    `crypto.subtle` under the `environment: "node"` vitest config (Node 24
    exposes it globally). The capsule's node-env unit tests can compute SHA-256.
    **Correct.**

## Unverified / Wrong Assumptions

- **WRONG — `PersistSession` has a usable top-level `documentId`.** It does not;
  only `session.identity.documentId` exists. The `PersistTarget extends
  ReplicaTarget` definition is incompatible with the real session (HIGH-1).
- **UNVERIFIED — exact runtime test counts (112/8/50/30).** Not run in planning
  (correctly), but pinned as acceptance numbers; current tree shows only file
  counts (42/7/9) and a prior 37-test SDK milestone (NIT-3). Treat as
  baseline-to-capture, not as a fixed target.
- **UNVERIFIED (by design) — lockfile cleanliness after task 6.1.** The spec
  flags that adding `@ghostsync/capsule` to `packages/persist/package.json` will
  change the lockfile at implementation time; this is acknowledged, not a defect
  for the planning gate, but it is the one place the "no lockfile change" posture
  ends and should stay explicitly gated to task 6.1.

---

## Requirement → test coverage assessment

Every REQ-CAP-001..010 and NFR-CAP-001/003 maps to at least one **named** planned
test in both `requirements.md` and `tasks.md`, and the two traceability tables
agree. Coverage against the mandated scope:

| Required scope item | Requirement | Named test(s) | Covered? |
| --- | --- | --- | --- |
| 1 full-state round trip | REQ-CAP-001 | `roundtrip.test.ts` | Yes |
| 2 versioned format/ext/media/encoding/fields | REQ-CAP-002 | `format.test.ts`, `tamper.test.ts` | Yes |
| 3 app+doc identity before apply | REQ-CAP-003 | `identity.test.ts` | Yes (but see HIGH-1/MEDIUM-1 on the persisted path id source) |
| 4 SHA-256 exact covered bytes | REQ-CAP-004 | `checksum.test.ts`, `tamper.test.ts` | Yes |
| 5 size limits before expensive work | REQ-CAP-005 | `size-limits.test.ts` | Yes |
| 6 distinguishable typed errors | REQ-CAP-006 | `errors.test.ts`, `sdk-rejection.test.ts`, `tamper.test.ts` | Yes |
| 7 repeat/duplicate imports converge | REQ-CAP-007 | `converge.test.ts`, `merge.property.test.ts` | Yes |
| 8 rejected → no state change | REQ-CAP-008 | `no-mutation.test.ts` | Yes |
| 9 import success ≠ durable persistence | REQ-CAP-009 | `capsule-persistence.spec.ts` (Chromium) | Yes (assertion wording needs MEDIUM-3 tightening) |
| 10 harness-only controls | REQ-CAP-010 | `capsule-transfer.spec.ts` (Chromium) + unchanged suites | Yes |
| NFR browser-safe src | NFR-CAP-001 | `no-node-imports.test.ts` + typecheck | Yes |
| NFR buffer ownership | NFR-CAP-003 | `buffer-ownership.test.ts` | Yes |

The testing-rule mandate is honored at the plan level: convergence, duplicate-
import idempotency, out-of-order/order-independent merge (property tests), persistence-
after-reload (`capsule-transfer`/`capsule-persistence`), invalid-capsule rejection
(every error category), and distinct browser profiles for the two-context transfer
are all named. Property-based merge invariants (commutativity/associativity/
idempotency against a Kit reference, seed 424242 / 200 runs) are specified. No
scope creep beyond the ten items was found: no CRDT/persistence reimplementation,
no duplicate SchemaIdentity, no new runtime dependency, no QR/encryption/
compression/network, and the integrity-not-authenticity + "size limits don't stop
CPU/memory attacks" caveats are stated plainly.

**Bottom line:** coverage is complete and well-mapped; the blocking issue is the
`PersistTarget` type incompatibility (HIGH-1) plus the related identity-source
ambiguity and save-failure-state over-claim (MEDIUM-1/2/3), which affect the
REQ-CAP-003 and REQ-CAP-009 contracts the persisted path depends on.
