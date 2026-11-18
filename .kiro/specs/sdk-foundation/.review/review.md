# sdk-foundation — final implementation review

Branch: `feat/sdk-foundation` · Baseline: `ab37419` · Scope: the local diff/untracked set under
`packages/kit/src`, `packages/kit/tests` (incl. `tests/fixtures`), `.kiro/specs/sdk-foundation`, and
`docs/progress.md`. Verification evidence read from `docs/progress.md` (not re-run, per instructions).

## Verdict

**APPROVED.** The two-map architecture, all stated deliverables, and all six clarifications are
genuinely implemented and covered by real, strong tests; the recorded verification is green
(typecheck/test/build/smoke all exit 0; 39 files / 102 tests, 0 failed; 8 properties PASS at seed
424242 / 200 runs). No blocking correctness, security, or data finding was established.

## What was verified against source and recorded evidence

### Architecture (two maps, one Y.Doc)
- Legacy `set/get/has/delete` operate directly on `doc.getMap("root")`; `getState()` reuses
  `project(root)` with no filtering/escaping/reservation (`src/replica.ts`). Confirmed by
  `two-map-layout.test.ts` and `key-escaping.test.ts` collision tests 1/2 (a legacy key byte-identical
  to a structured field key, and a sentinel-prefixed legacy key, both behave as ordinary root keys).
- Structured fields live only in `doc.getMap("ghostsync:records:v1")` as flat composite keys; no nested
  per-entity `Y.Map` and no `__default__` map. `two-map-layout.test.ts` decodes the exported bytes and
  asserts every records-map value is a scalar (no `Y.AbstractType`), proving defect-A avoidance.
- Both maps ride one `Y.Doc`, so full and differential exports carry both (full + diff path tests).

### Clarification 1 — collection addressing
`collectionId(app, entityType) = esc(app) + SEP + esc(entityType)` via the NUL-introducer escape
(`src/keys.ts`); distinct tuples cannot collide (e.g. `("a","b.c")` vs `("a.b","c")`), asserted in
`key-escaping.test.ts`. `schemaVersion` stays in the persisted meta key, not the namespace
(`collectionId` excludes it). Runtime validation via `assertSchemaIdentity` (`adapter.test.ts`). The
same entity id across two distinct collections does not mix fields (`key-escaping.test.ts`).

### Clarification 2 — pending updates / dependency regression
The false "loss acceptable" claim is removed from all three docs. `malformed-update.test.ts` delivers a
later diff (u2) before its prerequisites (u0,u1), performs an intervening successful apply, then
delivers the prerequisites, and asserts convergence with every expected edit preserved; plus
delete-before-insert and snapshot/restore. Fresh `Y.Doc` ⇒ fresh clientID, never copied
(`identity.test.ts`).

### Clarification 3 — staging / lifecycle (see note below)
On failure the committed doc is rebuilt from a pre-apply snapshot and the partial doc destroyed; on
success subscriptions and `Collection` handles survive via lazy `CollectionHost` lookup; a subscriber
throw never turns a successful apply into a rejection; reads/writes/notifications/sync continue after
both a successful apply and a rejected apply (`malformed-update.test.ts`, `notifications.test.ts`). The
change observer is detached during the direct apply, so no mid-throw partial state is ever dispatched.

### Clarification 4 — typed reads
`get`/`getResult`/`list` run `fromFields` + `validate`; an incomplete/invalid record is a controlled
outcome (`getResult → {ok:false, reason:"invalidRecord", fields}`; `get` throws `IncompleteRecordError`;
`list` skips) with the underlying fields preserved, no casts manufacturing fields
(`incomplete-record.test.ts`).

### Clarification 5 — schema recheck after import
`#assertSchemaCompatible()` runs on every collection op (open + each mutation), so a conflicting
schemaVersion arriving via `applyUpdate` after a handle exists is caught deterministically with no
silent mixing (`schema-identity.test.ts`, incl. the after-handle conflict case).

### Clarification 6 — changed-fields put
`put` validates and computes the full write/delete set before any mutation, then in one transaction
writes only changed leaf keys, deletes omitted-field keys, and leaves unchanged fields untouched
(`collection.ts`). Shared-baseline A-field/B-field survival shown by `put-changed-fields.test.ts`
(A changes title, B changes severity; both survive) and `concurrent-create.structured.test.ts`. Stale
comparison is against current local state and documented as not stale-safe.

### Cross-cutting acceptance checks
- Original 14 baseline test files UNCHANGED: `git diff --name-only HEAD -- packages/kit/tests` is empty;
  the 15 tracked files (14 `*.test.ts` + `fc-report.ts`) are untouched; new suites are untracked.
- Baseline fixture (`tests/fixtures/baseline-ab37419.ts`) carries a provenance note describing an
  isolated `git worktree` build at `ab37419`; `baseline-fixture.test.ts` restores the real bytes and
  asserts the flat projection round-trips. The documented method (separate worktree, not fabricated by
  the new build) is consistent with the recorded evidence.
- `tests/fc-report.ts` reused; both new properties call `reportRun`, use bounded generators, assert
  `numRuns === 200`, and rely on the global `seed: 424242` (`vitest.setup.ts` unchanged).
- No `.skip/.todo/.only` (grep clean) and no weakened assertions observed.
- `src` changes are additive (`index.ts`, `types.ts` diffs); `exportState` narrowing to `TransportUpdate`
  is documented and structurally compatible (`transport-contract.test.ts`).
- No dependency/manifest/lockfile/tsconfig/vitest/steering/app changes (status + diff). No
  IndexedDB/service-worker/capsule/QR/UI/deployment code. No commit/push/reset; `.agents/` untracked and
  preserved.
- Both adapter fixtures (FieldLedger incident + PatchBoard card) go through the same public SDK
  (`fieldledger-adapter.test.ts`, `patchboard-adapter.test.ts`).

## Non-blocking observation (not a finding)

The task names the apply mechanism "staged apply committed by document swap," and clarification 3 says
"on success swap." The implementation instead uses **direct-apply-to-live-doc + snapshot-rollback-on-
throw**, an explicitly documented performance trade-off (the heavier staging-copy-then-swap pushed the
unmodified baseline property suites past their 5s timeout). The authoritative, detailed sections of
`design.md` ("Guarded live merge and recovery", "Implementation note (U6)", boundary step 4) and
`tasks.md` 7.3 accurately describe and disclaim this, and the observable guarantees required by
clarification 3 (no spurious seed notification, committed doc untouched on failure, discarded docs
destroyed, lazy-resolved handles/subscriptions survive, subscriber-throw isolation, continued operation
after success and rejection) are all met and tested. Residual summary/header labels in `design.md`
(e.g. "snapshot-and-swap", "staging-and-swap-recovery") and `tasks.md` (T7 header, summary bullets) still
read "swap/staging-and-swap," which is stale shorthand that contradicts the reconciled detail. This is a
documentation-hygiene inconsistency only — the substantive doc content and the code agree, no behavior is
misrepresented, and no correctness/data/security consequence follows — so it is recorded here rather than
filed as a blocker.

## Recorded verification (read, not re-run)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | no dependency/lockfile change |
| `pnpm -F @ghostsync/kit typecheck` | 0 | strict typecheck clean |
| `pnpm -F @ghostsync/kit test` | 0 | 39 files / 102 tests, 0 failed |
| `pnpm -F @ghostsync/kit build` | 0 | dist src-only, no test files |
| `git diff --check` | 0 | clean |
| `git status --short --branch` | 0 | baseline tests unchanged; `.agents/` preserved; nothing committed |
| built-entry smoke | 0 | SMOKE PASS (both adapters, legacy/structured isolation, 2-way diff sync, origins) |

8 properties (6 baseline + 2 new) PASS at seed 424242 / 200 runs / 0 skips / 0 shrinks.
