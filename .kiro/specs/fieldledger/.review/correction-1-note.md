# FieldLedger spec: correction pass 1

Scope: planning files only (`requirements.md`, `design.md`, `tasks.md`, `docs/progress.md`) on
`feat/fieldledger`, baseline `916165f`. Nothing was run, installed, built, staged or committed. No
planned test has run. The original review record (`consistency-review.md`,
`consistency-verdict.json`) is preserved byte for byte. This note is a new file.

## What changed, by finding

- F-1 (MUST criteria without a test). Added an AC-level table (`requirements.md` section 9,
  `tasks.md` section 7A, design 14.7 pointer) for AC-FL-001-7, 007-4, 009-7, 009-9, 010-8, 010-9,
  013-6 and 016-4, each with a named test and an exact observation (selector, attribute or raw
  IndexedDB read). New scenarios: E2E-FL-12 change incident and failed close, E2E-FL-13 page hide
  commit, E2E-FL-14 failed edit save and `beforeunload` guard, E2E-FL-15 waiting worker and
  "Update now", E2E-FL-16 320 px layout, E2E-FL-17 import input disabled while importing,
  E2E-FL-18 invalid record rendering. AC-FL-010-9 reuses E2E-FL-02. Downgraded: none. The claim
  covers these eight criteria only; the other MUST criteria keep their requirement-level mapping
  and were not re-audited AC by AC. New test-only helpers (file-read gate, `/__test/sw-bump`
  endpoint) live in test code and are scanned for in `dist/`. Two assumptions are open: A6
  (a bumped worker becomes `waiting` in Chromium) and the `beforeunload` dialog observation in
  E2E-FL-14. If either cannot be observed, the criterion is downgraded openly in a later spec
  update.
- F-2 (property batching). Design 14.6, tasks 1.3, 2.6, 2.7: 4 named batches of exactly 50 cases per
  property, seeds 424242 to 424245, `numRuns === 50` and `numSkips === 0` per batch, `afterAll`
  total 200, `tests/fc-report.ts` reporter, default 5 s timeout, bounded generators, no overrides.
  Expected 12 + 8 = 20 batch tests.
- F-3 ("Start a fresh copy"). Removed the feature, `rotateReplicaId`, decision D-3 and every
  dependent mention. The `InvalidRecordError` row now states that the damaged record is preserved,
  nothing can be exported (no session opens), "Open a different incident" is available, and a manual
  instruction applies. Recorded as limitation L-11. No new feature.
- F-4 (ordering). Fixture ORD-FIX-1 (design 14.4.1) with tied sort keys and hand-written literal
  sequences. The unit test and E2E-FL-07 read the order from `sortEntries` and the DOM
  `data-item-id` list and compare with literals. They never call `compareItems`.
- F-10 (delete versus edit). AC-FL-006-4, design 5 and 5.1, E2E-FL-08 and task 2.10 now specify a
  characterization with the convergence assertion (a) to (c) and the three acceptable shapes. The
  observed Kit outcome is NOT recorded yet (empty evidence notes in design 5.1 and tasks 2.10). The
  Kit precedent is stated honestly as covering a new field only. E2E-FL-18 covers invalid-record
  rendering deterministically so AC-FL-004-4 does not depend on this outcome.
- F-5 (outline). One value: 3 px (`outline-width` exactly `3px`) in AC-FL-016-2, E2E-FL-09, the CSS
  in design 10.3 and task 3.4.
- F-7 (references). Requirements section 8: accessibility, security and UI steering now cite
  REQ-FL-016, 017 and 008. Rows added for REQ-FL-018 and REQ-FL-019. Design and tasks scanned; the
  traceability table in tasks section 7 now lists the new scenarios.
- F-9 (retry loop). E2E-FL-06 waits by reading `navigator.locks.query()`, clicks "Try again" once,
  then awaits `html[data-session="ready"]` with the normal `expect` timeout. A single-action rule is in
  design 14.1 and task 4.7. `expect.poll` only reads state.
- F-11. `docs/progress.md` ends with exactly one newline after the new note.

## Intentionally left open (out of scope for this pass)

- F-6: AC-FL-007-3 still says `list()` and `listResults()`, while design 3.3 renders only from
  `listResults()`.
- F-8: AC-FL-010-7 (sub-path) is still a criterion under a MUST requirement whose only test,
  E2E-FL-11, is optional.

## Not done

No test, build, install, review loop or commit. The earlier progress entry (pre-correction) still
mentions delete versus edit as an incomplete item; this pass supersedes that line, and prior
history was not edited.
