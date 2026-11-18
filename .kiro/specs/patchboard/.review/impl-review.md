# PatchBoard implementation review

Verdict: APPROVED. No blockers.

Evidence read: git status (nothing staged; packages/ and apps/fieldledger clean; tracked changes limited to apps/patchboard/package.json, pnpm-lock.yaml, docs/progress.md), src/model/write.ts, src/session/session-controller.ts, e2e/two-profile.spec.ts, e2e/save-failure.spec.ts, playwright.config.ts, vitest.config.ts, tests/batches.ts, docs/progress.md results. Suites were not re-run; recorded results were used.

- Single placement field; move/reorder: `moveCard`/`reorderCard` call `getResult(id)` and spread the stored entity with only `placement` replaced (write.ts). `commitCardFields` changes only title/notes. Controller methods take IDs only; no cached card is passed.
- listResults() is the only read path; Restore/Discard exist in the controller (`restoreInvalid`, `discardInvalid`).
- Characterization: unknown-field test (unknown-fields.test.ts) and delete-vs-edit/move (E2E-PB-06/07, kit-integration tests) recorded in progress.md.
- Four corrected scenarios: keyboard (E2E-PB-03/08/12/15), draft survives import (E2E-PB-20), real 404 precache (E2E-PB-11), U-PB-21 stale-model move with negative control (recorded failing 2 of 5 under a cached-card writer).
- E2E-PB-01: two contexts, real .gscap both ways, asserts exact placement/title/notes, single record, deep-equal stores, duplicate import no-op, offline reload.
- Rejections and applied-but-unsaved: E2E-PB-04 and E2E-PB-05; setup flushed and sequence asserted before `armAbort`; Retry save by keyboard. dist-scan test (4 tests) covers absence of failure injection.
- Default Playwright timeout (30 s) and Vitest default kept; four named 50-case batches per property (seeds 424242 to 424245, numSkips 0 asserted).
- Screenshots exist at apps/patchboard/test-results (desktop 1280x800 and 320x640, taken after assertions); the workspace is not under OneDrive/Desktop.
- progress.md is candid: lists unverified items (sub-path hosting E2E-PB-19, AT checks, old-worker case).
- Recorded results: typecheck 0; 26 files/153 tests; 19 Chromium tests passed; kit 112, capsule 120, persist 50, fieldledger 81; fresh-snapshot run also passed.

Limits: .agents/ and .review-artifacts/ are untracked, so "untouched" cannot be proven from git; no change to them appears in the diff or progress notes.
