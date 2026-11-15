# Resolution of the QR transfer spec review

Original review (`review.md`, `review.json`, verdict CHANGES_REQUESTED) is unchanged. Edits are in `requirements.md`, `design.md` and `tasks.md`. Nothing was committed or staged. No byte-limit figure was changed: the 1232 / 1853 / version 25 arithmetic is untouched, and the new per-rung class ranges below were checked against it (below).

## MEDIUM findings
| ID | Resolution |
| --- | --- |
| M1 | Design 8.3: `importScanned` step 2 re-checks `hasAppliedQr`; step 3 records the sha256 in a synchronous `inFlightQr` set (read by `hasAppliedQr`, cleared on settle); the held capsule stays when `importPending`. The scan button is disabled while importing and `startScan` is a no-op then (design 8.3, 9.2). AC-QR-008-4 and its test row now require this; unit and E2E-QR-05 observations added (`qr-scan-btn` disabled, rescan gives `already-imported`, `data-save-sequence` +1). tasks 5.4 lists the cases. |
| M2 | Design 7.2 steps 4 to 6: stream recorded as `currentStream` right after `getUserMedia`; `generation` re-checked after `loadEngine` and after `play()`; stop closes `currentStream`. AC-QR-005-5 widened; its U-QR-05 observation now has three cases (deferred `getUserMedia`, `loadEngine`, `play()`), each with 1 track `stop` call, `srcObject === null`, no `scanning` emitted. tasks 4.1 updated. |
| M3 | Design 14.2 now has a per-rung class table (1232: S 600 to 700, L 1150 to 1232; 829: S 300 to 400, L 750 to 829; 502: S 328, L 380 to 502). 14.3 says both classes are re-run at the new rung and results are never carried over. AC-QR-016-1/-3, tasks 9.3, 9.4 and the results template were updated. Check: 829 L at 750 bytes gives 1130 frame characters, within version 20 (1249); 502 S at 328 bytes gives 497 characters (version 12); 380 bytes gives 575 characters (version 13). All fit. At 502 no app-built capsule is larger than about 380 bytes, so the largest symbol may be unreachable; the spec says so and labels it a weaker test. |

## LOW findings
| ID | Status |
| --- | --- |
| L1 | Fixed. Design 14.1: PHYS-QR-01 is INVALID below scale 5; AC-QR-016-1, tasks 9.3 say the same. |
| L2 | Fixed. The double-click exception is stated in AC-QR-008-3, AC-QR-013-1 and NFR-QR-004 and in the mapping rows. |
| L3 | Fixed. Design 7.2/7.4: track `ended` listener, state `failed`; `failed` copy updated; AC-QR-005-5 and the U-QR-05 observation cover it. |
| L4 | Fixed. Design 8.3 step 5: "The import did not run. Scan the code again." added to 9.3. |
| L5 | Fixed. E2E-QR-08 added to the AC-QR-010-1 row; AC-QR-014-4 and -6 now give exact commands and pass criteria. |
| L6 | Accepted. `.agents/` and `.review-artifacts/` predate the spec; the owner should confirm they are not part of this change. |
| L7 | Fixed. Design 16 and requirements L-4 state the 2021-04 upload date and the 2025-11 registry modified date. |

Evidence labels are unchanged: every MUST still maps to a named test ID and observation, EV-FIXTURE and EV-PHYS stay separate, and EV-PHYS remains NOT RUN. No test was run; this is a spec-only change.
