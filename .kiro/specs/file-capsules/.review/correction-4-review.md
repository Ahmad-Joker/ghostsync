# Correction-4 review: file-capsules specification

Reviewer: independent design-review subagent. Planning-only: no spec, package, manifest or progress file was modified; nothing installed, built, tested, staged or committed. No planned test has been executed.

Prior findings re-checked: `correction-3-verdict.json` (F1-F4 MEDIUM, F5-F7 NIT).

## Prior findings: status

| Prior | Status | Evidence |
| --- | --- | --- |
| F1 BOM / ignoreBOM | Closed | Decoder is `TextDecoder("utf-8",{fatal:true,ignoreBOM:true})` in requirements (REQ-002 text, AC-CAP-004-3), design (token-scan step 1, validation step 4, error table) and tasks 2.3. WHATWG semantics are stated correctly (`true` keeps U+FEFF, `false` strips). Leading `EF BB BF` is `Malformed` before the token scan and before hashing. Named tests "BOM-prefixed metadata is Malformed" and "Unicode content before sha256 keeps byte offsets correct (round trip verifies)" exist in tasks and the traceability tables. The only remaining mentions of `ignoreBOM: false` are explicit "superseded" notes. |
| F2 real structural check | Closed | Task 6.2 passes the harness's `session(handle)` (declared `PersistSession`) to `importCapsuleIntoPersisted` and binds `const target: PersistTarget = session(handle)`, with no cast. Verified: persist `typecheck` is `tsc --noEmit -p tsconfig.json`; `include` has `harness/**/*.ts`; `paths` maps only `@ghostsync/persist`; `tsconfig.build.json` excludes `harness`. Real `PersistSession` has `identity: ResolvedIdentity {app, documentId, replicaId}`, `applyUpdate(carrier: unknown): ApplyOutcome`, `flush(): Promise<void>` and `getState(): State`, which satisfy `PersistTarget`. The verification list orders kit build, capsule typecheck/test/build, persist typecheck, persist test, persist build, build:harness, test:browser. Script names match the real kit and persist package.json files. `packages/persist/node_modules/@ghostsync` holds only `kit` today and `pnpm-workspace.yaml` globs `packages/*`, so the stated graph and lockfile consequences are accurate. |
| F3 encode identity | Closed | Design `EncodeCapsuleInput` comment, per-function table, requirements AC-CAP-002-5 and AC-CAP-006-4 and tasks 3.1/5.1 all require `kind === "full"` and `update.documentId === input.documentId`, else `TypeError` before hashing and before any await. Raw `Uint8Array` identity is the caller's responsibility. Three named tests are listed. |
| F4 merged-size test | Closed | `OpenOptions.maxBytes?: number` confirmed in `src/types.ts`. The harness `open(handle, options: OpenOptions)` forwards options to `openReplica`; `errors-lifecycle.spec.ts` already opens with `maxBytes: 4`. The error text `GhostSync Persist: snapshot exceeds maxBytes (N > M)` with code `QuotaExceededError` is confirmed in `session.ts` `#saveOnce`. `exportHex` uses `exportBytes()` = `exportState().bytes`. The existing e2e already shows a repeated oversized flush returning `QuotaExceededError` with the value still readable. The test is unconditional and no "if the harness can open" text remains outside the "superseded" notes. |
| F5 version byte | Closed | `1` ok, `0` Malformed, `2..255` UnsupportedVersion; header 1 with `metadata.formatVersion !== 1` is Malformed. This appears in requirements AC-CAP-002-6, design validation steps 2 and 4, the error table and the config table, and tasks 2.2/2.3 with `version.test.ts`. |
| F6 digest failure | Closed | `CryptoUnavailable` is in the design union with a comment, in the requirements union, in tasks 2.1, in the per-function table, the rule section, the error table and AC-CAP-006-6, with `crypto-unavailable.test.ts`. `cause` is preserved. Encode's only `CapsuleError` is `CryptoUnavailable`. |
| F7 ordering | Closed | 10, 10a, 10b, 11 now run in order. No IDs were renumbered. |

## Unchanged invariants (checked)

- Persisted identity ownership: no expected-app argument on `importCapsuleIntoPersisted`; app and documentId come from `target.identity`. The replica helper keeps `expected.app`.
- Snapshot before first await, strict parsing, duplicate-key rejection, and checksum coverage (offsets 7..end with the 64-byte span as zeros) are all intact.
- `git diff --check` exits 0 with only the CRLF warning for `docs/progress.md`. `git diff --stat` shows `docs/progress.md | 240 +` with insertions only. `git status --short --branch` shows `## feat/file-capsules`, ` M docs/progress.md`, and untracked `.agents/`, `.review-artifacts/`, `.kiro/specs/file-capsules/`. Earlier `.review/` artifacts (`review.md`, `re-review.md`, `correction-3-*`) are present. `packages/capsule` does not exist.

## Findings

1. **MEDIUM. AC-CAP-006-1 contradicts the TypeError / CapsuleError split.** `requirements.md` "Error contract" AC 14 (AC-CAP-006-1) says "Every rejection surfaces ... the single capsule error type ... no rejection surfaces as a bare `Error`". AC-CAP-006-4, the per-function table and this pass's new encode rule (documentId mismatch, then `TypeError`) say programmer errors reject with `TypeError`, which is not a `CapsuleError`. Read literally, 006-1 is false for encode and for every function's argument validation, and a coder could write a test that asserts it. Fix: rewrite AC-CAP-006-1 as "Every rejection caused by a well-typed but invalid capsule, identity, SDK or target condition, or by unavailable SHA-256, rejects with `CapsuleError` carrying a `code` from the documented union and never a bare `Error` or raw Yjs error. Programmer errors (wrong argument types, SharedArrayBuffer, bad opts, encode input errors) reject with `TypeError` per AC-CAP-006-4."

2. **NIT. Dangling test file `buffer-ownership.test.ts`.** `tasks.md` maps NFR-CAP-003 to `buffer-ownership.test.ts` (traceability table). `requirements.md` NFR-CAP-003 also lists it, and `design.md` lists it in the layout with no description. No task defines its content, while task 5.1 defines `snapshot-ownership.test.ts` for the same AC-CAP-NFR3-1/2. Fix: drop `buffer-ownership.test.ts` from all three documents and the design layout, or add a one-line task defining what it covers.

3. **NIT. The `2048 > M − S1` assertion is vacuous.** Because `S1 >= 0`, `2048 > 1024 − S1` always holds, so it proves nothing beyond `S1 < M`. The instruction asked for M chosen from a measured size. The fixed `M = 1024` is acceptable because `maxBytes` is fixed at open, but the test never asserts the key precondition that the merged snapshot exceeds M. Fix: replace that assertion with a post-import check `exportHex("tgt").length / 2 > 1024` (the in-memory merged state), alongside the existing `QuotaExceededError` assertion.

## Verified assumptions

- Persist `typecheck`, `build`, `build:harness`, `test:browser` and the kit `typecheck|test|build` scripts exist.
- `PersistSession` structurally satisfies `PersistTarget`.
- `OpenOptions.maxBytes` exists and the harness forwards it.
- The `session.ts` size-error message and code are as quoted.
- `packages/persist/node_modules/@ghostsync` contains only `kit`.
- WHATWG `ignoreBOM` semantics are described correctly.

## Unverified / wrong assumptions

- Not run: the Node `ignoreBOM` observation (3 characters vs 2). It matches the WHATWG definition but I did not re-execute it.
- Unverified: how Vite resolves `@ghostsync/persist` from the harness with no link in `node_modules`. The author flagged this too. The kit is imported the same way and the existing e2e works, so adding the capsule via `node_modules` is expected to behave the same.
- The new harness hooks must also be declared on the `GhostSyncApi` interface. Task 6.2 implies this but does not say so.
- Nothing was executed. Every test and command in the spec is planned.

## Verdict

CHANGES_REQUESTED: 1 MEDIUM (finding 1), 2 NIT (findings 2-3).
