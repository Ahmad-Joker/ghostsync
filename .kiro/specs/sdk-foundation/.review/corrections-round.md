# sdk-foundation — corrections-round review

Scope: the three independent-review corrections applied to the implemented GhostSync Kit, verified
against the permitted-file diff and the implementer's recorded evidence (`docs/progress.md`, section
"sdk-foundation — independent-review corrections round"). Verification evidence was read, not re-run
in full; a narrow spot-check was performed on the three new test files and typecheck.

## Verdict

**APPROVED.** All three corrections are genuinely implemented as specified, every schema path is
rechecked, the recovery regression carries its required control assertion, the permitted-file
constraints hold, and the recorded verification is green. No blocking finding was established.

## Correction 1 — schema recheck on every public Collection operation

- `packages/kit/src/collection.ts`: `put`, `get`, `getResult`, `list`, `listResults`, `delete`, `has`
  each call `#assertSchemaCompatible()` BEFORE any work (collection.ts lines for each method; the guard
  is at the top of every method body). `get` delegates to `getResult` which rechecks; `list` rechecks
  itself and each per-id `getResult` rechecks.
- A mismatch raises the documented schema-mismatch `Error` (`/schema mismatch/`), never degraded to an
  `absent`/`undefined` result or an `invalidRecord` outcome. Confirmed in source (no catch converts the
  guard throw) and in `schema-recheck-all-ops.test.ts` (every op asserted `toThrow(/schema mismatch/)`).
- `delete` rechecks before any key scan or transaction, so an incompatible handle neither mutates nor
  notifies — asserted in `schema-recheck-all-ops.test.ts` ("delete through an incompatible handle
  neither mutates nor notifies": zero notifications via a live subscriber, record unchanged via a
  compatible v2 handle).
- Parsed meta is validated before comparison: `#assertSchemaCompatible()` guards `typeof stored !==
  "string"`, wraps `JSON.parse` in try/catch, then runs `assertSchemaIdentity(parsed)` (adapter.ts
  rejects null, non-object, missing/non-string `app`/`entityType`, non-integer/negative
  `schemaVersion`) before `schemaIdentityEqual`. Corrupt meta yields a controlled schema error, not a
  crash — covered by the `null` meta and the non-string `42` meta cases in the test.
- Determinism: the v2 (and corrupt) meta is written as a CAUSAL SUCCESSOR of v1 (raw source doc seeded
  from v1 state, then overwrites the meta key, delivered back), so the converged winner is v2 with no
  concurrent LWW coin-flip. The test asserts every v1-handle op rejects and a fresh v2 handle works.

## Correction 2 — listResults exposes invalid records

- `Collection<T>.listResults(): ReadonlyArray<readonly [string, GetResult<T>]>` added in collection.ts,
  enumerating every stored entity id via `#entityIds()` and returning `getResult(id)` for each. It never
  deletes, repairs, or fabricates fields (getResult preserves `invalidRecord.fields` verbatim) and uses
  the existing `GetResult<T>` shape — no new result type invented.
- `list()` keeps its valid-record-only behavior (pushes only `result.ok` entities).
- Schema recheck applies to `listResults` (guard at method top).
- `Collection` (with `listResults`) and `GetResult` are public via `index.ts` `export type`; no
  `index.ts` change was required, matching the report.
- Documented in `design.md` (interface + doc comment at the `listResults` signature; discovery guidance)
  and the collection.ts doc comment.
- `list-results.test.ts` covers a valid + an incomplete record together (list() returns only the valid
  one; the invalid record's preserved fields asserted and shown un-deleted), and the same after
  synchronization (concurrent field deletion vs different-field edit converges to an `invalidRecord` on
  both replicas with matching surviving fields), plus the empty case.

## Correction 3 — real partial-mutation recovery regression

- `partial-mutation-recovery.test.ts` first asserts the CONTROL on raw `Y.Doc`s: `root["injected"]="bad"`,
  `Y.encodeStateAsUpdate`, `slice(0,-1)`; applying to a fresh raw doc throws AND leaves
  `root["injected"] === "bad"` present — proving real partial mutation past a struct, not an early
  decode no-op.
- The same bytes through the SDK `applyUpdate` on a populated replica assert `{ok:false,
  reason:"malformedUpdate"}`, legacy state deep-equal preserved, structured list deep-equal preserved,
  `injected` absent (`has`/`getState`), zero notifications, surviving collection handle and subscriber,
  subsequent local edits notifying, and differential sync converging with a peer (both legacy and
  structured, `injected` absent on the peer).
- A pending dependent diff (u1 delivered before its prerequisite u0) survives an intervening rejected
  malformed apply and integrates on prerequisite delivery, converging to the source's final entity.
- Every temporary raw doc and replica is destroyed in `finally` blocks. No production API was added to
  inject failures — the failure is driven solely by crafted bytes through the public `applyUpdate`
  boundary. The recovery path in `replica.ts` (snapshot, detach observer, direct apply under try/catch,
  rebuild-from-snapshot + destroy old doc on throw) matches the documented direct-apply/snapshot-rollback
  strategy and supports the state-preservation and zero-notification assertions.

## Constraints

- Only `packages/kit/src/collection.ts` changed in `src` this round (file mtime 01:28 vs the
  implementation-round files at 00:2x–01:00); `index.ts` correctly unchanged (GetResult/Collection
  already exported). `replica.ts`/`types.ts` modifications predate this round (prior, already-APPROVED
  implementation milestone) and carry no correction edits.
- Three new test files added (`schema-recheck-all-ops`, `list-results`, `partial-mutation-recovery`,
  mtimes 01:34–01:35); no existing/baseline test file modified.
- No `.skip`/`.todo`/`.only` and no timeout/testTimeout changes in the kit (grep clean). No new
  dependency, manifest, lockfile, tooling, steering, or app change. Nothing committed/pushed/reset;
  branch `feat/sdk-foundation`, `.agents/` preserved untracked.
- Docs truthfully state the recheck is ADDED to the read/enumeration/delete paths (design.md explicitly:
  "`get`/`getResult`/`list`/`delete`/`has` did NOT recheck … This correction ADDS the recheck …"), keep
  the direct-apply/snapshot-recovery description accurate, and do not erase the prior APPROVED verdict or
  earlier findings (`.review/review.json` + `review.md` left intact; progress.md history preserved).

## Verification (recorded, plus narrow spot-check)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm -F @ghostsync/kit typecheck` (recorded) | 0 | strict typecheck clean |
| `pnpm -F @ghostsync/kit test` (recorded) | 0 | 42 files / 112 tests, 0 failed (was 39/102; +10) |
| `pnpm -F @ghostsync/kit build` (recorded) | 0 | dist src-only |
| `git diff --check` (recorded) | 0 | clean |
| `git status --short --branch` (recorded) | 0 | only permitted files; nothing committed |
| spot-check: `vitest run` the 3 new files | 0 | 3 files / 10 tests passed |
| spot-check: `tsc --noEmit -p tsconfig.json` | 0 | clean |

All 8 fast-check properties recorded PASS at seed 424242 / 200 runs / 0 skips / 0 shrinks (no new
property added). The +10 test delta matches the three new files (4 + 3 + 3).

No blockers.
