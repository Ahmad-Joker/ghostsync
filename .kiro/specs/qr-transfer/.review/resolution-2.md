# QR transfer spec: resolution 2 (correction pass for preflight-review.md)
Branch `feat/qr-transfer`, HEAD `fd9b9da`. Spec-only. No code, no installs, nothing staged or committed. EV-PHYS stays NOT RUN everywhere. `review.md`, `review.json`, `resolution.md` and `preflight-review.md` are unchanged (hashes in the final check below).

## Edits by finding
- **B1 (trailing-space round trip impossible).**
  - `design.md` 3.3 rewritten: a frame never ends in a space (last char of even payload <= 32 `W`, of odd payload <= 5; a space is 36); removed the false "about one time in 45" claim; interior-space fixture derived by hand from RFC 9285: byte 0x24 = 36 = 36 + 45*0, characters low digit first = space then `0`, frame `GSQ1: 0`, decode gives `[0x24]` (checked also with a small script: encode gives `" 0"`). Round trip through encode, symbol, raster, jsqr scan (exact text), `decodeFrame` (byte-equal).
  - Negative case in 3.3: `GSQ1: 0 ` (synthetic, not an `encodeFrame` output) is kept verbatim by the engine/scan path and `decodeFrame` throws `OutOfRange` (` 0 ` = 36 + 0*45 + 36*2025 = 72936 > 65535). Rastering it is optional; the text-level check is the requirement.
  - `design.md` 13.2: U-QR-02, U-QR-04 rewritten; P-QR-03 `endsWithSpace` removed, generator biased to bytes that produce a space (for example `a % 45 == 36`).
  - `requirements.md`: AC-QR-002-3 text and table row, AC-QR-003-4 text and table row.
  - `tasks.md` 3.2 and 3.4.
- **B1b (AC-QR-002-3 odd-count observation).** `requirements.md` AC-QR-002-3 and table row; `design.md` 3.3 worked parity rule: odd byte count, `frame + " "` throws `OutOfRange` (last group has e = 36, value >= 72900; example `[0x41]` = `K1`, `K1 ` = 72965). Even byte count (n <= 1230; at 1232 the longer text is `TooLarge` first): payload length becomes 1 mod 3, `InvalidLength` before any alphabet or range check (example `[0x41,0x42]` = `BB8`, `BB8 ` has 4 chars). Order matches design 5 (type, length bound, prefix, length mod 3, alphabet, group range). No parity returns bytes.
- **G1 (decoded mode).** `requirements.md` AC-QR-003-1 text and table rows (AC-QR-003-1, AC-QR-003-4); `design.md` 6.3 (internal `decodeDetailed` seam, not public) and 13.2 U-QR-04; `tasks.md` 3.4. The 1232-byte raster asserts from the jsqr result: `version === 25`, `chunks.length === 1`, `chunks[0].type === "alphanumeric"`, `chunks[0].text === frame`, plus size 117, ECC L via the recorded options (U-QR-03), exact text. Engine check: the jsQR source exposes `QRCode.chunks` and `QRCode.version` (`Chunk.type` is the `Mode` enum, string valued). The exact `"alphanumeric"` literal is not yet confirmed on a run; the spec says so and names the fallback (record a finding in design 17, observe the mode from the raster). 1,233-byte rejection test unchanged. Frame arithmetic untouched.
- **G2 (done, one line each).** 1232-byte capsule accepted through the QR import path: `requirements.md` AC-QR-002-4 row, `design.md` 13.2 U-QR-10, `tasks.md` 5.x U-QR-10 list.
- **G3 (done).** 1855-character text rejected as `TooLarge` with 0 `allocate` calls: AC-QR-002-1 row, `design.md` 13.2 U-QR-02, `tasks.md` 3.2.
- **R1 (shared `currentStream`).** `design.md` 7.2 steps 3 and 4 and 7.4: each start holds a per-start local plus a per-session record; no shared mutable `currentStream`; a stale start stops only its own stream and never touches the new session's stream, `srcObject`, timers, listeners or state. `requirements.md` AC-QR-005-5 text, AC-QR-005-4 row. `tasks.md` 4.1.
- **R2 (`loadEngine` / `play()` rejection order).** `design.md` 7.2 steps 5 and 6: the generation check comes FIRST, including in catch; a stale rejection emits nothing and sets no `failed`. Same text in AC-QR-005-5 and tasks 4.1.
- **R1/R2 tests.** `requirements.md` AC-QR-005-5 row, `design.md` 13.2 U-QR-05, `tasks.md` 4.1: resolve and reject variants of deferred `getUserMedia`, `loadEngine`, `play()`; regression (a) Cancel then immediate re-Scan with the old `getUserMedia` resolving after the new stream is active (old tracks `stop` exactly once; new tracks 0 `stop` calls, `readyState` live; `srcObject` still the new stream; new loop still delivers one accepted result; final `stop()` closes the new tracks once); (b) stale `loadEngine` rejection after restart; (c) stale `play()` rejection after restart. Negative control: a shared-`currentStream` implementation must fail (a) (tasks 4.1 runs it).
- Stale wording removed: `endsWithSpace`, "frames that end in a space", "space-terminated", "trailing-space cases", the one-in-45 claim and the old `currentStream` wording in 7.4 and tasks 4.1. A repository search of the three files finds none outside the new text that explains the corrected behavior.
- `docs/progress.md` not edited: its planning note says nothing these edits make wrong.

## Remaining findings (unresolved, carried over exactly from preflight-review.md)
- R3: scan button during a file import is unspecified (disabled, or silent no-op).
- R4: applied set records only QR imports; a file-imported capsule scanned later by QR imports again (idempotent merge). Not stated next to L-7.
- R5: design 14.2 version range for the 829 S class (300 bytes is version 11, 400 bytes is version 13, not "12 to 14").
- R6: no E2E at the 1232-byte limit through paint and video (fixtures stop at 988 bytes).
- E1: `EV-FIXTURE-FAKEDEVICE` label in design 13.3 is missing from requirements section 5, AC-QR-016-2 and task 10.1.
- E2: design 17 still cites only the jsqr upload timestamp (informational, decision needed).
- New note from this pass: the exact `"alphanumeric"` literal from jsqr's `Mode` enum is to be confirmed on the first run (G1).
- Not run: all implementation, all tests, EV-PHYS (NOT RUN).
