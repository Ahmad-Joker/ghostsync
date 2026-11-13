# file-capsules — Correction 3 review

Verdict: **CHANGES_REQUESTED** (4 MEDIUM, 0 HIGH, 3 NIT). Planning-only review; nothing was installed, built, run, staged or committed. No planned test was executed.

Reviewed: `requirements.md`, `design.md`, `tasks.md`, `.review/*` (preserved, untouched), `packages/kit/src/*`, `packages/persist/src/{types,identity,session,record}.ts`, `packages/persist/{package.json,tsconfig.json,harness/harness.ts}`, `packages/kit/package.json`, `pnpm-workspace.yaml`.

## Group check (the five correction groups)

1. **Persisted identity — applied consistently.** `importCapsuleIntoPersisted(target, bytes, opts?)` has no expected-app argument in the Public API, the async table, validation steps 7-8, Browser integration, error table, harness (task 6.2), tasks 4.3 and requirements REQ-CAP-003 / AC-CAP-003-3/4. The replica helper keeps `expected.app`. The regression "persisted import rejects correct documentId with another app before apply and flush" is named in all three docs (AC-CAP-003-4, task 5.1, mapping tables) and is PLANNED.
2. **Dependency/type resolution — applied.** No import or re-export of `ResolvedIdentity`; remaining mentions are documentation of the real Persist type and supersession notes. `PersistTarget.identity = { readonly app: string; readonly documentId: string }`. Verified against source: `PersistSession.identity: ResolvedIdentity {app, documentId, replicaId}`, `applyUpdate(carrier: unknown): ApplyOutcome`, `flush(): Promise<void>`, `getState(): State` — so assignment compiles unchanged. `State/ApplyOutcome/TransportUpdate` come from Kit. Graph `kit <- capsule`, `persist(devDep, harness) -> capsule`, no `capsule -> persist` edge; `persist -> kit` already exists, so acyclic. Lockfile procedure `pnpm.cmd install` then `--frozen-lockfile` present (task 7.0, NFR-CAP-002); no live "no lockfile change" claim. Gap in how the satisfaction check is actually run: see F2.
3. **Byte-exact parsing — applied, with one factual defect** (F1, BOM). Token scan, decoded names, byte-offset spans, duplicate decoded keys, 64 literal lowercase hex without escapes, regex/reserialization forbidden, checksum over 7..end with 64-byte span zeroed, and the five named test families are all present and consistent.
4. **Async snapshot ownership — applied.** Copy after raw-size check and before the first `await`; parse/hash/return/apply from the snapshot; encode captures before awaiting; SharedArrayBuffer is a `TypeError`; `snapshot-ownership.test.ts` planned for encode, decode and both imports; Buffer-ownership section updated.
5. **Merge/results/errors — applied, with one test-plan ambiguity** (F4). (a) fresh and populated empty-source tests; (b) merged size over limit is `persisted:false` (verified: `session.ts` `#saveOnce` checks `captured.length > #maxBytes` and raises `QuotaExceededError` via `#failSave`); (c) `applied: true` everywhere, `ok: true` only as Kit `ApplyOutcome`; (d) per-function TypeError/CapsuleError table; (e) flipped-byte claim scoped; (f) closed-before-apply: verified `PersistSession.applyUpdate` calls `#assertMutable()` which throws `ClosedError` synchronously for `closed` and `recovery` phases, so `TargetUnavailable` is correct and `flush` is not called.

## Findings

### F1 — MEDIUM — Wrong `TextDecoder` BOM claim breaks the byte-offset guarantee
Where: `design.md` > Metadata token scan, step 1 ("`ignoreBOM: false`, so a BOM is not silently stripped and shifts no offsets").
Problem: this is backwards. In the WHATWG API `ignoreBOM: false` (the default) *strips* a leading BOM from the output; `ignoreBOM: true` keeps it. I confirmed in Node: a 5-byte input `EF BB BF 7B 7D` decodes to 2 characters with `ignoreBOM:false` and 3 with `ignoreBOM:true`. As specified, a metadata region that starts with a BOM would be accepted by the scan and `JSON.parse`, but every UTF-16-to-UTF-8 mapped offset would be 3 bytes short, so the zeroed span would land on the wrong bytes. That is the exact offset-shift defect group 3 exists to prevent, and there is no planned test for it.
Fix: specify `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` and state that a leading U+FEFF makes the text not a JSON object, so the scan rejects it as `Malformed` (JSON grammar has no BOM). Alternatively scan the byte array directly. Add "metadata beginning with a UTF-8 BOM => Malformed" to `token-scan.test.ts` and AC-CAP-004-3. Correct the sentence in `design.md`.

### F2 — MEDIUM — The only check for AC-CAP-003-5 is not in the verification commands
Where: `tasks.md` > "Exact future verification commands", task 6.2, task 7.1; `requirements.md` AC-CAP-003-5.
Problem: AC-CAP-003-5 and the "real `PersistSession` satisfies `PersistTarget` unchanged" claim rest entirely on the Persist typecheck of `harness/harness.ts`. The command list runs `-F @ghostsync/persist build:harness` (a Vite build, which does not typecheck), `test:browser` and `test`, but never `pnpm.cmd -F @ghostsync/persist typecheck`. `packages/persist/tsconfig.json` includes `harness/**/*.ts` and maps only `@ghostsync/persist` in `paths`, so `@ghostsync/capsule` resolves through `node_modules` to `dist/index.d.ts`; typecheck therefore also requires the capsule build to have run first. Neither the command nor that ordering is stated.
Fix: add to the command list, after `-F @ghostsync/capsule build`: `pnpm.cmd -F @ghostsync/persist typecheck`, and add to task 7.1 "persist typecheck must pass; it is the evidence for AC-CAP-003-5". Note in task 6.2 that the harness must `import type { PersistTarget } from "@ghostsync/capsule"`.

### F3 — MEDIUM — `encodeCapsule` has two document-id sources and no rule relating them
Where: `design.md` > Public API `EncodeCapsuleInput`, Validation rules for `update (encode)`; tasks 3.1.
Problem: `input.documentId` and, when `update` is a `TransportUpdate`, `update.documentId` (a real field per Kit `types.ts`) can disagree. Neither the validation rules nor the TypeError table says which wins or that a mismatch is rejected. Silently labelling one document's bytes with another id is the confusion the identity work removes elsewhere; it would be caught only later at the importing end.
Fix: add the rule "when `update` is a `TransportUpdate`, `update.documentId` MUST equal `input.documentId`, else `TypeError` before hashing", add it to the `encodeCapsule` row of the TypeError table, and add a case to `encode-kind.test.ts` (rename the AC mapping or add it to AC-CAP-002-3).

### F4 — MEDIUM — AC-CAP-009-3 real-Persist coverage is conditional and not achievable with the planned harness
Where: `tasks.md` mapping row AC-CAP-009-3 ("`capsule-persistence.spec.ts` **if** the harness can open with a small `maxBytes`"); task 6.4; `requirements.md` traceability for REQ-CAP-009.
Problem: the existing harness exposes no `maxBytes` option (no match in `harness/harness.ts`), and the planned harness changes (task 6.2) do not add one. So the Chromium test is unspecified, and the unit test with a fake `flush` only proves the capsule passes a rejection through, not that a real merged snapshot over `maxBytes` yields `QuotaExceededError`. An "if" in an acceptance mapping leaves the coder to decide whether the criterion is verified.
Fix: pick one. Either (a) add to task 6.2 an optional `maxBytes` passthrough on the harness open call and make task 6.4 include a mandatory case "merged snapshot above a small `maxBytes` => `applied:true, persisted:false`, `saveError.code === "QuotaExceededError"`, session `state === "error"`, data readable"; or (b) state in AC-CAP-009-3 that it is verified at unit level with a fake only, and drop the Chromium mention. Remove the conditional wording either way.

### F5 — NIT — Version byte values below 1 are unspecified
Where: `design.md` Validation order step 2 ("`> 1` -> UnsupportedVersion; some other unexpected value ... Malformed").
Problem: "some other unexpected value handled by the format" is vague (byte 0).
Fix: "version byte 0 -> `Malformed`; `> 1` -> `UnsupportedVersion`; `=== 1` proceeds".

### F6 — NIT — Digest failure is classified `Malformed`
Where: `design.md` Error handling table row "`crypto.subtle.digest` rejects/throws".
Problem: an environment failure is not a malformed capsule, which blurs the TypeError/CapsuleError split just added. Practically unreachable given the snapshot copy.
Fix: let the platform error propagate as-is (not a capsule input rejection) and say so, or document it as an intentional exception.

### F7 — NIT — Acceptance criteria numbering out of order
Where: `requirements.md` ACs `10a` placed after `11`.
Fix: renumber the label or move it next to `10`; IDs are stable so only ordering changes.

## Verified Assumptions
- Kit `TransportUpdate {documentId, kind: "full"|"diff", bytes}`; `Replica.applyUpdate(carrier: unknown): ApplyOutcome`; carrier check rejects zero-length bytes; an empty doc export is non-empty Yjs bytes.
- `PersistSession.identity` is `ResolvedIdentity` with `replicaId`; there is no top-level `documentId`.
- `PersistSession.applyUpdate` throws `ClosedError` when phase is not `open` (closed or recovery); marks dirty only on `ok`.
- `PersistSession.flush()` rejects `ClosedError` for closed/recovery; the pre-write `maxBytes` check raises `QuotaExceededError` through `#failSave`.
- `record.ts` `sha256Hex` uses `crypto.subtle.digest` on a `.slice()` copy (async).
- Dependency graph is acyclic: `persist -> kit` exists; `capsule -> kit`; persist devDependency on capsule is the only new cross edge. `pnpm-workspace.yaml` globs `packages/*` and `apps/*`, so no workspace-file change.
- `packages/persist/tsconfig.json` includes `harness/**/*.ts`, so a compile-time assignment there is covered by `typecheck`.
- No planned test is claimed as executed in any of the three docs.

## Unverified / Wrong Assumptions
- WRONG: `TextDecoder` `ignoreBOM: false` keeps the BOM (F1).
- UNVERIFIED: that the harness open call can pass `maxBytes` (it does not today; F4).
- UNVERIFIED (inherent to planning): that the JSON token scanner, snapshot-ownership timing tests, and Vite resolution of the capsule `dist` will behave as designed; none has been executed.
