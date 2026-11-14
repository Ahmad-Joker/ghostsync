# PatchBoard MVP: Tasks

Status (implementation pass, uncommitted): every task is checked except the optional 4.14. The commands, exit
codes and totals behind each check are recorded in `docs/progress.md` ("PatchBoard MVP implementation").
Baseline `690cffd`, branch `feat/patchboard`. Requirement IDs refer to `requirements.md`; design
sections refer to `design.md`. Test IDs (`U-PB-nn`, `P-PB-nn`, `D-PB-01`, `E2E-PB-nn`) are defined in
design sections 13.2 and 13.5.

Rules for the implementer:

- Only `apps/patchboard/**`, `pnpm-lock.yaml` (via install), `.kiro/specs/patchboard/**` and
  `docs/progress.md` may change. `packages/**` and `apps/fieldledger/**` must not change (REQ-PB-019).
- Use `pnpm.cmd` (never `pnpm`, `npm` or `yarn`). Add no package beyond design section 15.
- Do not add `test.skip`, `test.fixme`, retries or timeout overrides. Keep the default 5 s unit timeout.
- Activate each action once (by keyboard for every action in the design 13.5.1 inventory), then await the
  observable result. No click inside `expect.poll`, no click
  loop.
- Failure injection stays in test code (`e2e/helpers.ts`); setup writes are flushed and asserted before a
  one-shot failure is armed.
- Do not claim a test passed without the recorded command, exit code and totals in `docs/progress.md`.
- Write each pure test before the code it covers. Do the characterization (task 2.9) before E2E-PB-06 and
  E2E-PB-07 and before any text names a winner.

## 1. Package and tooling

- [x] 1.1 Rewrite `apps/patchboard/package.json` as in design section 15 (`type: module`, scripts
  `typecheck test build test:dist preview test:e2e`, workspace dependencies, exact devDependency pins). Run
  `pnpm.cmd install`, inspect that the lockfile diff only adds the `apps/patchboard` importer, then run
  `pnpm.cmd install --frozen-lockfile`. (REQ-PB-019)
- [x] 1.2 Add `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, Bundler
  resolution, `lib ES2022 + DOM`, `verbatimModuleSyntax`, `types ["node","vite/client"]`; include `src`, `tests`,
  `e2e`, `scripts` and the config files). No path alias: the app resolves the built package entries. (REQ-PB-019)
- [x] 1.3 Add `vitest.config.ts`, `vitest.dist.config.ts`, `vitest.setup.ts`
  (`fc.configureGlobal({ numRuns: 200, seed: 424242 })`), `tests/batches.ts` (four 50-case batches, seeds 424242 to
  424245, `numRuns === 50` and `numSkips === 0` asserted per batch) and `tests/fc-report.ts` (prints
  `result seed numRuns numSkips numShrinks`; on failure the original error, counterexample and
  `replay: seed=<seed> path=<path>`), copied from `apps/fieldledger/tests`. Neither helper is named `*.test.ts`.
  No `testTimeout`, retries or skips. (NFR-PB-004)
- [x] 1.4 Add `vite.config.ts` (`base: "./"`, `outDir dist`, `target es2022`, plugin `swPrecachePlugin()`),
  `index.html` (CSP meta as FieldLedger's, title PatchBoard) and `scripts/sw-precache-plugin.ts` as the adapted copy
  of `apps/fieldledger/scripts/sw-precache-plugin.ts`: `CACHE_PREFIX = "ghostsync-patchboard-"`, PatchBoard wording,
  header comment naming the source and baseline `690cffd`, hash-route fragment stripping kept, no test-only
  failing worker. (REQ-PB-010; decision D-2)

## 2. Pure model, identity and Node tests

- [x] 2.1 `src/config.ts`, `src/identity/board-id.ts` (`normalizeBoardId`, `validateBoardId`, `parseRoute`,
  `formatRoute`), `src/model/ids.ts` (`newCardId`). Tests `U-PB-01 board-id.test.ts`, `U-PB-03 card-id.test.ts`
  (including 10,000 unique IDs). (REQ-PB-001, 002)
- [x] 2.2 `src/identity/replica-id.ts` (`KeyValueStore`, `replicaStorageKey`, `getOrCreateReplicaId`). Test
  `U-PB-02 replica-id.test.ts` with an in-memory store: stable reopen, distinct per board, malformed value
  replaced, throwing store propagates. (REQ-PB-002)
- [x] 2.3 `src/model/placement.ts` (`COLUMNS`, `ColumnId`, `COLUMN_LABEL`, `POSITION_MIN`, `POSITION_MAX`,
  `formatPlacement`, `parsePlacement`). Tests `U-PB-04 placement.test.ts` (literal `doing|00001024`, the invalid
  list: `Doing|00001024`, ` doing|00001024`, `doing|0001024`, `doing|000010240`, `doing|00000000`,
  `archive|00001024`, `doing|00001024|x`, empty string) and `P-PB-01 placement.property.test.ts` (4 batches).
  (REQ-PB-005)
- [x] 2.4 `src/model/adapters.ts` (`Card`, `LIMITS`, `cardAdapter` with `schema { app: "patchboard", entityType:
  "card", schemaVersion: 1 }`). Test `U-PB-05 adapter.test.ts`: round trip, each invalid input, boundaries 1/120/2000,
  `toFields` emits exactly `title`, `notes`, `placement`, `fromFields` throws for each missing or mistyped field,
  extra field ignored. (REQ-PB-004)
- [x] 2.5 `src/model/position.ts` (`POSITION_STEP`, `positionBetween`, `nextPosition`, `renormalizeColumn`). Tests
  `U-PB-06 position.test.ts` (the literal table of design 5.4 and `renormalizeColumn` with RN-FIX-1) and
  `P-PB-02 position.property.test.ts` (4 batches). (REQ-PB-005)
- [x] 2.6 `src/model/ordering.ts` (`toPlaced`, `compareCards`, `sortPlaced`, `groupByColumn`). Tests
  `U-PB-07 ordering.test.ts`: write the ten fixture entries of ORD-FIX-PB-1 (design 7.2) in scrambled order, then
  reversed, into `groupByColumn` and assert by `toEqual` the hand-written literals `ORD_TODO_EXPECTED`,
  `ORD_DOING_EXPECTED`, `ORD_DONE_EXPECTED`, and with `card-n2` then `card-n1` (both `todo|00003072`)
  `ORD_TODO_CONCURRENT_EXPECTED`. The expectations MUST NOT be built with `compareCards` or another app helper.
  `P-PB-03`, `P-PB-04`, `P-PB-05` in `ordering.property.test.ts`, 4 batches each. (REQ-PB-005, 007)
- [x] 2.7 `src/model/read-model.ts` (`readBoard(cards)` over `listResults()` only; valid cards grouped and sorted,
  invalid rows sorted by ID), `src/model/diff.ts` (`diffBoards`). Test `U-PB-10 read-model.test.ts`: `list()` is
  never called (a stub throws if it is), invalid rows keep their preserved fields, an invalid card is in no column,
  hostile title text is returned as data, diff lines per design 9.2. (REQ-PB-015, 016, 005)
- [x] 2.8 `src/model/write.ts` (`addCard`, `commitCardFields`, `moveCard`, `reorderCard`, `deleteCard`,
  `restoreCard`) over the `WritableCards` slice. Tests:
  - `U-PB-08 write-set.test.ts` per design 13.3: the `probeAdapter` reader, `writtenFields`, `assertStaleSafe`;
    move to each column writes exactly `["placement"]`; reorder up and down; STALE-FIX-1 stale-model move (stored
    title and notes unchanged); the `naiveMove` fixture flagged with `["notes","placement","title"]` and
    `assertStaleSafe` throwing; STALE-FIX-2 stale edit form and the naive form writer flagged; RN-FIX-1 literal
    placements with written set `["placement"]` per card (written-set claims are scoped to cards holding only the
    supported fields, design section 5); absent and invalid current record write nothing; `put` spy sees current
    stored title and notes. There is no card-count safeguard in the MVP. These are model-helper tests;
    the production controller path is task 3.7. (REQ-PB-006, 021, 004)
  - `U-PB-11 restore.test.ts`: literal fallbacks for `card-inv1`-style and `card-inv2`-style records, an already
    repaired card is `"noop"`, Discard deletes. (REQ-PB-016)
- [x] 2.9 CHARACTERIZATION FIRST, before E2E-PB-06 and E2E-PB-07 are written: in `tests/kit-integration.test.ts`
  implement CH-PB-1 (delete versus edit of an existing field, `title`) and CH-PB-2 (delete versus move) exactly as
  in design section 12 with two real `createKit` replicas and the real `cardAdapter`. Assert only that both decoded
  states deep-equal and that the card shape is one of: absent on both; valid on both; `invalidRecord` on both with
  identical preserved fields. Print the observed shape and fields. Record the observed shapes, date and Kit
  baseline in the EVIDENCE NOTES of design section 12 AND in the evidence line of this task BEFORE any UI copy,
  README text or spec text says who wins. A result outside the three shapes, or non-convergence, is a Kit finding to
  report, not to hide. FieldLedger's shape (iii) is only a precedent for a different entity. (REQ-PB-007;
  AC-PB-007-5, 007-6, 007-7)
  EVIDENCE NOTE (2026-11-14, Kit baseline `690cffd`): CH-PB-1 gave SHAPE-INVALID with preserved fields
  `{ title: "Check valve 2" }`; CH-PB-2 gave SHAPE-INVALID with `{ placement: "doing|00001024" }`. Both replicas
  deep-equal. Chromium E2E-PB-06 and E2E-PB-07 observed the same shapes.
- [x] 2.10 Remainder of `tests/kit-integration.test.ts` (design 13.4: move versus edit, same-card moves,
  different-card moves, same-field edits, concurrent adds with a tie, duplicate and out-of-order import,
  partial-adapter record becomes `invalidRecord`, real schema-mismatch error recognized by `isSchemaMismatch`) and
  `tests/kit-integration.property.test.ts` with `P-PB-06`, `P-PB-07`, `P-PB-08`, each 4 batches with bounded
  generators. The whole suite must also pass under default parallel load. (REQ-PB-007)
- [x] 2.11 `src/state/save-label.ts` and `src/state/errors.ts` (`mapPersistError`, `mapCapsuleError`,
  `mapSaveError`, `mapEditError`, `isSchemaMismatch`, constants). Tests `U-PB-12 save-label.test.ts`,
  `U-PB-13 errors.test.ts` (every `CapsuleErrorCode`, every `PersistenceErrorCode`, TypeError, ReadFailed, both edit
  kinds, "Nothing was changed." on every capsule message, names of the other board and app capped at 80).
  (REQ-PB-008, 009, 014)
- [x] 2.12 `src/transfer/filename.ts`, `src/transfer/export.ts` (`downloadBytes` with injectable `URL` and
  `document`), `src/transfer/capsule-meta.ts`, `src/offline/status-copy.ts`, `src/ui/announce.ts`. Tests
  `U-PB-14 filename.test.ts` (the two literal filenames of design 11.1, URL revoked once), `U-PB-15
  capsule-meta.test.ts`, `U-PB-16 status-copy.test.ts`, `U-PB-19 announce.test.ts` (literal announcements, focus
  target choice). (REQ-PB-010, 012, 013, 017)

- [x] 2.13 Unknown-field characterization `tests/unknown-fields.test.ts` (U-PB-22, design 5.7), real Kit and the
  probe adapter: a card stored with `legacy: "x"` reads as `ok`; `moveCard` gives written set
  `["legacy","placement"]`, `commitCardFields` of notes gives `["legacy","notes"]`, `reorderCard` and `restoreCard`
  also drop `legacy`. Documents behavior; it does not add preservation. (REQ-PB-004, 006; AC-PB-004-7)

## 3. Browser modules

- [x] 3.1 `src/offline/sw-register.ts`: adapted copy of FieldLedger's. Sets `html[data-offline-state]` and
  `html[data-offline-ready]`, exposes a subscribe callback and `applyUpdate()`, no `window` global, ready only when
  controlled AND precache complete, no automatic `skipWaiting`. (REQ-PB-010)
- [x] 3.2 `src/session/session-controller.ts` per design 8: `SessionDeps` injection, `open`, `refresh` keeping the
  last good model, `guard()` setting `editError` without re-reading, save state via `onStateChange`, `retrySave`,
  `settle`, `changeBoard`, `discardAndSwitch`, `openJoin`, `focusRequest`. Tests `U-PB-17 edit-error.test.ts`
  (throwing `put`, schema mismatch with a throwing `listResults`, add with an empty title), `U-PB-18
  import-flow.test.ts` (design 13.2), `U-PB-20 session-open.test.ts`. The controller exposes `model` and `revision` and the methods `move`,
  `reorder`, `saveCard` that take a card ID only (design 8.1); no test-only production code.
  (REQ-PB-001, 002, 003, 006, 008, 009, 013)
- [x] 3.3 Import and export in the controller per design 11 (`File.size` check before `arrayBuffer()`, one import at
  a time, `decodeCapsule` only to name a mismatched board or app, before and after boards, stale-workspace flag).
  (REQ-PB-012, 013, 014, 015)
- [x] 3.4 `src/ui/h.ts`, `src/ui/app-view.ts`, `src/styles.css`, `src/main.ts`: textContent only, keyed card rows,
  focus handling and announcer per design 9.4, the selectors of design 9.1 and nothing else for tests, 3 px
  `:focus-visible` outline, stacked columns below 48em, no horizontal scroll at 320 px, reduced motion, merge help
  text, incomplete-card region. Also: the ONE accessible-name scheme (`<Action>: <card label>`, AC-PB-017-2) for
  every card control including `Restore card`, `Discard card`, `Confirm discard`, `Keep incomplete card`, `Save
  card`, `Cancel edit`; native buttons only; "Open a different board" on every error screen; "Reload app" on the
  `schema-mismatch` edit error; a visible labelled file input; `data-board-revision` on the board; draft
  preservation across refresh (design 9.3); focus to the title input when the edit form opens.
  (REQ-PB-004, 005, 006, 008, 009, 010, 015, 016, 017, 018)
- [x] 3.5 `e2e/static-server.mjs` (adapted copy of FieldLedger's, env `PATCHBOARD_PORT`, default 4339, serves `/`
  and `/deploy-pb/`, test-only `POST /__test/sw-bump`, plus the failed-precache fixture of design 13.5.2:
  `POST /__test/fail-asset?path=&skip=`, `GET /__test/request-log`, `POST /__test/reset`; test infrastructure only,
  never in `dist`) and `playwright.config.ts` (port 4339, `timeout 30_000`,
  `expect.timeout 10_000`, `workers 1`, `retries 0`, chromium, `reuseExistingServer: false`). (REQ-PB-010)
- [x] 3.6 `README.md`: build order, run, offline limits (first online visit, localhost or HTTPS, root hosting),
  file transfer, "integrity not authentication", out-of-scope list, placement format. No wording about delete
  winners until task 2.9 is recorded. (REQ-PB-010, 018)

- [x] 3.7 Controller-level stale test `tests/controller-stale-move.test.ts` (U-PB-21, design 13.3.1), written
  after 3.2: real `createKit` replica with two handles on one store, the controller's members filled by cast (no
  subscribe, no production seam), STALE-CTRL-1 preconditions asserted, `controller.move("card-s1", "doing")`,
  `controller.reorder("card-s1", 1)`, `controller.saveCard("card-s1", { notes: "My notes" })`, each asserting the
  written set (`["placement"]`, `["placement"]`, `["notes"]`), the NEWER stored title and notes, and the `put` spy;
  plus the `naiveControllerMove` NEGATIVE CONTROL (written set `["notes","placement","title"]`, stored title
  reverts, `assertStaleSafe` throws). Optional manual check recorded in `docs/progress.md`: temporarily make
  `move` use the cached card and note that the test goes red. (REQ-PB-021, 006; AC-PB-021-2, 021-3, 021-4)

## 4. Acceptance tests (after the app builds)

- [x] 4.1 `e2e/helpers.ts`: `installTestHooks` (one-shot write abort, sticky abort, file-read gate; test side
  only), `newProfile`, `loadUntilOfflineReady`, `offlineProfileOnBoard`, `join`, `awaitSaved`, `saveSequence`,
  `readStoredRecords` (database `patchboard`, store `replicas`), `decodeBytes` (real Kit and app adapters),
  `storedState`, `decodeCapsuleFile`, `readUiBoard`, `exportCapsule`, `importFile`, `expectImportMeta`, Node-side
  capsule builders (wrong board, wrong app, partial-adapter invalid cards, ORD-FIX-PB-1, newer-schema capsule),
  same-origin request recorder; plus `press(page, locator, key)` (focus, assert focused, ONE `keyboard.press`),
  `recordOfflineStates(page)` (MutationObserver on `<html>`, test side only), `serverFailAsset`, `serverRequestLog`,
  `serverReset`, and a manifest reader for `dist/precache-manifest.json`. (REQ-PB-020, 017, 010)
- [x] 4.2 `e2e/two-profile.spec.ts`: E2E-PB-01, steps 1 to 11 of design 13.5, with desktop screenshots attached
  after the assertions. (REQ-PB-001, 002, 006, 007, 011, 012, 013, 015, 021)
- [x] 4.3 `e2e/concurrent-moves.spec.ts`: E2E-PB-02. (REQ-PB-007)
- [x] 4.4 `e2e/keyboard.spec.ts`: E2E-PB-03 (keyboard only, steps 1 to 9 of design 13.5.2, covering A-01 to A-11
  of the action inventory in design 13.5.1; role-name queries with `exact: true`, focus and announcer literals,
  `outline-width` `3px`). (REQ-PB-004, 005, 006, 017)
- [x] 4.5 `e2e/rejection.spec.ts`: E2E-PB-04 (six rejected files, no mutation in UI or stored record; step 0 asserts
  A-12 reachability of the file input, 'reachability asserted, chooser dialog not driven', files supplied with
  `setInputFiles`). (REQ-PB-013, 014, 017, 018)
- [x] 4.6 `e2e/save-failure.spec.ts`: E2E-PB-05 (flush and assert setup, then arm the one-shot abort immediately
  before the import; "Retry save" and "Download backup capsule" by keyboard (A-13, A-14); reload; edit-save leg;
  `beforeunload` leg). (REQ-PB-008, 009, 012, 013, 017, 020)
- [x] 4.7 `e2e/delete-conflicts.spec.ts`: E2E-PB-06 and E2E-PB-07. Write AFTER task 2.9 is recorded. Assert only
  convergence and the enumerated shapes; log the observed shape. (REQ-PB-007)
- [x] 4.8 `e2e/invalid-cards.spec.ts`: E2E-PB-08 with the four-card fixture of design 13.5 (`card-ok1`
  `todo|00001024`, `card-inv1`, `card-inv2`, `card-inv3`), steps 1 to 5: keyboard `Restore card: ...`, `Discard card:
  ...`, `Keep incomplete card: ...` and `Confirm discard: ...` (A-22, A-23), hostile text as text. (REQ-PB-006, 016,
  017, 018)
- [x] 4.9 `e2e/ordering.spec.ts`: E2E-PB-09 against the literals of design 7.2, never through `compareCards`.
  (REQ-PB-005, 007)
- [x] 4.10 `e2e/session-lifecycle.spec.ts`: E2E-PB-10 (second tab; wait by reading `navigator.locks.query()` until
  the lock is released, then `Enter` on "Try again" exactly once, A-18) and E2E-PB-15 (change board by keyboard, A-20;
  failed close with the sticky abort; "Download backup capsule" and "Discard unsaved changes and switch" by keyboard,
  A-14, A-21). (REQ-PB-003, 009, 017)
- [x] 4.11 `e2e/offline.spec.ts`: E2E-PB-11 (leg 1 fresh profile offline; leg 2 failed precache with the TEST-SERVER
  fixture of design 13.5.2 and a fresh context: request log shows the install fetch of the failing URL, recorded
  `data-offline-state` never `ready`, final `failed`, offline reload rejects; no Playwright request routing), E2E-PB-12
  (waiting worker; "Update now" by keyboard, A-17), E2E-PB-17 (join validation, route, replica identity, labels,
  chip, same-origin requests). (REQ-PB-001, 002, 008, 010, 011, 017, 018)
- [x] 4.12 `e2e/edit-errors.spec.ts`: E2E-PB-13 (121-character title through the DOM; "Dismiss" by keyboard, A-15)
  and E2E-PB-14 (newer-schema capsule gives the stale-workspace notice; schema-mismatch edit error; "Reload app" and
  "Open a different board" by keyboard, A-16, A-19). (REQ-PB-009, 013, 017)
- [x] 4.13 `e2e/layout.spec.ts`: E2E-PB-16 at 320 x 640 and 1280 x 800 with a long title and an import result;
  screenshots attached after the assertions. (REQ-PB-017)
- [ ] 4.14 OPTIONAL `e2e/subpath.spec.ts`: E2E-PB-19 under `/deploy-pb/`. (REQ-PB-010, SHOULD) NOT DONE: optional,
  not implemented in the MVP pass. The static server serves `/deploy-pb/`, but no test exercises it.
- [x] 4.15 `tests/dist-scan.test.ts` (D-PB-01) and the `test:dist` script: no `armWriteAbortOnce`,
  `holdNextFileRead`, `releaseFileRead`, `__ghostsyncTest`, `window.__`, `/__test/`, `fail-asset`, `request-log`; CSP meta present; relative asset URLs only;
  no cross-origin URL; no import path into another package's `src`. (REQ-PB-018, 019, 020)

- [x] 4.16 `e2e/draft-refresh.spec.ts`: E2E-PB-20, steps 1 to 7 of design 13.5.3 (saved board with X and Y; A types an
  uncommitted draft in the focused X editor; B changes Y and exports `b-y.gscap` from its own UI; A imports it with
  `setInputFiles`; assert focus preserved, refresh happened via `data-board-revision` and Y's new text, draft visible
  and uncommitted, then `Enter` on `Save card: Draft spec`, offline reload, both edits in the DOM and in P2).
  (REQ-PB-006, 011, 013, 017)

## 5. Verification order (future; run once each, in this order, from `C:\Users\ahmad\ghostsync`)

Do not run these in the planning step. Record exit codes and totals when implementing. All commands use
`pnpm.cmd`.

```powershell
pnpm.cmd install
git diff --stat -- pnpm-lock.yaml
pnpm.cmd install --frozen-lockfile
pnpm.cmd -F @ghostsync/kit build
pnpm.cmd -F @ghostsync/capsule build
pnpm.cmd -F @ghostsync/persist build
pnpm.cmd -F @ghostsync/patchboard typecheck
pnpm.cmd -F @ghostsync/patchboard test
pnpm.cmd -F @ghostsync/patchboard build
pnpm.cmd -F @ghostsync/patchboard test:dist
pnpm.cmd -F @ghostsync/patchboard exec playwright install chromium   # only if Chromium is missing
pnpm.cmd -F @ghostsync/patchboard test:e2e
# regression of untouched packages and the reference app
pnpm.cmd -F @ghostsync/kit test
pnpm.cmd -F @ghostsync/capsule test
pnpm.cmd -F @ghostsync/persist test
pnpm.cmd -F @ghostsync/fieldledger typecheck
pnpm.cmd -F @ghostsync/fieldledger test
git status --short -- packages apps/fieldledger
git diff --check
```

Expected: every exit code `0`; `git status --short -- packages apps/fieldledger` prints nothing; the first
lockfile diff adds only the `apps/patchboard` importer. Manual preview for a human check:
`pnpm.cmd -F @ghostsync/patchboard preview` (port 4339, after `build`).

Targeted single runs (for iteration only, never a substitute for the full sequence):

```powershell
pnpm.cmd -F @ghostsync/patchboard exec vitest run tests/write-set.test.ts
pnpm.cmd -F @ghostsync/patchboard exec vitest run tests/kit-integration.test.ts
pnpm.cmd -F @ghostsync/patchboard exec playwright test e2e/two-profile.spec.ts
```

## 6. Follow-ups (outside this milestone)

- Extract a shared service-worker build helper once a third app needs it (decision D-2).
- Drag-and-drop reordering (keyboard controls remain the baseline).
- Conflict history for same-field edits (L-1); persistent-storage request (L-6).
- QR transfer tiers, differential capsules, GhostSync Studio, FieldLedger-built wrong-app fixture (OD-6).

## 7. Requirement to task and test table

| Requirement | Tasks | Pure / Node tests | Browser (Playwright) |
| --- | --- | --- | --- |
| REQ-PB-001 open a board | 2.1, 3.2, 3.4, 4.1, 4.2, 4.11 | U-PB-01, U-PB-20 | E2E-PB-01, 17 |
| REQ-PB-002 identities | 2.1, 2.2, 3.2, 4.2, 4.11 | U-PB-02, U-PB-03, U-PB-20 | E2E-PB-01, 17 |
| REQ-PB-003 session ownership | 3.2, 4.10 | U-PB-13, U-PB-20 | E2E-PB-10, 15 |
| REQ-PB-004 card record | 2.4, 2.8, 2.10, 2.13, 4.4 | U-PB-05, U-PB-08, U-PB-09, U-PB-22 | E2E-PB-03 |
| REQ-PB-005 placement and ordering | 2.3, 2.5, 2.6, 4.4, 4.9 | U-PB-04, U-PB-06, U-PB-07, P-PB-01 to 05 | E2E-PB-03, 09 |
| REQ-PB-006 operations | 2.8, 2.13, 3.2, 3.4, 3.7, 4.2, 4.4, 4.7, 4.8, 4.16 | U-PB-08, U-PB-21, U-PB-22 | E2E-PB-01, 03, 06, 08, 20 |
| REQ-PB-007 merge | 2.9, 2.10, 4.2, 4.3, 4.7, 4.9 | U-PB-09, P-PB-06 to 08 | E2E-PB-01, 02, 06, 07, 09 |
| REQ-PB-008 autosave | 2.11, 3.2, 4.6, 4.11 | U-PB-12 | E2E-PB-05, 17 |
| REQ-PB-009 failure and recovery | 3.2, 3.3, 4.6, 4.10, 4.12 | U-PB-17, U-PB-18 | E2E-PB-05, 13, 14, 15 |
| REQ-PB-010 offline | 1.4, 3.1, 3.5, 4.11, 4.14 | U-PB-16 | E2E-PB-11, 12, 17, 19 (optional) |
| REQ-PB-011 offline reload | 3.4, 4.2, 4.11, 4.16 | none (browser only) | E2E-PB-01, 17, 20 |
| REQ-PB-012 export | 2.12, 3.3, 4.2, 4.6 | U-PB-14 | E2E-PB-01, 05 |
| REQ-PB-013 import | 2.12, 3.3, 4.2, 4.5, 4.6, 4.12, 4.16 | U-PB-15, U-PB-18 | E2E-PB-01, 04, 05, 14, 20 |
| REQ-PB-014 rejection | 2.11, 3.3, 4.5 | U-PB-13 | E2E-PB-04 |
| REQ-PB-015 before and after | 2.7, 4.2 | U-PB-10 | E2E-PB-01 |
| REQ-PB-016 incomplete cards | 2.7, 2.8, 4.8 | U-PB-10, U-PB-11 | E2E-PB-08 |
| REQ-PB-017 accessibility | 2.12, 3.4, 4.4, 4.5, 4.6, 4.8, 4.10, 4.11, 4.12, 4.13, 4.16 | U-PB-19 | E2E-PB-03, 04, 05, 08, 10, 12, 13, 14, 15, 16, 20 |
| REQ-PB-018 security | 3.4, 4.5, 4.8, 4.11, 4.15 | D-PB-01 | E2E-PB-04, 08, 17 |
| REQ-PB-019 packaging | 1.1, 1.2, 4.15, 8.1, 8.3 | D-PB-01 | section 5 |
| REQ-PB-020 failure injection | 4.1, 4.6, 4.15 | D-PB-01 | E2E-PB-05 |
| REQ-PB-021 stale move | 2.8, 3.7, 4.2 | U-PB-08, U-PB-21 | E2E-PB-01 (end-to-end only) |

The AC-level table (every MUST, test and exact observation) is `requirements.md` section 9.

## 8. Final verification

- [x] 8.1 Confirm `git status --short -- packages apps/fieldledger` is empty and the lockfile diff adds only the
  `apps/patchboard` importer. (REQ-PB-019)
- [x] 8.2 Wording review (AC-PB-007-7): after the EVIDENCE NOTES of design 12 are filled in, run
  `git grep -n -i -E "wins|winner|survives|reappear" -- apps/patchboard/src apps/patchboard/README.md` and confirm no
  text promises a delete outcome beyond the recorded shape. (REQ-PB-007)
- [x] 8.3 Fresh-snapshot verification (as FieldLedger task 5.1 and file-capsules task 7.1). From
  `C:\Users\ahmad\ghostsync`, snapshot the CURRENT working source, including untracked files, specs and the
  lockfile, excluding generated builds, `node_modules`, caches and reports:

  ```powershell
  $src  = 'C:\Users\ahmad\ghostsync'
  $snap = Join-Path $env:TEMP ('pb-snapshot-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  robocopy $src $snap /E /XD node_modules dist .git test-results playwright-report .cache .vite coverage .agents .review-artifacts /XF *.tsbuildinfo /NFL /NDL /NJH /NJS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }   # 0 to 7 are success codes
  (Get-FileHash "$src\pnpm-lock.yaml" -Algorithm SHA256).Hash -eq (Get-FileHash "$snap\pnpm-lock.yaml" -Algorithm SHA256).Hash
  (Get-ChildItem $snap -Recurse -File -Force).Count
  Test-Path "$snap\node_modules"; Test-Path "$snap\apps\patchboard\dist"   # both must print False
  Set-Location $snap
  ```

  Then run the section 5 sequence from `$snap` (starting with `pnpm.cmd install --frozen-lockfile`; the first
  `pnpm.cmd install` is not repeated because the lockfile is already final). Record each command, exit code and
  actual totals (unit files and tests, 32 property batches each with `numRuns=50 numSkips=0`, test:dist, Chromium
  passed count) in `docs/progress.md`, including that the lockfile hash matched and the file count. Remove only the
  snapshot directory afterwards (`Remove-Item -Recurse -Force $snap`, after confirming `$snap` starts with
  `$env:TEMP`). Check this task only if every exit code is 0. (REQ-PB-019)
- [x] 8.4 Update `docs/progress.md` from PLANNED to IMPLEMENTED or TESTED only for items whose evidence exists. Keep
  limitations L-1 to L-13 listed. (all)
