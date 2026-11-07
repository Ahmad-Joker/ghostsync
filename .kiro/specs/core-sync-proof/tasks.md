# core-sync-proof — Tasks

> Ordered implementation checklist for the core-sync-proof spec. Each task is linked to the requirement IDs it satisfies. Proposed PowerShell commands are listed for the final verification step.

## Status legend

Standard Markdown task checkboxes:

- `- [ ]` — pending (not started or not yet verified).
- `- [x]` — complete and verified by a real command run.

## 1. Tooling and project setup [ REQ-NFR , coding ]

- [x] 1.1 Add dependencies to `packages/kit/package.json`: runtime dep `yjs`; devDependencies `typescript`, `vitest`, `fast-check`, `@types/node`. Pin exact versions; no ranges. (coding: minimal, well-maintained deps.)
- [x] 1.2 Add scripts to `packages/kit/package.json`: `typecheck`, `test`, `build`. Make it an ESM package with `exports`, `main`, `module`, `types`, and `files: ["dist"]`.
- [x] 1.3 Create `packages/kit/tsconfig.json` — `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module/moduleResolution NodeNext`, `lib ES2022` (NO `DOM`), `types node`, `outDir dist`, `declaration true`. Create `packages/kit/tsconfig.build.json` extending it with `src`-only `include` and tests/config excluded, so published runtime output is `src`-only.
- [x] 1.4 Create `packages/kit/vitest.config.ts` — `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `setupFiles` for fast-check global config (`numRuns: 200`, `seed: 424242`). Correction 2: use fast-check's supported option names `numRuns` and `seed` (NOT `baseSeed`, NOT `verbose: 2`).
- [x] 1.5 Verify tooling with the proposed commands in step 7.

## 2. Public API and types [ REQ-001 , REQ-002 , REQ-005 , REQ-006 , coding ]

- [x] 2.1 Create `packages/kit/src/types.ts` — `Scalar`, `State`, `UpdateCarrier`, `ApplyOutcome`, `Replica`, `Kit` interfaces (as designed in `design.md`). Correction 5: `applyUpdate` accepts `unknown`.
- [x] 2.2 Create `packages/kit/src/scalars.ts` — `assertScalar(value)` runtime guard rejecting `undefined`, arrays, non-null objects, functions, symbols, `bigint`, and non-finite numbers (`NaN`, `±Infinity`) before any mutation. (Correction 5; REQ-002 scalar domain.) No Node-only imports.
- [x] 2.3 Create `packages/kit/src/state.ts` — pure `project(map): State` only. Correction 1: NO `node:util`, NO runtime `deepEqualState` helper — deep-equality is a test concern (Vitest `toEqual`). Correction 4: build a fresh null-prototype snapshot that preserves `__proto__`, `constructor`, and `toString` as OWN data properties without going through `Object.prototype` setters.
- [x] 2.4 Create `packages/kit/src/index.ts` — public re-exports only (`createKit` + public types); internals stay private.

## 3. Replica, sync, and conflict resolution [ REQ-001 , REQ-002 , REQ-003 , REQ-004 , coding ]

- [x] 3.1 Create `packages/kit/src/replica.ts` — `createReplica(documentId, seedBytes?)`: validate `documentId` (non-empty string); create fresh `Y.Doc` (fresh clientID); apply `seedBytes` via `Y.applyUpdate` when provided; store `documentId` separately from Yjs.
- [x] 3.2 Implement `Replica.set/delete/get/has` — `set` calls `assertScalar`; mutate the top-level `Y.Map("root")` only. (REQ-001, REQ-002 scalar writes, deletion path.)
- [x] 3.3 Implement `Replica.exportState` — `Y.encodeStateAsUpdate(doc)` with no state vector; return `{ documentId, bytes }`. (REQ-002-4 full-state export.)
- [x] 3.4 Implement `Replica.applyUpdate(carrier: unknown)` — Correction 3 + 5: carrier-shape validation (non-null object; nonempty-string `documentId`; `bytes instanceof Uint8Array`; `bytes.length > 0`) → `invalidCarrier` BEFORE decode (zero-length bytes rejected); then document-ID guard → `documentIdMismatch`; then `Y.applyUpdate`. Return `ApplyOutcome`, never throw for recoverable cases.
- [x] 3.5 Implement `Replica.getState` — fresh plain projection (correction 4); `Replica.destroy` — `doc.destroy()`, idempotent. Correction 5: after `destroy()`, every other operation throws `Error("replica has been destroyed")`; repeated `destroy()` is a safe no-op.

## 4. Restore lifecycle [ REQ-005 ]

- [x] 4.1 Confirm `createReplica(documentId, seedBytes)` restores full state into a fresh `Y.Doc` with fresh clientID while preserving the caller-supplied `documentId` separately. (REQ-005-1, REQ-005-3.)
- [x] 4.2 Confirm set-then-delete before export yields the deleted key absent after restore. (REQ-005-3.)

## 5. Validation and rejection behavior [ REQ-006 ]

- [x] 5.1 Implement carrier validation (non-null object; `documentId` nonempty string; `bytes` `Uint8Array`; `bytes.length > 0`) returning `{ ok:false, reason:"invalidCarrier" }` before any decode. Correction 3: zero-length bytes rejected before decode; an empty-doc full-state export is non-empty and still imports. (REQ-006-4.)
- [x] 5.2 Implement document-ID guard returning `{ ok:false, reason:"documentIdMismatch" }` before any decode; state unchanged. (REQ-006-1, REQ-006-2.)
- [x] 5.3 Add the documented invariant comment on `applyUpdate` and in the module docblock: raw Yjs bytes do not prove document identity or authenticate the sender. Correction 2: AC-006-3 is verified by a real BEHAVIORAL test (wrong-documentId rejected, state unchanged), NOT by grepping source comments. (REQ-006-3.)
- [x] 5.4 Document (do not implement) future work: hostile-byte handling, payload limits, capsule versioning, checksums — required before file/QR ingestion. (REQ-006, correction 8.)

## 6. Tests [ REQ-001 , REQ-002 , REQ-003 , REQ-004 , REQ-005 , REQ-006 , testing ]

Correction 1: all deep-equality is `expect(...).toEqual(...)` (no `node:util` in src; Node utilities allowed in tests only).

- [x] 6.1 `tests/replica.test.ts` — AC-001-1, AC-001-2, AC-001-3.
- [x] 6.2 `tests/sync.test.ts` — AC-002-1, AC-002-2, AC-002-3, AC-002-5.
- [x] 6.3 `tests/export.test.ts` — AC-002-4 plus the empty-doc export case (correction 3: export of empty `Y.Doc` is non-empty bytes and imports to `{}`).
- [x] 6.4 `tests/conflict.test.ts` — AC-003-1, AC-003-2.
- [x] 6.5 `tests/invariants.test.ts` — AC-004-1, AC-004-2, AC-004-3.
- [x] 6.6 `tests/restore.test.ts` — AC-005-1, AC-005-2, AC-005-3.
- [x] 6.7 `tests/validation.test.ts` — AC-006-1, AC-006-2, AC-006-3 (behavioral), AC-006-4 (incl. zero-length bytes). Plus `set` scalar validation (undefined/array/object/function/symbol/NaN/±Infinity throw) and nonempty-documentId enforcement in `createReplica`.
- [x] 6.8 `tests/projection.test.ts` — correction 4: `__proto__`/`constructor`/`toString` preserved as own data properties; snapshot mutation cannot mutate a replica.
- [x] 6.9 `tests/lifecycle.test.ts` — correction 5: post-`destroy()` operations throw; repeated `destroy()` is a safe no-op.
- [x] 6.10 `tests/deletion-regression.test.ts` — correction 6: A sets F="x", syncs to B; A deletes F and sends a full update; F disappears on B; restore the deleted state into C; replay the OLDER pre-deletion update into C; F remains absent (stale update does not resurrect the deletion).
- [x] 6.11 `tests/sync.property.test.ts` — REQ-002 convergence (nonempty disjoint DISTINCT-key edits). Correction 2: `fc.check` with explicit Vitest failure on `result.failed`, reporting `seed`/`numRuns`/`numSkips`/`numShrinks`/`counterexample`/`counterexamplePath`.
- [x] 6.12 `tests/conflict.property.test.ts` — AC-002-2 / AC-003-1 (two DISTINCT concurrent same-key scalars → resolved value equal on both and ∈ submitted set).
- [x] 6.13 `tests/invariants.property.test.ts` — AC-004-1 idempotency, AC-004-2 commutativity, AC-004-3 grouping; all nonempty cases, seed 424242, numRuns 200.

## 7. Final verification [ REQ-NFR , testing ]

Run from the workspace root on Windows PowerShell. Exit codes are PowerShell `$LASTEXITCODE`.

- [x] 7.1 Install through pnpm and prove the lockfile is reproducible:
  ```powershell
  pnpm.cmd install
  pnpm.cmd install --frozen-lockfile
  ```
- [x] 7.2 Typecheck (strict, no emit):
  ```powershell
  pnpm.cmd -F @ghostsync/kit typecheck
  ```
- [x] 7.3 Tests (capture pass/fail and fast-check counts):
  ```powershell
  pnpm.cmd -F @ghostsync/kit test
  ```
- [x] 7.4 Build (emit declarations to `dist/`, src-only):
  ```powershell
  pnpm.cmd -F @ghostsync/kit build
  ```
- [x] 7.5 Real smoke check importing the BUILT public entry (`dist/index.js`): two replicas, disjoint edits, exchange both ways, assert both contain both edits; destroy replicas; delete the temp script.
- [x] 7.6 Confirm the test run prints actual pass/fail counts and the configured fast-check seed/run counts (testing steering); no "should work" narrative is accepted.

## 8. Review-finding corrections (test-only) [ testing , REQ-002 , REQ-004 ]

> Independent-review follow-up. Test-only: no `src` change. All generated arrays are bounded (explicit `maxLength`); seed 424242 / 200 runs per property preserved. Verified by a real run (see `docs/progress.md`).

- [x] 8.1 Fix `sync.property.test.ts` disjointness — A writes ONLY `A::`-prefixed keys and B writes ONLY `B::`-prefixed keys, for BOTH writes and assertions, so the key sets are guaranteed disjoint even when raw keys collide. Bounded generators (`maxLength: 16`).
- [x] 8.2 Deterministic namespace case in `sync.property.test.ts` — A writes raw `B::x` and B writes raw `x`; the corrected mapping yields distinct keys (`A::B::x`, `B::x`), and the case asserts BOTH edits survive a two-way exchange with nothing colliding.
- [x] 8.3 Report ACTUAL fast-check metrics for EVERY property (pass or fail) — shared `tests/fc-report.ts` prints name + real `RunDetails` (`seed`, `numRuns`, `numSkips`, `numShrinks`, pass/fail) via `process.stdout.write`; on failure it surfaces the original error, counterexample, and replay path (seed + path) without swallowing. Applied to `sync`/`conflict`/`invariants`/`merge-invariant` property tests.
- [x] 8.4 Strengthen merge-invariant coverage — new `tests/merge-invariant.property.test.ts`: histories from TWO independent source replicas (small key space → repeated same-key writes and set-then-delete), captured update bytes delivered to FRESH receivers in (a) original order, (b) a generated permutation, (c) with duplicate deliveries, and (d) a single `Y.mergeUpdates` batch; every valid apply asserted `ok === true`; convergence asserted against a DIRECT Yjs reference `Y.Doc` projection (not only wrapper-to-wrapper); every replica and reference doc destroyed.
- [x] 8.5 Deterministic deletion regression in `merge-invariant.property.test.ts` — an older pre-deletion update delivered AFTER a newer deletion update does not resurrect the deleted key; checked against the reference doc too.
- [x] 8.6 Re-verify (install --frozen-lockfile, typecheck, test, build, `git diff --check`, `git status`) all exit 0; existing tests intact. Totals: 14 files / 37 tests passed. No `src`, app, steering, dependency, or lockfile change; nothing committed.

## Coverage check

Every acceptance criterion maps to a task above and to a concrete test named in `design.md`:

- REQ-001 (AC-001-1..3) → task 6.1 + design tests.
- REQ-002 (AC-002-1..5) → tasks 6.2, 6.3, 6.11 + design tests.
- REQ-003 (AC-003-1..2) → task 6.4, 6.12 + design tests.
- REQ-004 (AC-004-1..3) → task 6.5, 6.13 + design tests.
- REQ-005 (AC-005-1..3) → task 6.6 + design tests.
- REQ-006 (AC-006-1..4) → task 6.7 + design tests.
- Correction 3 (empty payloads) → tasks 6.3, 6.7.
- Correction 4 (safe projection) → task 6.8.
- Correction 5 (lifecycle) → tasks 6.7, 6.9.
- Correction 6 (deletion regression) → task 6.10.

No acceptance criterion is left without an implementation task and a concrete test.
