# PatchBoard spec: correction pass 1

Scope: one targeted pass over `requirements.md`, `design.md`, `tasks.md` and `docs/progress.md`. Nothing was built, run, installed, staged or committed. Every test is PLANNED; none has run. The original review (`consistency-review.md`, verdict CHANGES_REQUESTED) and `consistency-verdict.json` are preserved unchanged.

## Resolutions

| Finding | What changed | Where |
| --- | --- | --- |
| M1 keyboard coverage | Action inventory A-01 to A-23, each mapped to a named scenario step that focuses the control and presses Enter or Space, and to the observable result. Restore, Discard (with confirm and keep), Change board, Update now, Retry save, Dismiss, Reload app, Try again, Open a different board and the others now use keyboard activation in E2E-PB-03, 04, 05, 08, 10, 12, 13, 14, 15. The file chooser (A-12) is marked "reachability asserted, chooser dialog not driven"; `setInputFiles` drives the import. | requirements AC-PB-017-1, 017-2 and their rows; design 9.1, 13.5, 13.5.1, 13.5.2; tasks 3.4, 4.1, 4.4 to 4.12 |
| L2 names | One scheme `<Action>: <card label>` (label = stored title, else card ID for an incomplete card). Bare "Restore" and "Discard" removed. | AC-PB-017-2, 006-5, 006-7, 016-3, 016-4; design 5.5, 5.6, 9.1 |
| M2 draft survives refresh | New E2E-PB-20: saved board with X and Y, uncommitted focused draft in A, B edits Y and exports a real capsule, A imports with `setInputFiles`; asserts focus, refresh (`data-board-revision`, Y text, import result), draft still uncommitted, keyboard Save card, offline reload keeps both edits. `data-board-revision` and draft preservation added to the UI contract. | AC-PB-006-8 and row; design 9.1, 9.3, 13.5.3; tasks 3.4, 4.16 |
| M3 failed precache | Test-server fixture (`POST /__test/fail-asset`, `GET /__test/request-log`, `POST /__test/reset`) in `e2e/static-server.mjs` replaces `context.route`. Fresh context; asserts the install fetch of the failing URL is in the log, `ready` is never observed, final state `failed`, offline reload rejects. Old-worker-keeps-serving case stated as not covered. | AC-PB-010-3 and row; design 13.1, 13.5.2, D-14; tasks 3.5, 4.11, 4.15 |
| M4 stale move on the production path | New U-PB-21 `tests/controller-stale-move.test.ts`: real controller, rendered model older than the store, `move`, `reorder`, `saveCard` with a card ID, put spy, and a naive controller-model writer as negative control. Seam: members filled by cast (as FieldLedger's `edit-error.test.ts`), no subscribe, no production code added. A throwing `listResults` was rejected because the move reads `listResults()` itself. "Honest limit" rewritten; E2E-PB-01 is end-to-end only. | REQ-PB-021 and rows; design 8.1, 13.3, 13.3.1, D-15; tasks 3.7 |
| L1 fixture | `card-ok1` is `todo\|00001024`; E2E-PB-08 fixture table and Discard steps 4a to 4c written out. | design 13.5 (E2E-PB-08) |
| L3 tasks table | Section 7 lists every 4.x task and 2.10, 2.13, 3.7 where relevant. | tasks section 7 |
| L4 unknown fields | Write-set claims scoped to supported fields. Real Kit: `put` deletes stored fields the adapter omits; `fromFields` ignores extras, so such a card reads as valid. Chosen behavior: not preserved, not flagged, dropped by any write. New AC-PB-004-7, U-PB-22 (planned), L-7 rewritten. | requirements 6, L-7; design 5 intro, 5.7, D-13; tasks 2.13 |
| L5 500-card MUST | AC-PB-004-6 retired (ID not reused), "limit" outcome, `maxValidCards`, limit message, OD-8, its test and its row removed. L-11 is a one-line SHOULD. | requirements, design 3, 5, 9.2, tasks 2.8 |
| L6 planned wording | Tests described as planned; progress.md "proves detection" changed to "is planned to detect"; design 13.3 wording softened. | progress.md; design 13.3 |

## Original review files (byte-identical check)

| File | Length | SHA-256 (before and after) |
| --- | --- | --- |
| `consistency-review.md` | 7438 | A9286F2D0DB512A10CA82356A2664E0B421827F743BC144A2B0A5CF47D672E24 |
| `consistency-verdict.json` | 3095 | 22F3D55D262ABB69D43440D2A66EE49740704FB1D9601489C779D5591E025FB7 |
