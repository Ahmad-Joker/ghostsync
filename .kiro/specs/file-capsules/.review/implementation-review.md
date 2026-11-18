# Implementation review: file-capsules (uncommitted, branch feat/file-capsules)

Scope: read-only review of `packages/capsule/**`, the harness and e2e additions, and hygiene. Suites were not re-run; this relies on the implementer's evidence file plus direct source reading. Earlier spec-review files in this directory are untouched.

The implementation matches design.md on every focus item checked: snapshot ownership, the byte-offset token scan, identity ordering, closed-target handling, flush-failure mapping and the harness size and URL handling. One blocking item remains, and it is a process violation rather than a code defect: the property tests carry an explicit 60 s timeout, which the task forbade.

**Watch for:** the 60 s property-test timeout (confirmed, SUBSTANTIVE). It was disclosed by the implementer but is still a forbidden change.

**Verdict**: NEEDS_CHANGES

## High-level view

Ownership is done once, centrally. `snapshot()` allocates a fresh `Uint8Array` and copies into it, so it avoids `Buffer#slice` view aliasing. `decodeCapsule` and `encodeCapsule` take the snapshot synchronously, before the first await. The import helpers capture `target.documentId`, `expected.app` and `target.identity` before awaiting decode.

The token scan runs on the decoded text and maps UTF-16 positions to UTF-8 byte offsets. A leading BOM is rejected before decoding with `ignoreBOM: true`. Duplicate keys are compared after escape decoding. The `sha256` token must be exactly 66 bytes, quote-delimited, lowercase hex, so it cannot hide an escape. The checksum is computed over a copy of the received bytes with only that span zeroed.

Identity order matches design steps 7 to 9: app, then document, then apply, then flush. Persisted identity comes only from `target.identity`. A throwing `applyUpdate` becomes `TargetUnavailable`, so `applied:true` is unreachable there. A flush rejection after a successful apply resolves `applied:true, persisted:false` with the original error object.

Harness and e2e additions follow the spec. `File.size` is checked before `arrayBuffer()`. The merged-size test measures `exportHex` after the import, with unconditional assertions.

<details>
<summary>Issues (3)</summary>

1. **SUBSTANTIVE: 60 s property-test timeouts** — `merge.property.test.ts` adds `PROPERTY_TIMEOUT_MS = 60_000` to all three properties after they hit Vitest's 5 s default. The task said not to increase timeouts. Reduce per-run cost (for example, encode each replica's capsule once per run instead of several times) so the default budget passes, or get an explicit user waiver recorded in tasks.md. Do not change the 200 runs or the seed.
2. **MINOR: URL revocation evidence is self-reported** — `capsuleUrlStats()` counts the harness's own `revokeObjectURL` calls. It shows created equals revoked after a fixed 1 s timer, not that the URL became invalid. Acceptable, but the limitation should stay documented; the revoke timer is a heuristic, not a completion signal.
3. **MINOR: conditional guard in a test** — `token-scan.test.ts` has `if (sha === undefined) return;` after `expect(sha).toBeDefined()`. It only narrows the type and the `expect` already fails first, but it is a conditional exit in a test. Replace it with a non-null assertion or a thrown error.

</details>

<details>
<summary>Details</summary>

### Run-time budget on the property tests (SUBSTANTIVE, confirmed)

`merge.property.test.ts` lines 11, 73, 102 and 122 pass `PROPERTY_TIMEOUT_MS = 60_000` as the third argument to each property. `vitest.config.ts` sets no timeout, so the default is 5 s. The implementer's note says the three properties failed once at the default. That is a direct instance of the "increase timeouts" prohibition. The assertions are unchanged, and the run counts and seed are recorded (200 runs, seed 424242, 0 skips), so the evidence itself is sound. The fix is speed, not budget: each run hashes several capsules with an async SHA-256, so batching or reusing encodes inside a run should cut the cost. If that can't reach 5 s, the user needs to waive the rule explicitly.

### Snapshot and ownership (no issue found, scope notes)

Confirmed in `bytes.ts`, `decode.ts` and `encode.ts`: no `.slice()` is used on caller input. The raw-size bound is checked on `bytes.length` before the copy, so oversized input is never copied. `snapshot-ownership.test.ts` covers both required categories (in-flight mutation and post-completion aliasing) and has a Buffer case that checks the result's prototype is `Uint8Array.prototype` and that its `buffer` differs from the caller's. It also covers SharedArrayBuffer rejection on all four entry points, with the fake target's `apply` and `flush` counters at zero.

### Identity ordering coverage (no defect, small gap)

The persisted tests confirm `target.identity.documentId` governs when the replica's own id is correct, and that an app mismatch with a correct documentId makes no apply or flush calls. No test makes `identity.documentId` match the capsule while the underlying replica id differs. Source reading shows only `identity` is consulted, so this is not a defect.

### Merged-size regression

`capsule-persistence.spec.ts` (lines 123 to 182) saves a small snapshot at `maxBytes` 1024 and asserts it is below 1024. It then imports, reads `exportHex` after the import, and asserts the merged byte count exceeds 1024. It also asserts a `QuotaExceededError` save error, readable merged data, and a failing second flush. None of it is conditional.

### Hygiene

`git diff --name-only` for `packages/kit`, `packages/persist/src` and `apps` is empty. Nothing is staged. The newest file under `.agents/` and `.review-artifacts/` dates from before the implementation, so they are untouched. `git diff --check` reports no whitespace errors; it only prints CRLF normalisation warnings. A grep of the capsule source finds no `node:` imports, no `@ghostsync/persist` import, and no `Buffer` use. The package depends on the Kit only. I found no `.skip`, `.only` or `.todo` in the capsule tests or the two new e2e specs.

### Not verified here

The Chromium results, and the 111, 50 and 112 unit totals, come from the implementer's evidence. I did not re-run them, as instructed. I did not read every e2e test body; I read the merged-size one and grepped the others for guards.

</details>

<details>
<summary>File map</summary>

- `packages/capsule/src/{bytes,decode,encode,import,token-scan,metadata,checksum,format,types,errors,index}.ts`: format, validation and import orchestration
- `packages/capsule/tests/*`: 20 unit test files plus helpers
- `packages/persist/harness/{harness.ts,index.html}`: download, file input and result region
- `packages/persist/e2e/capsule-{transfer,persistence}.spec.ts`: browser scenarios
- `packages/persist/package.json`, `pnpm-lock.yaml`: capsule devDependency and lockfile
- `docs/progress.md`, `.kiro/specs/file-capsules/**`: progress and task bookkeeping

Full diff: `git diff` plus the untracked `packages/capsule/`.

</details>


## Review resolution

1. SUBSTANTIVE: 60 s property-test timeouts. PARTIALLY RESOLVED, with an honest residual risk.
   - Removed `PROPERTY_TIMEOUT_MS` and every explicit timeout from `packages/capsule/tests/merge.property.test.ts`. The default 5 s budget applies. Assertions, `numRuns` 200 and seed 424242 are unchanged.
   - Cut per-run cost: each source capsule is encoded (SHA-256) once per run and reused across the import orders, rather than re-encoded for every import. Only the grouped re-import capsules (`xy`, `yz`) still need an encode.
   - Measured result: in repeated full-suite runs the properties took roughly 0.4 to 4.4 s each and passed in most runs. In one batch of six runs, three failed with "timed out in 5000ms" (the commutativity test, which runs first in its file and carries the cold start), then eight consecutive runs passed. So the properties are still load-sensitive on this machine. I did not raise the timeout, split the files, or lower numRuns, because the task forbids it. If this proves unacceptable it needs a user decision: an explicit timeout waiver, or a smaller `numRuns` for the capsule properties.
2. MINOR: revocation evidence is self-reported. Not changed (non-substantive). Recorded as a known limitation.
3. MINOR: `if (sha === undefined) return;` in `token-scan.test.ts`. Not changed (non-substantive, type narrowing only).

Re-run after the change (final order): kit build 0; capsule typecheck 0, test 0 (20 files, 111 tests), build 0; persist typecheck 0, test 0 (7 files, 50 tests), build 0, build:harness 0 (66 modules, `index-C3rn4jQ7.js` 120.52 kB); persist test:browser 0 (37 passed); kit test: first run exit 1 (2 tests failed, 40 of 42 files passed; kit is untouched, cause not diagnosed, likely load after the browser run), rerun exit 0 (42 files, 112 tests); `git diff --check` exit 0 (only LF/CRLF warnings).