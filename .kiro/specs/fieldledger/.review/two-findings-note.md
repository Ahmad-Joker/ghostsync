# Two review findings: failed edit keeps the last good model, capsule metadata shown (2026-11-16)

Scope: `apps/fieldledger/**`, FieldLedger specs, `docs/progress.md`. `packages/**` untouched. Nothing staged, committed or pushed.

## Finding 1: failed edit must not re-read through the incompatible collection
- `SessionController.guard()`: on a throw it sets `editError` (kind from `isSchemaMismatch`), notifies and returns. No `refresh()`. A put validates before it mutates, and on a schema mismatch every collection operation, `listResults()` included, throws, so a re-read adds nothing and used to push the app to the error screen.
- `refresh()` now returns a boolean. A throwing read keeps the last good model, leaves the phase alone, still notifies and never throws. This also covers a later remote-change notification. Schema mismatch at OPEN (`open()`) is unchanged and still shows the error screen.
- View: when an edit error appears, fields are redrawn from the model even if one is focused, so an unapplied draft is not left looking applied.
- Backup: `buildCapsule()` uses `session.exportState()` (Kit `replica.exportState()`), which does not use the collections. Verified in E2E-FL-20.
- Tests: unit "edit AND listResults both reject with a schema mismatch" in `tests/edit-error.test.ts`; Chromium E2E-FL-20.
- E2E-FL-20 makes the mismatch real with no production hook: a Node-built capsule (the page's stored state plus the Kit meta key for both collections at schemaVersion + 1, same app/entityType, written with the Kit's own Yjs) is imported through the file input. The Kit does not check schema on apply, so the import succeeds (applied-saved) and later collection operations throw the real Kit error. Backup is decoded with test-local higher-version adapters.

## Finding 2: capsule metadata in ImportView (AC-FL-013-7)
- `ImportView.metadata?: CapsuleMetadata`, set for applied-saved and applied-unsaved, kept by the retry transition (same object), absent for rejected and importing.
- `src/transfer/capsule-meta.ts`: `capMetaValue` (80 or fewer kept; longer shown as 79 code points + "…", 80 shown) and `metaLines`.
- View: `<dl data-testid="import-meta">` in the import result with `import-meta-app` ("Capsule app"), `import-meta-document-id` ("Document"), `import-meta-created-at` ("Created"), all textContent.
- Tests: `tests/import-metadata.test.ts` (8); `expectImportMeta` in E2E-FL-05 (applied-unsaved and after retry), E2E-FL-07 (file-exchange), the two-profile import; no-metadata assertion in the rejection spec.

## Results (working tree)
- typecheck exit 0.
- unit: 15 files / 78 tests passed (before 14 / 69); 20 property batches `numRuns=50 numSkips=0 PASS`; no timeouts.
- build exit 0; test:dist 1 file / 4 tests passed.
- Chromium `test:e2e`: 20 passed (before 19), exit 0.
- No flake seen. One early targeted run hit "port 4329 already used" right after an interrupted run; rerun was clean.