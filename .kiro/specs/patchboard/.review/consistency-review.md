# PatchBoard spec: consistency review

Verdict: CHANGES_REQUESTED (no HIGH findings; four MEDIUM spec gaps to close before implementation).

Scope: read-only review of requirements.md, design.md, tasks.md and the docs/progress.md entry. Nothing was built, run, installed, staged or committed. No planned test has run, and none is claimed to pass.

## Evidence checked

- Traceability: a script count gives 103 MUST criteria and 103 table rows in requirements section 9. There are no missing rows, no duplicate rows and no rows without a MUST. Every referenced U-PB-01..20, P-PB-01..08, D-PB-01 and E2E-PB-01..17, 19 exists in design 13.2 and 13.5 and has a task. Every task links to a requirement ID, except 1.3, which links only to NFR-PB-004.
- Signatures match source:
  - Kit: Collection put/get/getResult/list/listResults/delete/has, GetResult, and the per-field changed-fields `put` that also deletes omitted fields.
  - Kit: the untyped "GhostSync Kit: schema mismatch" error, thrown by listResults too.
  - Persist: OpenOptions, ReplicaIdentity, SaveState and SaveStateInfo, PersistSession, GuardedCollection, and all 10 PersistenceErrorCodes.
  - Capsule: encodeCapsule input, importCapsuleIntoPersisted result with persisted and saveError, all 10 CapsuleErrorCodes, the 16 MiB and 8 MiB limits, and version byte offset 6 (2 gives UnsupportedVersion).
- FieldLedger behaviours match source: guard() skips refresh on error, editError, workspaceStale, refresh() boolean, settle, discardAndSwitch, openJoin, and the 80-code-point meta cap. The spec is right that FieldLedger's controller has no injectable openReplica.
- Placement: one `placement` field gives one LWW winner and so one coherent (column, position). The two-field mixed outcome described in design 4.1 is real under the Kit's changed-fields put. The positionBetween table, RN-FIX-1 (1/2/3 become 1024/2048/3072), and ORD-FIX-PB-1 literals were hand-checked and are correct. Tie handling (lo == hi gives renormalize) is coherent.
- Delete characterization: CH-PB-1 and CH-PB-2 assert convergence and an enumerated shape set only. The evidence notes read NOT YET RECORDED. Task 2.9 precedes the E2E delete specs (task 4.7). Design wording uses "may". This matches the brief.
- Honesty: readiness needs a controlling worker plus a complete precache. The first visit must be online, on localhost or HTTPS, and hosted at root. Cold offline is stated to fail.
- Scope: drag-and-drop, QR, Studio, accounts and server sync appear only as out of scope or follow-up.
- Ports: PatchBoard 4339, FieldLedger 4329, Persist 4319. They do not collide.
- Git: `git status` shows ` M docs/progress.md` plus untracked `.kiro/specs/patchboard/`, `.agents/` and `.review-artifacts/`. The two older untracked directories were not modified (older timestamps). `git diff --check` exits 0 with only LF-to-CRLF warnings. progress.md ends in exactly one newline, and its diff is +11 lines with history intact.

## Findings

### HIGH

None.

### MEDIUM

M1. requirements.md AC-PB-017-1 (section 6 and the section 9 row) over-claims. The AC says every action (update, change board, restore, discard, retry, backup, confirm) is keyboard-operable. The named tests are E2E-PB-03, 04 and 05 only. Restore and Discard run in E2E-PB-08, change board in E2E-PB-15, and Update now in E2E-PB-12, all described with pointer clicks. Correction: either require `focus()` plus `keyboard.press` in E2E-PB-08, 12 and 15 and list them in the row, or narrow the AC to the actions tested.

M2. design.md 13.5 (E2E-PB-03) and tasks.md 4.4 define no step for AC-PB-006-8 (the edit draft survives a board refresh). The AC row says "an import that refreshes the board leaves input[name=title] equal to the draft", but E2E-PB-03 is keyboard-only add/edit/move and names no capsule source. Correction: add an explicit step to design 13.5 and task 4.4. Suggested step: open the edit form, type a draft, import a Node-built capsule that changes another card, then assert the draft value and focus. Alternatively, add a view-level unit test.

M3. design.md 13.5 (E2E-PB-11) and AC-PB-010-3 (MUST). The "blocked precache asset" is produced with `context.route`. FieldLedger dropped its failing worker and has no such E2E, so the mechanism is unproven in this repo. Playwright may not route requests made inside a service worker. Correction: specify a deterministic fallback, such as a test-only static-server switch (like `/__test/sw-bump`) that makes one precached URL return 404 or 500. Also state which mechanism is primary.

M4. Stale-move detection (design 13.3, AC-PB-021-2) has weaker teeth than described.
  - Teeth that exist: the write-set diff through a probe adapter, the put-spy (a2), and the naive-writer control, which proves the detector flags a whole-card stale put.
  - Gap 1: the production `moveCard(cards, id, column)` takes no snapshot. STALE-FIX-1 never feeds the stale model to production code, so the "stale model" step is effectively a read-current test.
  - Gap 2: E2E-PB-01 would pass even with a naive writer. The spec admits this.
  - Correction: add a controller-level test in U-PB-17 or U-PB-18. Make `refresh()` fail after an import so `this.model` is stale, change title/notes in the store, call `controller.move()` and `reorder()`, and assert the written set is `["placement"]`. That test would fail if a regression passed the cached model into the writer. Also add the same case for `saveCard`.

### LOW

L1. design.md 13.5 (E2E-PB-08): card-ok1's placement is never stated, yet the literal `todo|00002048` for Restore of card-inv2 depends on card-ok1 being `todo|00001024`. "Discard on a copy of the scenario" is vague. Correction: state both placements and the Discard sequence.

L2. design.md 9.1 gives the Restore and Discard accessible names as `Restore card <id>` and `Discard card <id>`. requirements AC-PB-006-7 and AC-PB-016-3 call the buttons "Restore" and "Discard". With role-name queries and `exact: true` these do not match. Correction: use one set of names everywhere.

L3. tasks.md section 7 maps each requirement to implementation and Node-test tasks only. It omits the Playwright tasks (4.x), for example REQ-PB-021 lacks 4.2 and REQ-PB-011 lacks 4.2 and 4.11. REQ-PB-004 lists U-PB-09 but not task 2.10, where it is built. The task bodies do carry the links; the table is just incomplete.

L4. AC-PB-006-3, AC-PB-006-4 and AC-PB-021-1 say "exactly one field placement". Per L-7, a record that carries unknown extra fields also has those deleted by `put`. The detector, which diffs raw fields, would flag it. Correction: scope the AC to records with only the three known fields, or add the exception. Optionally add a test that pins the L-7 behaviour.

L5. Scope additions are beyond the brief but disclosed: the 500-card limit (MUST AC-PB-004-6), the remembered last board, optional sub-path hosting (E2E-PB-19), inline two-step delete, and the explicit "Save card" button. None is a feature the brief excluded. Confirm that the user wants the 500-card MUST.

L6. docs/progress.md says a unit test "proves detection". This is future-tense in context, but "is planned to detect" is more accurate. This is wording only.

## Remaining blockers

M1, M2, M3 and M4 should be fixed in the spec before implementation. Each is a missing or overstated observation for a MUST. None changes the architecture or the placement decision, which are sound. The LOW items are optional.
