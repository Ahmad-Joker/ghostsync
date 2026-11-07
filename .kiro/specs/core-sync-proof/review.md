# Review — core-sync-proof review-finding corrections (test-only run)

Verdict: **APPROVED**

## Scope and evidence

- Reviewed `git diff` (working tree) plus the two untracked files
  `packages/kit/tests/fc-report.ts` and `packages/kit/tests/merge-invariant.property.test.ts`.
- Read `packages/kit/src/types.ts` and `packages/kit/src/replica.ts` to confirm the tests
  assert against the real public contract and that no src defect was masked by a weakened test.
- Did not re-run suites; relied on the coder's recorded results in `docs/progress.md`
  (install/typecheck/test/build/`git diff --check`/`git status` all exit 0; 14 files / 37 tests
  passed; six properties each `seed=424242 numRuns=200 numSkips=0 numShrinks=0 PASS`).

## Constraint compliance

- **src unchanged.** `git diff -- packages/kit/src/ packages/kit/package.json pnpm-lock.yaml`
  returns 0 lines. src is staged `A` from the prior milestone; this run adds no working-tree
  change to it.
- **Only permitted files changed.** Working-tree changes: `packages/kit/tests/sync.property.test.ts`,
  `conflict.property.test.ts`, `invariants.property.test.ts`, `.kiro/specs/core-sync-proof/tasks.md`,
  `docs/progress.md`; new untracked `packages/kit/tests/fc-report.ts` and
  `packages/kit/tests/merge-invariant.property.test.ts`. The `.agents/tasks/**` files are
  reviewer/plan artifacts, not production code. `vitest.setup.ts`/`vitest.config.ts` untouched.
- **Nothing committed.** HEAD remains `c78e6f7`; no new commit on the run.
- **No `.skip/.todo/.only`** anywhere under `packages/kit/tests/**`.
- **Node in-memory proof only** — no IndexedDB/capsule/QR/UI/deployment introduced.

## Correction 1 — disjoint namespaces + deterministic case

- `sync.property.test.ts` now writes A keys as `A::${key}` and B keys as `B::${key}` for BOTH the
  writes and the assertions; the old half-prefixed scheme (A unrestricted, B `B::`) is gone, so the
  key sets are guaranteed disjoint even on raw-key collision.
- Assertions check both edits on BOTH replicas after a two-way exchange.
- Deterministic case added: A writes raw `A::B::x`, B writes raw `B::x`; asserts the exact state
  `{ "A::B::x": "from-A", "B::x": "from-B" }` survives — demonstrating the mapping keeps both edits
  with nothing colliding. (The task phrasing "A writes B::x" is realized through the consistent
  `A::`-prefix mapping; the intent — distinct surviving keys from colliding-looking raw input — is met.)
- Generators bounded: `editsArb` uses `maxLength: 16`; permutation driver in the merge test uses
  `maxLength: 24`; history arrays `maxLength: 12`.

## Correction 2 — real RunDetails metrics, failures preserved

- `tests/fc-report.ts#reportRun` prints `result=PASS/FAIL seed numRuns numSkips numShrinks` for
  EVERY property via `process.stdout.write`, read from the live `RunDetails`, not constants.
- On failure it surfaces the ORIGINAL error (`errorInstance`), the `counterexample`, and the replay
  path (`seed` + `counterexamplePath`) through an injected `expect.fail`. No hardcoded success string
  replaces the failure. Applied to sync, conflict, invariants, and merge-invariant properties.
- Each property keeps `expect(result.failed).toBe(false)` and `expect(result.numRuns).toBe(200)`;
  seed 424242 / 200 runs preserved. No assertion weakened relative to the prior `reportFailure`.

## Correction 3 — strengthened BOUNDED merge-invariant property

`tests/merge-invariant.property.test.ts`:

- Histories generated from TWO independent source replicas over a 3-key space (`k0/k1/k2`), so
  repeated same-key writes and set-then-delete sequences occur; histories nonempty (`minLength: 1`).
- Full-state export carriers captured after each op (`captureUpdates`), bytes retained.
- FRESH receivers built for each delivery mode: (a) original order, (b) generated permutation,
  (c) duplicate deliveries (each carrier applied twice), (d) single `Y.mergeUpdates` batch.
- Every apply asserted `outcome.ok === true` for well-formed same-document carriers.
- Convergence asserted against a DIRECT Yjs reference `Y.Doc` (`projectRef`) that received those
  exact bytes — all four receivers `toEqual` the reference projection, not only wrapper-to-wrapper.
- Confirmed against src: `applyUpdate` returns `{ ok: true }`, `exportState()` yields an
  `UpdateCarrier`, and the merged branch's `{ documentId: DOC, bytes }` matches the carrier shape.
- Deterministic deletion regression: an older pre-deletion full-state delivered AFTER the newer
  deletion does NOT resurrect `F`; checked against the reference doc too; result exact `{}`.
- Resource cleanup: all four receivers plus the source replica and every reference `Y.Doc` are
  destroyed in `finally`.

## src defect check

No src defect surfaced. All receivers converge to the direct Yjs reference projection, so no
weakened test is masking a behavioral gap. No src edit present to silently fix one.

## Findings

None. All required corrections present, constraints honored, recorded verification complete.
