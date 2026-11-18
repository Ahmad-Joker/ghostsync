# FieldLedger MVP: Tasks

Status: every task below is PENDING (31 tasks). Nothing in this file has been implemented, built or run.
Corrections from review findings F-1 to F-5, F-7, F-9, F-10 and F-11 were applied in correction pass 1
(`.review/correction-1-note.md`); F-6 and F-8 are intentionally left open.
Baseline `916165f`, branch `feat/fieldledger`. Requirement IDs refer to `requirements.md`;
design sections refer to `design.md`.

Rules for the implementer:

- Only `apps/fieldledger/**`, `pnpm-lock.yaml` (via install), `.kiro/specs/fieldledger/**` and
  `docs/progress.md` may change. `packages/**` must not change (REQ-FL-018).
- Use `pnpm.cmd` (never `pnpm`, `npm` or `yarn`). Do not add packages beyond those in design
  section 13.
- Do not add `test.skip`, `test.fixme`, retries or timeout overrides.
- Record each command, exit code and actual test totals in `docs/progress.md` when implementing.
  Do not mark a task complete without that evidence.

## 1. Package and tooling

- [x] 1.1 Update `apps/fieldledger/package.json`: `type: module`, scripts (`typecheck`, `test`,
  `build`, `test:dist`, `preview`, `test:e2e`), `dependencies` on `@ghostsync/{capsule,kit,persist}`
  as `workspace:*`, and `devDependencies` with the exact pins in design section 13. Then run
  `pnpm.cmd install` (changes `pnpm-lock.yaml`), inspect that the lockfile diff only adds the
  `apps/fieldledger` importer, and run `pnpm.cmd install --frozen-lockfile`. (REQ-FL-018)
- [x] 1.2 Add `apps/fieldledger/tsconfig.json` (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `module/moduleResolution NodeNext`, `lib ES2022 + DOM`,
  `verbatimModuleSyntax`, `types ["node"]`, include `src`, `tests`, `e2e`, configs). No `paths`
  alias: the app resolves the built package entries. (REQ-FL-018)
- [x] 1.3 Add `vitest.config.ts` (node, include `tests/**/*.test.ts`, exclude `dist-scan`),
  `vitest.dist.config.ts` (include `tests/dist-scan.test.ts`), `vitest.setup.ts`
  (`fc.configureGlobal({ numRuns: 200, seed: 424242 })`, same as `packages/capsule/vitest.setup.ts`;
  the batches override `numRuns` and `seed` per call), and `tests/fc-report.ts` (a mirror of
  `packages/capsule/tests/fc-report.ts`, named WITHOUT `.test.ts` so it is not collected; prints
  `result seed numRuns numSkips numShrinks` and, on failure, the original error, counterexample and
  `replay: seed=<seed> path=<path>`). Keep the default 5 s timeout: no `testTimeout`,
  `hookTimeout`, retries or skips. Batching rules for every property are in design 14.6.
  (REQ-FL-018)
- [x] 1.4 Add `vite.config.ts` (`root` the app directory, `base: "./"`, `build.outDir "dist"`,
  `target es2022`, plugin `swPrecachePlugin()`), `index.html`, and `scripts/sw-precache-plugin.ts`
  as the adapted copy of `packages/persist/scripts/sw-precache-plugin.ts` (new
  `CACHE_PREFIX = "ghostsync-fieldledger-"`, no failing test worker, source and baseline commit
  noted in a header comment). (REQ-FL-010, 018; decision D-2)

## 2. Pure model and identity

- [x] 2.1 `src/config.ts`: `APP_ID`, `DB_NAME`, `MAX_BYTES`, field limits, `SORT_STEP = 1024`.
  (REQ-FL-002, 004, 007)
- [x] 2.2 `src/identity/document-id.ts`: `normalizeDocumentId`, `validateDocumentId`
  (`^[a-z0-9][a-z0-9._-]{2,63}$`), `parseRoute`, `formatRoute`. Test first:
  `tests/document-id.test.ts`. (REQ-FL-001)
- [x] 2.3 `src/identity/replica-id.ts`: `KeyValueStore`, `replicaStorageKey`,
  `getOrCreateReplicaId`. Test: `tests/replica-id.test.ts` with an in-memory store (stable reopen,
  distinct per document, malformed value regenerated). (REQ-FL-002, 003)
- [x] 2.4 `src/model/ids.ts` (`newItemId(randomUUID)` returns `ci-<uuid>`). Test:
  `tests/ids.test.ts`. (REQ-FL-002)
- [x] 2.5 `src/model/adapters.ts`: types, `INCIDENT_RECORD_ID`, `incidentAdapter`,
  `checklistItemAdapter` with `validate`, `toFields`, `fromFields` as in design 3.2. Test:
  `tests/adapters.test.ts` (round trip, every invalid input, partial fields throw, bounds,
  `toFields` emits exactly the declared keys). (REQ-FL-004)
- [x] 2.6 `src/model/ordering.ts`: `compareItems`, `sortEntries`, `nextSortKey`, `keyBetween`,
  `renormalize`. Tests: `tests/ordering.test.ts` including the ORD-FIX-1 case: write the eight
  fixture entries of design 14.4.1 (scrambled order, then reversed) into `sortEntries` and assert
  `.map(([id]) => id)` equals, by `toEqual`, the hand-written literal
  `["ci-e5","ci-d4","ci-B2","ci-a","ci-a1","ci-b2","ci-c3","ci-f6"]`, and with the two extra entries
  (`ci-n1`, `ci-n2`, both `sortKey` 5120) the literal
  `["ci-e5","ci-d4","ci-B2","ci-a","ci-a1","ci-b2","ci-c3","ci-f6","ci-n1","ci-n2"]`. The test must
  NOT call `compareItems` or another app helper to build the expectation.
  `tests/ordering.property.test.ts`: 3 properties (permutation invariance, total order, renormalize
  preserves relative order), each as 4 named batch tests of exactly 50 cases with seeds 424242,
  424243, 424244, 424245, `numRuns === 50` and `numSkips === 0` asserted per batch, an `afterAll`
  proving 4 x 50 = 200 per property, reporting through `tests/fc-report.ts`, default 5 s timeout, no
  overrides. Expected: 12 batch tests (design 14.6). (REQ-FL-005)
- [x] 2.7 `src/model/read-model.ts`, `src/model/write.ts` (`commitIncidentField`,
  `commitItemField`, `addItem`, `moveItem`, `restoreItem`, `discardItem`, `createIncident`) over
  the `GuardedCollection` interface, and `src/model/diff.ts`. Tests: `tests/diff.test.ts`,
  `tests/kit-integration.test.ts` using real `createKit` replicas (changed-fields only, merge
  outcomes of requirements section 5 except delete versus edit, a partial-adapter record becomes an
  `invalidRecord`, schema mismatch recognized), and `tests/kit-integration.property.test.ts`:
  2 properties (replicas equal after exchange; every surviving field value was submitted by some
  op), each as 4 named batch tests of exactly 50 cases with seeds 424242 to 424245, `numRuns === 50`
  and `numSkips === 0` asserted per batch, an `afterAll` proving 200 per property, reporting through
  `tests/fc-report.ts`, bounded generators (design 14.6), default 5 s timeout, no overrides.
  Expected: 8 batch tests. The whole suite must also pass under default full-suite parallel load.
  (REQ-FL-004, 005, 006, 015)
- [x] 2.8 `src/state/save-label.ts` and `src/state/errors.ts` (`mapPersistError`,
  `mapCapsuleError`, `mapSaveError`, `isSchemaMismatch`). Tests: `tests/save-label.test.ts`,
  `tests/errors.test.ts` (every `CapsuleErrorCode`, every `PersistenceErrorCode`, TypeError,
  read failure, copy contains "Nothing was changed."). (REQ-FL-008, 009, 014)
- [x] 2.9 `src/transfer/filename.ts`, `src/offline/status-copy.ts`. Tests: `tests/filename.test.ts`,
  `tests/status-copy.test.ts`. (REQ-FL-010, 012)

- [x] 2.10 CHARACTERIZATION FIRST, before E2E-FL-08 is written: in `tests/kit-integration.test.ts`, with
  two real `createKit` replicas and the app adapters, delete record Q on one and concurrently edit
  its EXISTING `text` field on the other, exchange both ways, and assert only (a) both decoded states
  are deep-equal and (b) Q's shape is one of: absent; valid with the edited text; `invalidRecord`
  (design 5.1). Log the observed shape and record it in the EVIDENCE NOTE of design 5.1 and below
  BEFORE any document or UI copy says which edit wins. A result outside (a) and (b) is a Kit finding
  to report, not to hide. (REQ-FL-006)
  EVIDENCE NOTE (recorded 2026-11-14 at implementation; see design 5.1): observed shape (iii). Q is returned
  by `listResults()` as `invalidRecord` on BOTH profiles with identical preserved `fields` =
  `{"text":"Check valve seat"}` (the delete removed the other leaf keys; the concurrent edit of the
  existing field survived). Same result at Kit level (`tests/kit-integration.test.ts`) and in Chromium
  (E2E-FL-08); decoded states were deep-equal, so there is no Kit convergence finding. Kit baseline 916165f.

## 3. Browser modules

- [x] 3.1 `src/offline/sw-register.ts`: adapted copy of the harness registration. Sets
  `html[data-offline-state]` and `[data-offline-ready]`, exposes a subscribe callback, exposes no
  `window` global. Keep the controlled-plus-complete-precache rule and `GHOSTSYNC_SKIP_WAITING`
  explicit update. (REQ-FL-010, 011)
- [x] 3.2 `src/session/session-controller.ts`: resolve document and replica, call `openReplica` with
  the options in design 6.2, open both collections inside a guard that disposes the session on
  failure, subscribe, expose the save store, `retrySave()` (`flush()`), `close()`, `dispose()`,
  open-failure mapping, `beforeunload` guard only in `error`. (REQ-FL-003, 007, 008, 009)
- [x] 3.3 `src/transfer/export.ts` and `src/transfer/import.ts` as in design 9.1 and 9.2
  (`File.size` check before `arrayBuffer()`, one import at a time, input reset after handling,
  `decodeCapsule` only for naming a mismatched identity, capture before and after read models).
  (REQ-FL-012, 013, 014, 015, 017)
- [x] 3.4 `src/ui/*` views with `h()` (textContent only, keyed list rows, no overwrite of a focused
  draft), `src/styles.css` (focus-visible outline of exactly 3 px, responsive grid with no horizontal scroll at
  320 px, reduced motion), `src/main.ts`.
  Expose only the `data-*` attributes and `data-testid` values listed in design 10.1. (REQ-FL-001, 003,
  004, 005, 008, 009, 010, 015, 016)
- [x] 3.5 Add the sub-path static server `e2e/static-server.mjs` (adapted copy of
  `packages/persist/e2e/static-multiscope-server.mjs`, serving `/` and `/deploy-fl/`, port 4329, no new
  package) with the test-only `POST /__test/sw-bump` endpoint (design 14.3), and
  `playwright.config.ts` (`timeout 30_000`, `expect.timeout 10_000`, `workers 1`, `retries 0`,
  chromium). (REQ-FL-010, 011)
- [x] 3.6 `README.md` for the app: build order, run, offline limits (first online visit required,
  localhost or HTTPS), file transfer, "integrity not authentication", out-of-scope list.
  (REQ-FL-010, 017)

## 4. Acceptance tests (write after the app builds)

- [x] 4.1 `e2e/helpers.ts`: context factory, `awaitOfflineReady` (bounded 20 s on
  `data-offline-ready`), `readStoredRecords` (raw `indexedDB` readonly `getAll` on `replicas`),
  `decodePersisted` (real `createKit` plus app adapters in Node), capsule file builders for
  rejection cases and for the fixtures ORD-FIX-1 (`ord-base`, `ord-a`, `ord-b`) and `incomplete`
  (partial adapter), the test-owned `addInitScript` helpers (write-abort injector and the file-read
  gate `holdNextFileRead`/`releaseFileRead`), a same-origin request recorder. (REQ-FL-019; design
  14.2, 14.3, 14.4.1)
- [x] 4.2 `e2e/two-profile.spec.ts`: E2E-FL-01. (REQ-FL-001, 002, 003, 008)
- [x] 4.3 `e2e/offline-reload.spec.ts`: E2E-FL-02 (including the network chip and transfer-mode
  assertions), E2E-FL-10, E2E-FL-15 (waiting worker and "Update now"), optional E2E-FL-11.
  (REQ-FL-010, 011)
- [x] 4.4 `e2e/file-exchange.spec.ts`: E2E-FL-03 (real downloads, `setInputFiles`, convergence,
  duplicate import), E2E-FL-07 (ordering against the literal ORD-FIX-1 sequences, never via
  `compareItems`), E2E-FL-08 (delete versus edit of an existing field, CHARACTERIZATION: write it
  only after task 2.10 recorded the observed Kit outcome), E2E-FL-17 (input disabled while an import
  runs), E2E-FL-18 (invalid record rendering and explicit Restore). (REQ-FL-004, 005, 006, 012, 013,
  015)
- [x] 4.5 `e2e/rejection.spec.ts`: E2E-FL-04 (six rejected files, no mutation in UI or stored
  record). (REQ-FL-013, 014, 017)
- [x] 4.6 `e2e/save-failure.spec.ts`: E2E-FL-05 (applied but not saved, backup download, retry,
  reload). (REQ-FL-008, 009, 012, 019)
- [x] 4.7 `e2e/session-and-keyboard.spec.ts`: E2E-FL-06 (second tab, StorageInUse; wait by READING
  `navigator.locks.query()` until the lock is released, then click "Try again" EXACTLY ONCE and
  await `html[data-session="ready"]` with the normal `expect` timeout), E2E-FL-09 (keyboard only,
  `outline-width` exactly `3px`), E2E-FL-16 (320 px, no horizontal scroll). Every action in every
  scenario is clicked once and then awaited; no click inside `expect.poll`, no click loop.
  (REQ-FL-003, 016)
- [x] 4.8 `tests/dist-scan.test.ts` and the `test:dist` script: no `armWriteAbortOnce`,
  `holdNextFileRead`, `releaseFileRead`, `__ghostsyncTest`, no `window.__`, no inline script if a CSP
  meta is present. (REQ-FL-017, 019)
- [x] 4.9 `e2e/session-lifecycle.spec.ts`: E2E-FL-12 (change incident, failed close, discard),
  E2E-FL-13 (page hide commits a focused draft), E2E-FL-14 (failed edit save alert and the
  `beforeunload` guard only in `error`). (REQ-FL-001, 007, 008, 009)
- [x] 4.10 (added 2026-11-15) Edit-error visibility, AC-FL-009-10: `editError` on `SessionController`,
  `mapEditError` in `src/state/errors.ts`, the `edit-error-alert` in the workspace, `tests/edit-error.test.ts`
  (unit) and E2E-FL-19 in `e2e/session-lifecycle.spec.ts`. (REQ-FL-009)

- [x] 4.11 (added 2026-11-16) Review fixes: failed edit keeps the last good model with no re-read (unit test in
  `tests/edit-error.test.ts`, E2E-FL-20), and capsule metadata is carried through `ImportView` and shown
  (AC-FL-013-7, `tests/import-metadata.test.ts`, `expectImportMeta` in the import E2E tests). Results:
  `.review/two-findings-note.md`. (REQ-FL-009, REQ-FL-013)
## 5. Verification order (future; run once each, in this order, from `C:\Users\ahmad\ghostsync`)

Do not run these in the planning step. Record exit codes and totals when implementing.

```powershell
pnpm.cmd install
pnpm.cmd install --frozen-lockfile
pnpm.cmd -F @ghostsync/kit build
pnpm.cmd -F @ghostsync/capsule build
pnpm.cmd -F @ghostsync/persist build
pnpm.cmd -F @ghostsync/fieldledger typecheck
pnpm.cmd -F @ghostsync/fieldledger test
pnpm.cmd -F @ghostsync/fieldledger build
pnpm.cmd -F @ghostsync/fieldledger test:dist
pnpm.cmd -F @ghostsync/fieldledger exec playwright install chromium   # only if Chromium is missing
pnpm.cmd -F @ghostsync/fieldledger test:e2e
# regression of untouched packages
pnpm.cmd -F @ghostsync/kit test
pnpm.cmd -F @ghostsync/capsule test
pnpm.cmd -F @ghostsync/persist test
git status --short -- packages
git diff --stat -- pnpm-lock.yaml
```

Expected: every exit code `0`; `git status --short -- packages` prints nothing; the lockfile diff
shows only the new importer. Manual preview for a human check:
`pnpm.cmd -F @ghostsync/fieldledger preview` (port 4329, after `build`).

- [x] 5.1 Run the sequence in a clean checkout or a fresh source snapshot that includes the new
  untracked files (as file-capsules task 7.1 did), and record all exit codes and totals.
  (REQ-FL-018)
- [x] 5.2 Update `docs/progress.md` from PLANNED to IMPLEMENTED/TESTED only for items whose evidence
  exists. Keep limitations L-1 to L-10 listed. (all)

## 6. Follow-ups (outside this milestone, not tasks to implement now)

- Extract a shared service-worker build helper once PatchBoard needs it (decision D-2).
- Request persistent storage and show eviction risk (D-10, L-6).
- Conflict history for same-field edits (L-1).
- QR transfer tiers, differential capsules, PatchBoard, Studio.

## 7. Requirement to test traceability

| Requirement | Pure / Node tests | Browser (Playwright) |
| --- | --- | --- |
| REQ-FL-001 open by document ID | `document-id.test.ts` | E2E-FL-01, 02, 09, 12 |
| REQ-FL-002 stable identities | `replica-id.test.ts`, `ids.test.ts` | E2E-FL-01 (replica IDs distinct, record identity), E2E-FL-02 (same replica after reload) |
| REQ-FL-003 distinct replicas, one owner | `replica-id.test.ts`, `errors.test.ts` | E2E-FL-01, E2E-FL-06 |
| REQ-FL-004 data model, invalid records | `adapters.test.ts`, `kit-integration.test.ts`, `errors.test.ts` | E2E-FL-03, E2E-FL-08 (characterization), E2E-FL-18 |
| REQ-FL-005 checklist and ordering | `ordering.test.ts` (ORD-FIX-1 literals), `ordering.property.test.ts`, `kit-integration.test.ts` | E2E-FL-07 (ORD-FIX-1 literals), E2E-FL-09 |
| REQ-FL-006 merge behavior | `kit-integration.test.ts` (incl. task 2.10 characterization), `kit-integration.property.test.ts` | E2E-FL-03, 07, 08 |
| REQ-FL-007 startup and session | `errors.test.ts`, `save-label.test.ts` | E2E-FL-01, 02, 06, 12, 13 |
| REQ-FL-008 autosave feedback | `save-label.test.ts` | E2E-FL-01, 02, 05 |
| REQ-FL-009 save failure and recovery | `errors.test.ts`, `save-label.test.ts` | E2E-FL-05, E2E-FL-14 |
| REQ-FL-009 edit-error visibility (AC-FL-009-10, added 2026-11-15) | `tests/edit-error.test.ts` | E2E-FL-19 |
| REQ-FL-010 offline readiness | `status-copy.test.ts` | E2E-FL-02, 10, 11, 15 |
| REQ-FL-011 offline reload and keep working | none (browser only) | E2E-FL-02 |
| REQ-FL-012 export | `filename.test.ts` | E2E-FL-03, 05, 09 |
| REQ-FL-013 import | `errors.test.ts` | E2E-FL-03, 04, 17 |
| REQ-FL-014 rejection without mutation | `errors.test.ts` | E2E-FL-04 |
| REQ-FL-015 before and after view | `diff.test.ts` | E2E-FL-03, 08 |
| REQ-FL-016 accessibility, responsive | `save-label.test.ts` (roles) | E2E-FL-09, E2E-FL-16 (plus manual checklist, L-10) |
| REQ-FL-017 security and privacy | `errors.test.ts`, `dist-scan.test.ts` | E2E-FL-01 (same-origin requests), E2E-FL-04 |
| REQ-FL-018 packaging and order | none | section 5 verification sequence |
| REQ-FL-019 test-only failure injection | `dist-scan.test.ts` | E2E-FL-05 |

Persisted-state evidence per browser scenario is defined in design 14.4 (raw IndexedDB read of the
Persist record plus Kit decode in Node). A Node mock alone is never used to claim browser persistence.

## 7A. Acceptance-criterion to test and observation (MUST criteria found uncovered by review F-1)

Mirror of requirements.md section 9 (the scenarios in design 14.4 define the steps). Selectors are in design
10.1. All tests are PLANNED. None has run.

| AC | Named test (task) | Exact observation |
| --- | --- | --- |
| AC-FL-001-7 | E2E-FL-12 (4.9) | Success: click `[data-testid="change-incident"]`, `html[data-session]` = `join`, raw record `sequence` = the `data-save-sequence` shown before. Failed close (abort armed, edit, `data-save-state="error"`): `html[data-session]` = `recovery`, `main[data-document-id]` unchanged, `[data-testid="recovery-panel"]` has "Download backup capsule" and "Discard unsaved changes and switch", no join form. Backup decodes with the edit. After Discard: `join`. Reopen: raw `sequence` = pre-edit, model lacks the edit |
| AC-FL-007-4 | E2E-FL-13 (4.9) | `fill` a draft in `input[aria-label="Item text"]` without blur, dispatch `pagehide` (and a second draft with `visibilitychange` hidden): `save-indicator` reaches `data-save-state="saved"` with larger `data-save-sequence`, raw record decodes to the draft text (and did not contain it before). No-durability-claim half: `save-label.test.ts` |
| AC-FL-009-7 | E2E-FL-14 (4.9) | In `error`, `page.close({ runBeforeUnload: true })` raises a `beforeunload` dialog (dismissed, `page.isClosed()` false). After one click on "Retry save" and `data-save-state="saved"`, the same call raises no dialog and the page closes |
| AC-FL-009-9 | E2E-FL-14 (4.9) | `[data-testid="save-error-alert"]` `role=alert`, `data-save-error-kind="edit"`, `data-save-error-code="TransactionAbortError"`, contains "Your latest changes are NOT saved to this device." and the AC-FL-009-4 sentence, not "Capsule applied"; `import-result` has no `applied-unsaved`; raw record `sequence` and bytes unchanged and model lacks the edit; after Retry the model contains it |
| AC-FL-010-8 | E2E-FL-15 (4.3) | After `POST /__test/sw-bump` and an online reload: `html[data-offline-state="waiting"]`, `[data-testid="update-banner"]` text "A new version is ready. Save your work, then update." plus "Update now", `registration.waiting` non-null, `performance.timeOrigin` unchanged. One click on "Update now": `timeOrigin` changes, `data-offline-state="ready"`, `waiting` null, same decoded model |
| AC-FL-010-9 | E2E-FL-02 (4.3) | `[data-testid="network-chip"]` text "Network: online" then "Network: offline" after `setOffline(true)` (and after the offline reload); `[data-testid="transfer-mode"]` text "Transfer: file (.gscap)" |
| AC-FL-013-6 | E2E-FL-17 (4.4) | With `holdNextFileRead()` set and `setInputFiles` done: `[data-testid="import-input"]` `toBeDisabled()`, `import-result` `data-import-state="importing"`, raw `sequence` unchanged. After `releaseFileRead()`: enabled, `applied-saved`, input `value` empty, `sequence` larger |
| AC-FL-016-4 | E2E-FL-16 (4.7) | Viewport 320 x 640 and 1280 x 800 with a 200-character item and an import result: `documentElement.scrollWidth - clientWidth <= 0` and no element in `main` extends past 320.5 px outside an `overflow-x: auto` ancestor |
| AC-FL-009-10 (added 2026-11-15) | E2E-FL-19 (4.10), `tests/edit-error.test.ts` | Edit throws in `ready`: `[data-testid="edit-error-alert"]` visible, `role=alert`, `data-edit-error-kind="unexpected"`, "Your edit was NOT applied"; `html[data-session]` stays `ready`, inputs and checklist enabled; `save-indicator` stays `saved` with the same `data-save-sequence`; no `save-error-alert`, no import state; raw record `sequence` and bytes unchanged; one backup click downloads a decodable capsule; one Dismiss click removes the alert. Unit: `guard()` with a throwing put sets `editError` kind, keeps phase `ready` and `save`; schema-mismatch maps to its own kind |

Coverage statement. The eight criteria listed in review F-1 (AC-FL-001-7, AC-FL-007-4, AC-FL-009-7, AC-FL-009-9,
AC-FL-010-8, AC-FL-010-9, AC-FL-013-6, AC-FL-016-4) each map to a named test and an exact observation above.
Downgraded: none. This claim covers those eight. The other MUST criteria keep the requirement-level mapping in
section 7. A full AC-by-AC audit of them was not part of this pass.

## 8. Planned test inventory (none has run)

Pure / Node (Vitest): `document-id`, `replica-id`, `ids`, `adapters`, `ordering`,
`ordering.property`, `kit-integration` (including the task 2.10 characterization),
`kit-integration.property`, `save-label`, `errors`, `filename`, `diff`, `status-copy`; post-build
`dist-scan`. Helper `tests/fc-report.ts` is not a test file.

Property batching (design 14.6): every property = 4 named batch tests x exactly 50 cases, seeds
424242, 424243, 424244, 424245, `numRuns === 50` and `numSkips === 0` per batch, `afterAll` total
200 per property, default 5 s timeout, no overrides. `ordering.property` = 3 properties x 4 = 12
batch tests; `kit-integration.property` = 2 properties x 4 = 8 batch tests; 20 batch tests and
1000 generated cases in total.

Browser (Playwright, Chromium): E2E-FL-01 two profiles; E2E-FL-02 offline reload (with network
chip); E2E-FL-03 file exchange; E2E-FL-04 rejection without mutation; E2E-FL-05 save failure and
recovery; E2E-FL-06 second tab; E2E-FL-07 ordering against literal ORD-FIX-1 sequences; E2E-FL-08
delete versus edit of an existing field (characterization); E2E-FL-09 keyboard; E2E-FL-10 first
offline visit fails honestly; E2E-FL-11 sub-path (optional); E2E-FL-12 change incident and failed
close; E2E-FL-13 page hide commits a draft; E2E-FL-14 failed edit save and `beforeunload` guard;
E2E-FL-15 waiting worker and "Update now"; E2E-FL-16 320 px layout; E2E-FL-17 import input
disabled while importing; E2E-FL-18 invalid record rendering and Restore. None has run.

## Implementation status, 2026-11-14 (checkboxes reflect actual runs; see `.review/impl-run-log.md`)

- Implemented and unit-tested: tasks 1.x and 2.x (64 Vitest tests, 5 properties x 4 batches x 50 runs, all PASS with numRuns 50 and numSkips 0 per batch).
- Browser-verified in real Chromium: 18 Playwright tests (E2E-FL-02, 04 to 09, 10, 11 optional, 12 to 18, plus the merged FL-01/03 two-profile journey). 3.x and 4.x are checked on that evidence.
- E2E-FL-08 observed shape: `invalidRecord` on both profiles, preserved `fields` = `{"text":"Check valve seat"}` (design 5.1 evidence note).
- 2026-11-15: edit-error visibility added (AC-FL-009-10, task 4.10, E2E-FL-19). See `.review/edit-error-and-5-1.md`.
- Task 5.1 was unchecked after the first run (working tree only). 2026-11-15: checked after the full sequence passed from a fresh snapshot, see `.review/edit-error-and-5-1.md`.
- UNVERIFIED: clean-checkout run; Kit event delivery for remote applies (A4); real quota exhaustion; Firefox/WebKit (Chromium only).
- 2026-11-16: stale-workspace import notice. Unit tests in `tests/import-metadata.test.ts` (success path unchanged; refresh fails with applied-saved; applied-unsaved then Retry keeps flag, no diff, same metadata). E2E-FL-20 extended (notice, metadata, no 'No changes', backup button, notice survives the later edit alert). See `.review/stale-workspace-note.md`.
