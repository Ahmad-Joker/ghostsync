# FieldLedger MVP spec: consistency review

Reviewed: `.kiro/specs/fieldledger/{requirements,design,tasks}.md`, the appended entry in `docs/progress.md`, and spot-checks against `packages/{kit,persist,capsule}/src`, `packages/persist/{harness,scripts,e2e}`. Baseline `916165f`, branch `feat/fieldledger`. Review only: nothing was fixed, built, installed or run, and nothing was staged or committed.

**Verdict**: APPROVED

No HIGH findings. The quoted signatures, identity model and merge claims match the sources, the offline claims are honest, and all 29 tasks are pending. Several MEDIUM findings are real gaps in acceptance-criterion-level test coverage and in test-plan details. They do not block implementation, but they should be folded into `tasks.md` at the start of implementation.

Watch for: (1) traceability is requirement-level only, so about eight MUST acceptance criteria have no observable test (F-1); (2) the app's property tests carry the exact 200-run, 5 s timeout hazard that the capsule package already hit, and tasks 1.3 and 2.6 do not plan for it (F-2); (3) "Start a fresh copy" is designed but has no requirement or test (F-3).

## High-level view

Traceability from REQ-FL-001..019 to design sections, tasks and tests exists and is complete at requirement level. Every capsule and persist error code is mapped, and the 11 scenarios appear in both design and tasks. Identity, merge and persistence claims were checked against the real Kit, Persist and Capsule source and hold. Offline readiness is stated honestly, scope is clean, the failure injection is test-side only, and nothing is marked run or complete.

## Findings

### MEDIUM

**F-1 Acceptance-criterion-level coverage gaps (confirmed).** `tasks.md` section 7 maps requirements to tests, not acceptance criteria. These MUST-level criteria have no scenario or unit test that observes them:
- AC-FL-009-7: the `beforeunload` guard exists only while in `error`. Design A5 says no scenario reloads in `error`, so it is never exercised.
- AC-FL-009-9: a failed save that is not an import has no test (E2E-FL-05 covers only the import path).
- AC-FL-007-4: the commit of a focused draft on page hide has no test.
- AC-FL-001-7: "Change incident" and the failed-close path (backup, `dispose()`) have no test.
- AC-FL-010-8: "Update now" and the explicit skipWaiting path have no test.
- AC-FL-010-9: the network indicator chip is never asserted. E2E-FL-02 asserts only `navigator.onLine`.
- AC-FL-016-4: the 320 px no-horizontal-scroll check has no test.
- AC-FL-013-6: input disabled while an import runs has no test.

Fix: add an AC-to-test table, or add small scenarios or assertions, or downgrade these to SHOULD or manual checks explicitly. Refs: requirements REQ-FL-001/007/009/010/013/016; tasks section 7; design 14.4 and A5.

**F-2 Property-test timeout hazard not planned for (confirmed).** `packages/capsule/vitest.config.ts` sets `fileParallelism: false` because 200-run async property tests exceeded the 5 s default. This repo's earlier request required four named 50-run batches with distinct seeds for the same reason. `tasks.md` 1.3 and 2.6 plan `vitest.setup.ts` (200 runs, seed 424242) and a single `kit-integration.property.test.ts` using real `createKit` replicas with no mention of this. `tasks.md` also forbids timeout overrides, so the first run could fail with no pre-agreed remedy. Fix: in 1.3 specify `fileParallelism: false`, and in 2.6 and 2.7 pre-split each property into four 50-run batches with fixed distinct seeds, as the capsule suite does. Refs: tasks 1.3, 2.6, 2.7; design 14.5.

**F-3 "Start a fresh copy" and `rotateReplicaId` are untraced (confirmed).** They appear in design 2.3 and the `InvalidRecordError` row of 9.3, and in decision D-3, but there is no REQ or AC and no test, and tasks 2.3 only lists `rotateReplicaId` as a function. The feature creates a new empty replica next to a damaged record and is arguably extra scope. Fix: either add a SHOULD requirement and a unit test, or remove the action and leave the message plus "reload" only. Refs: design 2.3, 9.3; requirements D-3; tasks 2.3.

**F-4 E2E-FL-07 asserts ordering against the implementation's own function (confirmed).** Design 14.4 says the order must equal "the order produced by the app's exported pure `compareItems`". That is circular: a wrong comparator passes. The expected order is independently derivable (equal `sortKey`, then item ID in code-unit order). Fix: compute the expectation in the test from decoded `sortKey` and IDs, not via `compareItems`. Refs: design 14.4 E2E-FL-07.

### LOW

**F-5 Outline width mismatch (confirmed).** AC-FL-016-2 requires a 3 px outline, design 10.3 uses 3 px, but E2E-FL-09 asserts "at least 2 px". Align the assertion to 3 px. Refs: requirements AC-FL-016-2; design 14.4 E2E-FL-09.

**F-6 `list()` vs `listResults()` wording (confirmed).** AC-FL-007-3 says re-render from `list()` and `listResults()`. Design 3.3 says render only from `listResults()` and never use `list()` in render paths. Align the requirement to `listResults()`. Refs: requirements AC-FL-007-3; design 3.3.

**F-7 Wrong requirement attribution in the request map (confirmed).** requirements section 8, last row maps "Accessibility, security, UI steering" to REQ-FL-015, 016, 017. REQ-FL-015 is the before and after view; it should be 016 and 017 (and 008 for status roles). REQ-FL-018 and 019 have no row. Refs: requirements section 8.

**F-8 REQ-FL-010 sub-path criterion has only an optional test (confirmed).** AC-FL-010-7 sits under a MUST requirement, but its only test, E2E-FL-11, is "optional". Mark AC-FL-010-7 SHOULD, or make E2E-FL-11 required. Refs: requirements AC-FL-010-7; design 14.4 E2E-FL-11.

**F-9 E2E-FL-06 "Try again" is a polled retry loop (likely).** The scenario presses "Try again" inside a bounded `expect.poll` after `page1.close()`. The wait is bounded and observes `data-session`, but repeated clicking is a retry in spirit, and Web Lock release timing after a page close can lag. Specify a single click followed by a bounded wait on `data-session`, or a click-per-poll with a stated maximum count. Refs: design 14.4 E2E-FL-06.

**F-10 Delete versus edit is evidenced only for a new field in the Kit docs (possible).** The Kit precedent (`sdk-foundation/design.md`, "Edit concurrent with deletion") covers B writing a new field. E2E-FL-08 and AC-FL-006-4 have B editing the existing `text` field. Yjs map semantics should give the same outcome (B's new entry is not deleted by A), but no existing Kit test shows it. The planned `kit-integration.test.ts` and E2E-FL-08 will settle this, and it is correctly framed as a test to run. Check at implementation that the Kit-level test exists before the browser one.

**F-11 progress.md lacks a trailing newline (confirmed).** The appended entry ends with "No newline at end of file" (the original ended with a newline). Harmless, but add one when the file is next edited. Ref: `docs/progress.md` last line.

## Checks performed

1. Traceability: all REQ-FL-001..019 appear in the `tasks.md` section 7 table, in design scenarios (REQ lists on E2E-FL-01..11) and in tasks 1.x to 5.x. 29 tasks counted, 0 checked. Gaps at AC level are F-1.
2. Signatures against source (all match): `openReplica` options (`dbName`, `maxBytes`, `onStateChange`, `replicaId`), `PersistSession` members (`identity`, `restored`, `state`, `collection`, `subscribe`, `applyUpdate`, `flush`, `close`, `dispose`, `exportState`, `exportBytes`), `GuardedCollection` (`put`, `get`, `getResult`, `list`, `listResults`, `delete`, `has`), `SaveState` and `SaveStateInfo.sequence`, `PersistenceErrorCode` (10 of 10 mapped), `CapsuleErrorCode` (10 of 10 mapped), `encodeCapsule` (async, `{ app, documentId, update }`, rejects non-`full` and mismatched ids), `importCapsuleIntoPersisted` result (`applied`, `persisted`, `metadata`, `saveError` with `name`, `message`, optional `code`), `DEFAULT_MAX_CAPSULE_BYTES` 16 MiB, `DEFAULT_MAX_UPDATE_BYTES` 8 MiB, `CAPSULE_MEDIA_TYPE`, `.gscap`, `GSCAP\0` magic, `DEFAULT_MAX_BYTES` 8 MiB.
3. Identity, ownership and merge: storage key `esc(app) SEP esc(documentId) SEP esc(replicaId)`, Web Lock name `ghostsync:lock:<db>\u001f<key>` with `ifAvailable`, `StorageInUseError` on contention, replica ID separate from Yjs `clientID`, Persist handles `pagehide` and `visibilitychange`, `applyUpdate` marks dirty on every accepted update, Kit `put` is a changed-field diff that deletes omitted fields, `getResult`/`listResults` return `invalidRecord` without repair, schema mismatch is an untyped `Error` with the quoted prefix, `subscribe` reports `origin` `"remote"` for applies. All confirmed.
4. Offline honesty: first online visit required, `localhost` or HTTPS only, no cold-offline claim, a test (E2E-FL-10) that proves the first offline visit fails, readiness only after control plus a complete precache round trip, and the fragment-matching uncertainty stated openly (A2, D-9, design 8.4).
5. Contradictions between documents: only F-5, F-6 and F-7. Cross-references to design 8.3, 8.4 and 9 resolve. Pins (TypeScript 7.0.2, Vite 8.3.6, Vitest 5.1.0, Playwright 1.65.0, `@types/node` 24.19.2, `fast-check` 4.10.2) match the existing package manifests. Port 4329 does not collide with persist's 4319.
6. Scope: QR, PatchBoard and Studio appear only in out-of-scope or follow-up lists. Accounts, server sync, encryption, compression, differential capsules, a dashboard and attachments are out of scope and not designed. Mild additions: "Start a fresh copy" (F-3), the "Update now" flow and the network chip.
7. Scenarios: two separate contexts, UI plus raw IndexedDB persisted-state assertions, bounded timeouts, no sleeps, retries or skips, failure injection via test-owned `addInitScript`, a `dist-scan` that asserts the hook names are absent from the shipped bundle, and the one-shot abort armed after the setup save (matching the previously fixed persist test). Residual issues: F-4, F-5, F-9.
8. Status claims: every task is `- [ ]`, no `[x]` exists, and no sentence claims a planned test ran. Only the earlier file-capsules history is described as having been run.
9. progress.md: the diff is 38 insertions and 0 deletions, so history is preserved. The entry says "FieldLedger MVP = PLANNED ONLY". See F-11.

## Remaining blockers

None. Recommended before implementation starts: F-1, F-2, F-3, F-4 (MEDIUM).

## Git evidence (read-only)

Command: `git -C C:\Users\ahmad\ghostsync status --short --branch`

```
## feat/fieldledger
 M docs/progress.md
?? .agents/
?? .review-artifacts/
?? .kiro/specs/fieldledger/
```

Only `.kiro/specs/fieldledger/**` (new) and `docs/progress.md` (modified) are changed by this work. `.agents/` and `.review-artifacts/` are pre-existing untracked directories that were left untouched. This review file and the verdict JSON are added under `.kiro/specs/fieldledger/.review/`.

Command: `git -C C:\Users\ahmad\ghostsync diff --check` (exit code 0)

```
warning: in the working copy of 'docs/progress.md', LF will be replaced by CRLF the next time Git touches it
```

No whitespace errors were reported. The only output is the line-ending warning from the repository's autocrlf setting. `git diff --stat`: `docs/progress.md | 38 ++++ (1 file changed, 38 insertions(+))`.
