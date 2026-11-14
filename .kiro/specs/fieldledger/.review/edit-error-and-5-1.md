# Edit-error visibility fix and task 5.1 (2026-11-15)

Uncommitted. Original review files and the earlier impl-review files are unchanged.

## Defect
`SessionController.guard()` stored `errorMessage` when an edit threw in the ready phase, but only the
error and in-use screens render it. A failed edit was silent (ui.md: actionable errors).

## Patch (apps/fieldledger only, plus specs and docs)
- `src/session/session-controller.ts`: new `editError` (kind + title + message); `guard()` sets it on a throw, clears it on a successful edit; `dismissEditError()`; reset on open and on return to join. Phase, `save` and `importView` are untouched.
- `src/state/errors.ts`: `mapEditError(kind)`, kinds `schema-mismatch` and `unexpected`.
- `src/ui/app-view.ts`: `[data-testid="edit-error-alert"]` (`role="alert"`, `data-edit-error-kind`) in the workspace below the save alert, with Dismiss, Download backup capsule (existing export path) and, for schema-mismatch, Reload app. Rebuilt only when the error changes; Dismiss returns focus to the title input (or the new-item input).
- Copy: heading "Your edit was NOT applied"; unexpected: "Something went wrong while applying your last edit, so it was not made. You can try the edit again, or reload the page. If it keeps happening, download a backup capsule first."; schema-mismatch: "This device's FieldLedger version cannot edit data written with a newer schema. ... Reload the app to get the latest version. You can download a backup capsule first."
- Tests: `tests/edit-error.test.ts` (5 unit tests), E2E-FL-19 in `e2e/session-lifecycle.spec.ts`.
- Specs: AC-FL-009-10, task 4.10, E2E-FL-19, traceability rows.

## Regression mechanism (and why not the schema-mismatch one)
A newer-schema meta record cannot keep the phase `ready`: the Kit re-checks the schema on every read, so
`refresh()` fails and the error screen shows. Also a permissive adapter's over-long record is read as
invalid, so it cannot be edited. The test instead sets the title input to 121 characters through the DOM
(bypassing `maxlength`, as paste or autofill can) and fires `change`. The app's `validate()` rejects the
put, reads still work, `guard()` catches it. No production failure hook was added. The schema-mismatch
kind is covered by the unit test only (stubbed put with the Kit's message prefix).

## Results
See docs/progress.md, section "FieldLedger edit-error fix and task 5.1", for the per-step table.

Results were appended to docs/progress.md (same date).
