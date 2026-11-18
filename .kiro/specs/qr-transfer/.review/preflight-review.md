# QR transfer spec: step 32 preflight review of the corrected spec
Scope: `.kiro/specs/qr-transfer/{requirements,design,tasks}.md` (untracked), `.review/review.md`, `.review/review.json`, `.review/resolution.md`. Branch `feat/qr-transfer`, HEAD `fd9b9da`. Read-only; no spec file was edited. This is a new verdict and does not replace the original `CHANGES_REQUESTED` in `review.md` / `review.json`.

The three MEDIUM fixes (M1, M2, M3) are in the spec and each has named tests with concrete observations. One remaining blocker: the planned trailing-space round trip cannot exist, because a valid Base45 frame can never end in a space. The spec's reasoning for it is wrong, and one MUST observation (AC-QR-002-3, odd byte count) would fail against a correct decoder. Watch for: B1 (confirmed), the missing alphanumeric-mode assertion at 1232 bytes (confirmed), and a stale-start race on the shared `currentStream` field (likely).

**Verdict**: CHANGES_REQUESTED (new verdict for the corrected spec; one blocker, B1)

## High-level view
M1, M2 and M3 are fixed as specified. M1 uses a synchronous in-flight record plus a re-check at import time and a disabled scan button. M2 records the stream before awaiting and re-checks the generation after each await. M3 gives each fallback rung its own size classes that fit under that rung's limit. L7 was an informational note, and the spec text matches what `resolution.md` says in design 16 and requirements L-4 (design 17 was not changed, and does not need to be). The 1232 / 1853 / version 25 arithmetic is correct and I confirmed it independently. The three requested cases are mostly covered, but the trailing-Base45-space case is mathematically impossible as specified. Evidence labels are kept apart in every place I checked, with a few small wording risks.

## Issues (13)
1. **B1 Trailing-space case impossible (blocker, confirmed)**. No frame produced by `encodeFrame` can end in a space. Remove "frames that end in a space" from AC-QR-003-4, U-QR-04, P-QR-03 (`endsWithSpace`), U-QR-02 "trailing-space cases", design 3.3 and tasks 3.2/3.4. Replace with an interior-space frame, a synthetic text that ends in a space for the engine-exact-text and rejection checks, and a corrected AC-QR-002-3 odd-count observation.
2. **B1b AC-QR-002-3 odd-count observation is wrong (confirmed)**. `frame + " "` for an odd byte count throws `OutOfRange` (final group is above 65535), it does not return bytes. Fix the observation and the sentence in the AC text.
3. **G1 No assertion of alphanumeric mode at 1232 bytes (confirmed)**. AC-QR-003-1 requires "one alphanumeric-mode segment", but its observation records only `ecc`, `minVersion`, `maxVersion`, `boostEcc`. Add a direct check (the decoded chunk type from the raster decode, or the encoder's mode option).
4. **G2 No test that a valid 1232-byte capsule is accepted by the QR import path (confirmed)**. Only 1233 is tested at the import boundary (AC-QR-002-4). Add a 1232-byte accept case so an off-by-one in `maxCapsuleBytes` is caught. `decode.ts:60` rejects only `bytes.length > max`, so 1232 passes today.
5. **G3 No exact-boundary frame-length cases (confirmed)**. AC-QR-002-1 tests 1854 characters. Add a 1853 accept (covered by P-QR-01 at length 1232) and a 1855-character case (what a 1233-byte frame would be) with 0 allocations.
6. **R1 Stale start can overwrite the shared `currentStream` (likely)**. Design 7.2 step 4 records the stream into one field before the generation check, and clears the field when stale. After Cancel then a fast re-Scan, the old pending `getUserMedia` can resolve and overwrite or clear the new session's stream reference, leaving that camera unreachable by `stop()`. Hold the stream in a per-start local, and add a stop-then-restart case to U-QR-05.
7. **R2 `loadEngine` rejection after stop is ambiguous (possible)**. Step 5 says "failure ends in failed" and "after it settles, if generation differs, emit nothing". State that the generation check comes first, as step 6 does for `play()`. Case (b) only resolves `loadEngine`; add a rejection variant.
8. **R3 Scan button during a file import is unspecified (possible)**. AC-QR-008-4 disables `qr-scan-btn` while a QR import is pending. Design 9.2 says "while an import is pending", and `startScan` is a no-op on `importPending`. State whether the button is disabled during a file import, or a silent no-op.
9. **R4 Applied set only records QR imports (possible, informational)**. A capsule imported by file is not in `hasAppliedQr`, so a later QR scan of the same bytes imports again (idempotent merge). State this next to L-7.
10. **R5 Version range in design 14.2 for 829 S class (confirmed, minor)**. 300 bytes is version 11 and 400 bytes is version 13 (not "12 to 14"). Correct the text; the byte ranges and the 750 to 829 L class are fine.
11. **R6 No E2E at the 1232-byte limit through paint and video (possible)**. The at-limit symbol is only exercised in Node and in PHYS-QR-01. Fixtures in design 13.5 stop at the 988-byte capsule. Add one at-limit fixture to E2E-QR-01 or E2E-QR-08, or state the gap.
12. **E1 `EV-FIXTURE-FAKEDEVICE` label (possible)**. Design 13.3 names a fifth label that is missing from requirements section 5 and from the four-line rule in AC-QR-016-2 / task 10.1. Add it or fold it into EV-FIXTURE.
13. **E2 L7 left design 17 unchanged (confirmed, informational)**. Section 17 still cites only the upload timestamp. This is accurate and consistent with sections 16 and L-4, so no action is required beyond a decision.

<details>
<summary>Details</summary>

## M1 verification: second scan during a pending import
Original M1 (review.md): the same code could be scanned a second time while the first import was pending, pass the `already-imported` check (the set was still empty), and be applied again, because `importScanned` never re-checked the set.

Corrected text, all located:
- `design.md` 8.3, `importScanned` step 2: "`if (session.hasAppliedQr(held.metadata.sha256)) { this.held = undefined; this.state = "already-imported"; return; }` (re-check at import time, M1)".
- `design.md` 8.3 step 3: records the sha256 in the synchronous `inFlightQr` set before the first `await`, and keeps the held capsule when `session.importPending`.
- `design.md` 8.2: `hasAppliedQr` returns true for a value in either `applied` or `inFlightQr`; `inFlightQr` is cleared when the import settles.
- `design.md` 8.3 "Scan during an import (M1)": `qr-scan-btn` is disabled while the controller is `importing`; `startScan` returns at once if `state === "importing"` or `session.importPending`; a scan already running is stopped at step 3.
- `requirements.md` AC-QR-008-4: scan button disabled while a QR import is pending; the import action re-checks the applied and in-flight checksums before it starts.

Named tests and where they exist:
- U-QR-10 `apps/patchboard/tests/qr-import-flow.test.ts`: in `design.md` 13.2 (inventory lists "scan during a pending import, applied-set re-check, held capsule kept when `importPending`"), in `tasks.md` 5.4 (case list names "scan button disabled and `startScan` a no-op while importing, applied-set re-check in `importScanned` (design 8.3 step 2), held capsule kept when `importPending`"), and in `requirements.md` section 9, row AC-QR-008-4 and row AC-QR-008-3. Observations: with the import held open, `qr-scan-btn` is disabled and `getUserMedia` count is unchanged; a capsule held before the import started, then the same sha256 applied by another path, gives `already-imported` and `applyUpdate` count 1.
- E2E-QR-05 `apps/patchboard/e2e/qr-transfer.spec.ts`: in `design.md` 13.4 and 13.4's file list, in `tasks.md` 6.2, and in the AC-QR-008-4 and AC-QR-008-5 rows. Observation: with `SubtleCrypto.digest` held, `qr-scan-btn` is disabled; after release it is enabled, a rescan shows `already-imported`, `data-save-sequence` rose by exactly 1.
- Negative control: `tasks.md` 8.8 removes the synchronous consume and the applied-set check, and requires U-QR-10 and E2E-QR-05 to fail.

Assessment: sound. The at-most-once property now holds on three independent lines (button disabled, `startScan` no-op, re-check plus in-flight record at import time), and each has a unit and a browser observation. Remaining notes are R3 (button behavior during a file import) and R4 (file-imported capsules are not in the applied set), both low.

## M2 verification: camera cannot stay live if `stop()` runs during load or `play()`
Original M2: after `getUserMedia` resolved, steps 5 (`await loadEngine()`) and 6 (`await video.play()`) had no generation re-check, and the point at which the stream became the "current stream" was unspecified.

Corrected text, all located:
- `design.md` 7.2 step 4: "As the first statement after the await, record the stream as `currentStream` ... then, if `generation !== gen` ... stop every track ... return".
- Step 5: re-check after `loadEngine`; step 6: re-check after `play()`; "a `play()` rejection caused by that stop is not reported as `failed`"; "Steps 4 to 6 are the only awaits after acquisition; each is followed by the same `generation` re-check".
- `design.md` 7.4: `stop()` closes the tracks of `currentStream` (set at step 4), so a stop during engine load or `play()` also closes it.
- `requirements.md` AC-QR-005-5 (widened to decoder load and `play()`, plus a track `ended` event).

Named tests: U-QR-05 `packages/qr-transfer/tests/scan-session.test.ts`: in `design.md` 13.2 ("deferred `getUserMedia`, deferred `loadEngine` and deferred `play()` races, track `ended`"), in `tasks.md` 4.1 (same three races, "stream recorded before the later awaits, `generation` re-checked after each"), and in the AC-QR-005-5 row: three cases (a) deferred `getUserMedia`, (b) deferred `loadEngine`, (c) deferred `video.play()`, each with the track `stop` spy having exactly 1 call, `video.srcObject` null, final state `idle`, no `scanning` ever emitted, no `failed` from a stop-induced `play()` rejection.

Assessment: the original gap is closed. Two remaining gaps, both outside the three cases that are tested:
- R1 (likely): `currentStream` is a single shared field. Sequence: Start (A), `getUserMedia` pending; Cancel (generation bumps, state `idle`); Start again (B); A's promise resolves. Step 4 writes A's stream into `currentStream` first. If B had already stored its stream, B's reference is overwritten; then A's stale branch clears `currentStream`. B's later `stop()` closes nothing, so B's camera stays live. Fix: keep the stream in a per-`start()` local and also on a per-session record, never clear the shared field from a stale continuation. Add a stop-then-restart case to U-QR-05.
- R2 (possible): if `loadEngine` rejects after a stop, step 5 reads as "failure ends in `failed`" before the generation check. State the order.

## M3 verification: fallback ladder classes
Original M3: rungs 829 and 502 said "re-run both classes" but the classes (600 to 700, 1150 to 1232) did not fit those limits.

Corrected text: `design.md` 14.2 now has a per-rung table (limit 1232: S 600 to 700, L 1150 to 1232; 829: S 300 to 400, L 750 to 829; 502: S 328, L 380 to 502 with an explicit statement that the largest symbol may be unreachable and the test is labelled weaker). `design.md` 14.3 step 2: "re-run BOTH classes at that rung, using the classes of the 14.2 table for the new rung (results from a higher rung are never carried over, and S is re-measured even if only L failed)". `requirements.md` AC-QR-016-1 and AC-QR-016-3 and `tasks.md` 9.3, 9.4 and the results template ("Rung and class ranges in effect") all point at the 14.2 table.

I recomputed the arithmetic. 829 bytes gives 5 + 3 x 414 + 2 = 1249 characters, exactly version 20 L. 502 bytes gives 5 + 753 = 758 characters, exactly version 15 L. 750 bytes gives 1130 characters (version 19 or 20). 380 bytes gives 575 characters (version 13). 328 bytes gives 497 characters (version 12). All class ranges are at or below their limit. The empty board at 328 bytes and a 64-character board ID at 380 bytes are consistent with design 4.3. Minor: 300 bytes is version 11 and 400 bytes is version 13, not "12 to 14" (R5).

Named tests: PHYS-QR-01 (manual, `tasks.md` 9.3/9.4, EV-PHYS) with the AC-QR-016-1 and AC-QR-016-3 rows. Rung-limit changes also touch U-QR-02/03 expectations (`tasks.md` 9.4). The AC-QR-016-3 observation checks that the shipped `QR_MAX_CAPSULE_BYTES` equals the rung limit and that each attempt's `data-qr-bytes` fell inside the rung's range. These rows exist in the requirements AC table and in tasks 9.x, with a concrete observation. Assessment: sound; the physical classes are now runnable at every rung.

## L7 and L1 to L6: what was said, what was done
- Original review L7: `design.md` 17 lists `jsqr` as "published 2021-04", while the registry's `time.modified` is 2025-11-13. The review said the 1.4.0 upload date claim "is fine, but note that the registry modification date differs". It is an informational note with no required change.
- `resolution.md` L7: "Fixed. Design 16 and requirements L-4 state the 2021-04 upload date and the 2025-11 registry modified date."
- Spec check: `design.md` 16 (jsqr row) now reads "not actively maintained (registry modified date 2025-11 is later than the 2021-04 1.4.0 upload; no newer release)". `requirements.md` L-4 reads "1.4.0 uploaded 2021-04; the registry's modified date is later, 2025-11, with no newer release". Both match resolution.md. `design.md` 17 still says "Release date from the registry upload timestamp (1619234240477 ms = 2021-04-24)" and does not mention the modified date; the original review cited "design 17", so the resolution says "Design 16" rather than 17. That statement is accurate as it stands. I re-checked the registry: `time.modified` 2025-11-13T00:53:36Z, `time.1.4.0` 2021-04-24T03:17:20Z, `uqr` 0.1.3 2026-04-03. No disagreement between resolution.md and the spec; the only difference is that section 17 was not touched (E2).
- L1: fixed in `design.md` 14.1 (scale below 5 is INVALID), AC-QR-016-1, `tasks.md` 9.3.
- L2: fixed in AC-QR-008-3, AC-QR-013-1, NFR-QR-004 and the mapping rows.
- L3: fixed in `design.md` 7.2/7.4 and AC-QR-005-5 (track `ended` gives `failed`).
- L4: fixed in `design.md` 8.3 step 5 and the 9.3 copy row "The import did not run. Scan the code again."
- L5: fixed (E2E-QR-08 added to AC-QR-010-1; AC-QR-014-4 and -6 now give commands and pass criteria).
- L6: accepted (resolution says the owner should confirm). `git status --short` still shows `.agents/` and `.review-artifacts/` untracked, plus `M docs/progress.md`; nothing is staged.

## Coverage of the three cases
### Arithmetic (recomputed)
- Base45 characters for n bytes: 3 x floor(n/2) + 2 x (n mod 2). n = 1232 gives 1848. n = 1233 gives 1848 + 2 = 1850. n = 1231 gives 3 x 615 + 2 = 1847.
- Frame characters with the 5-character `GSQ1:` prefix: 1231 gives 1852, 1232 gives 1853, 1233 gives 1855 (a node script confirmed 1852 / 1853 / 1855).
- Bit budget at version 25 L: 1276 data codewords x 8 = 10,208 bits. Alphanumeric: 4 mode bits + 11 count bits + 11 per pair + 6 for an odd single. 1853 characters need 10,207 bits (fits), 1854 need 10,212, and 1855 need 10,218 (do not fit).
- Authoritative sources: Thonky character-capacity table (https://www.thonky.com/qr-code-tutorial/character-capacities) row `25 L 3057 1853 1273`, so 25-L alphanumeric capacity is 1853; version 26 L is larger, so 1853 is the exact 25-L maximum. Thonky error-correction table (https://www.thonky.com/qr-code-tutorial/error-correction-table) row `25-L 1276 ...` confirms 1276 data codewords. Both are secondary reproductions of ISO/IEC 18004; I did not read the standard itself. A frame of 1855 characters (1233 bytes) cannot fit v25-L.

### (a) 1,232-byte capsule, Version 25-L, alphanumeric
- Frame text 1853: AC-QR-001-2 row, U-QR-02 (`n=1232 gives text.length === 1853`), and P-QR-02 (length formula).
- Version 25, size 117, ecc L: AC-QR-003-1 row, U-QR-03 (`.version === 25`, `.size === 117`, options `ecc "L"`, `minVersion 1`, `maxVersion 25`, `boostEcc false`). Only the option is recorded; the ECC level is not read back from the raster. Acceptable since the options are asserted.
- Alphanumeric segment: required by AC-QR-003-1 text, not asserted by any observation (G1). Version 25 at 1853 characters implies alphanumeric mode indirectly (byte mode at 25-L holds 1273), but no test names the mode. Add a direct assertion.
- Encode and decode of the raster: AC-QR-003-4, U-QR-04 (sizes 11, 328, 658, 988, 1231, 1232 at scale 4 with a quiet zone, decoded by the jsqr engine), P-QR-03 (four batches). Covered. Risk R-1 in design 13.2 may restrict P-QR-03 to 11..658 bytes if slow, and says the at-limit sizes stay in U-QR-04, which keeps 1232 covered.
- Not covered: a Chromium fixture at 1232 bytes (R6).

### (b) Exact round trip when the Base45 frame ends with a space: not feasible
A valid Base45 frame can never end in a space. The last character of an even-length payload is the most significant digit of a 3-character group, floor(n / 2025) for n at most 65535, so its value is at most 32 (`W`). The last character of an odd-length payload is floor(a / 45) for a at most 255, so its value is at most 5. A space is value 36. I checked by exhaustive encoding of every 1-byte and 2-byte final group: 0 frames end in a space (0 of 65,536 two-byte values and 0 of 256 one-byte values; 0 of 200,000 random tails).
The spec defines no concrete fixture. It only says "a space-terminated frame" (design 3.3, 13.2 U-QR-02 and U-QR-04, `tasks.md` 3.2 and 3.4) and a generator `endsWithSpace` (P-QR-03). It also states (design 3.3) that a frame can end in a space "about one time in 45". That is false. As a result:
- AC-QR-003-4 ("including frames that end in a space") cannot be satisfied by `encodeFrame` output; an implementer will either write a vacuous test or an invalid frame.
- AC-QR-002-3 observation for odd byte counts says `frame + " "` "returns bytes different from the original ... and `decodeCapsule` of those bytes rejects". It cannot return bytes: for an odd-length frame the final two characters plus the appended space form a 3-character group with `e = 36`, a value of at least 72,900, which is above 65,535, so `decodeFrame` throws `OutOfRange` (example: `[0x41]` encodes to `K1`; `K1 ` has group value 72,965). The even-length half of the observation (`InvalidLength`) is correct.
- The spec's stated trim-hazard reasoning for a valid frame is therefore moot; trimming cannot damage a valid frame. What does matter is that interior spaces survive (spaces are 1 in 45 of characters in the middle of a frame, for example `%69 VD92EX0`), and that the engine contract returns text verbatim.
Suggested replacement coverage (spec change, not done here): (1) frames with at least one interior space, through encode, raster, decode; (2) an engine-level exact-text test with a synthetic string ending in a space (not a valid frame) to prove the engine and scan path do not trim, followed by `decodeFrame` rejecting it with `InvalidLength` or `OutOfRange`; (3) fix AC-QR-002-3 and design 3.3, and drop the `endsWithSpace` generator. Text handling after the engine: design 5 and AC-QR-002-3 say no `trim` or case change, and design 7.3 passes the engine string straight to `decodeFrame`, so the app path has no trim step to cover.

### (c) Rejection at 1,233 bytes
- Encode `TooLarge`: AC-QR-001-2 row, U-QR-02 (n=1233 throws `QrTransferError` code `TooLarge`; n=0 throws `Empty`).
- Frame-length rejection before allocation: AC-QR-002-1 (1854-character text throws `TooLarge`, `allocate` spy 0 calls) and AC-QR-002-2 (allocation spy). A 1855-character text, which is what a real 1233-byte frame would be, is not named (G3); the 1854 case already proves the length bound, since the check is a plain `> 1853` comparison.
- Symbol layer: AC-QR-003-3, U-QR-03 (`GSQ1:` + 1849 characters, 1854 total, throws `TooLarge`).
- Import path: AC-QR-002-4, U-QR-10: `importBytes(new Uint8Array(1233), "qr")` gives `rejected`, `OversizedRaw`, 0 `applyUpdate` calls. `packages/capsule/src/decode.ts:60` confirms the check is `bytes.length > maxCapsuleBytes`, so 1232 is accepted and 1233 rejected. The accepting side at exactly 1232 has no test (G2). `tasks.md` 5.3 / design 8.1 pass `QR_MAX_CAPSULE_BYTES` as `maxCapsuleBytes`.

## Evidence separation
Labels are separate and consistent in these places: `requirements.md` section 5 (EV-UNIT, EV-FIXTURE, EV-DIST, EV-PHYS, EV-REVIEW; "A fixture pass is NEVER reported as a physical-camera pass"; EV-PHYS "Only a person records it; no automated test writes it"); every row of the section 9 AC table carries its label, and EV-PHYS appears only on the AC-QR-016 rows; AC-QR-016-2 requires four separate progress lines with EV-PHYS reading NOT RUN; `design.md` D-QR-12 and 13.7; `tasks.md` rules ("Never report a fixture pass as a physical-camera pass"), task 9 (a separate manual task, "no automated test may write its result", "Do not start until 8.2 to 8.7 pass", full results template with status NOT RUN | PASS | FAIL | PARTIAL), and 10.1 (four lines, EV-PHYS `NOT RUN` until 9.3 is filled). The appended `docs/progress.md` note lists all four as NOT RUN and says a fixture pass will never be reported as a physical pass.
Places where a fixture pass could be misread as physical (all low): (1) U-QR-04 and P-QR-03 are called "round trip" through a decoder in Node and sit under EV-UNIT; the label is right, but the wording "scanner's own decoder" invites misreading, so keep them out of any "scan works" sentence. (2) E2E-QR-13 carries a fifth label `EV-FIXTURE-FAKEDEVICE` (design 13.3) not listed in section 5 or in AC-QR-016-2, so a progress note that follows the four-line rule would have nowhere to put it (E1). (3) AC-QR-016-3 lists "EV-REVIEW; EV-PHYS" together; it is a mapping row, and the PHYS part is the manual task. No place lets an automated test write an EV-PHYS result.

## Blockers
- B1 (confirmed). `requirements.md` AC-QR-003-4 and AC-QR-002-3 (section 6 and section 9 rows), `design.md` 3.3, 13.2 (U-QR-02, U-QR-04, P-QR-03), `tasks.md` 3.2 and 3.4: the trailing-space round trip cannot be built, and the AC-QR-002-3 odd-count observation is false against a correct decoder. Tasks 3.2 and 3.4 are the first implementation steps that would hit it, so the spec should be corrected before implementation starts.

## Lows
G1, G2, G3, R1 to R6, E1, E2 as listed in the issues list above. Of these, R1 (stale `currentStream`) and G1 (alphanumeric assertion) are the two I would fix in the same edit as B1, since both change test text. The rest are non-blocking. There are no other blockers.

</details>

## File map
<details>
<summary>Files reviewed</summary>

- `.kiro/specs/qr-transfer/requirements.md`: requirements, AC table, evidence labels (read in full).
- `.kiro/specs/qr-transfer/design.md`: frame format, byte limits, scan session, controller, tests, physical protocol (read in full).
- `.kiro/specs/qr-transfer/tasks.md`: ordered tasks, manual physical task, results template (read in full).
- `.kiro/specs/qr-transfer/.review/review.md`, `review.json`, `resolution.md`: original verdict and resolution (read only, unchanged).
- `packages/capsule/src/decode.ts`: `maxCapsuleBytes` check (read only).
- `.kiro/specs/qr-transfer/.review/preflight-review.md`: this report (the only file written).
</details>
