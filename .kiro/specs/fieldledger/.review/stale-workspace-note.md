# Stale workspace import note (2026-11-16)

Problem: after a capsule was applied, a failed refresh() left model unchanged, so the diff was empty and the UI said 'No changes'.

Rule: importFile() uses refresh()'s boolean. On false: ImportView.workspaceStale = true, diff omitted, notice rendered in the import result (data-testid import-stale-notice) with a Download backup capsule button. Save result, metadata and backup stay. Retry save keeps the flag (spread) and the absent diff. Refresh success: unchanged.

Tests: tests/import-metadata.test.ts (+3), e2e E2E-FL-20 extended.

Results: typecheck 0; unit 15 files / 81 tests; full Chromium 20 passed; E2E-FL-20 passed.
