# QR Transfer MVP: Requirements
Status: IMPLEMENTED for the static MVP (unit, fixture and dist evidence in `docs/progress.md`); EV-PHYS: PASS (user-reported manual run, 2026-11-16, iPhone 14 Pro Max, Safari; see section 5.1 and `docs/progress.md`). Baseline `fd9b9da`, branch `feat/qr-transfer`.
`packages/qr-transfer` does not exist yet. Every test named here is a plan; none has run and none is claimed to
pass. The physical-phone result (EV-PHYS) is PASS as reported by the user on 2026-11-16 (section 5.1); it was NOT RUN before that date.

Companion documents: `design.md` (decisions, frame format, byte arithmetic, scan lifecycle, test mechanisms,
physical protocol, sources) and `tasks.md` (ordered checklist, checks to run, manual physical task with a results
template). Style and ID scheme follow `.kiro/specs/patchboard` and `.kiro/specs/file-capsules`.

Priority words: MUST = required for the MVP and mapped to a named test and an exact observation in section 9.
SHOULD = desired, optional test, marked SHOULD wherever it appears. OPTIONAL = the animated tier, specified but not
part of the MVP and not gating it. Acceptance criteria use EARS form (WHEN / WHILE / IF ... THE SYSTEM SHALL).

## 1. Product statement
QR transfer is the second transfer tier after file transfer (`.kiro/steering/product.md`). The first deliverable is
an offline camera scan of ONE static QR code that carries a small `.gscap` capsule. The bytes in the code are the
same bytes a file export produces, and they go through the same import pipeline the file flow uses
(`importCapsuleIntoPersisted`), so app identity, document identity, checksum, size and save-outcome checks are
unchanged. File transfer stays available when a capsule is too large, camera access fails, or the device has no
usable camera.

A new shared package `@ghostsync/qr-transfer` owns the transport only: frame text, QR symbol generation, camera
scan session. It contains no merge, no capsule parsing and no storage. PatchBoard is the first app to integrate it.
Animated multi-frame QR stays OPTIONAL until a real phone reliably scans the static code.

## 2. User journey
1. Maya and Omar each open PatchBoard once online, see "Ready to work offline", go offline, and open the same board
   (`sprint-board`).
2. Maya has a small board (about two cards). She activates "Show QR code". The app shows one static QR code, the
   capsule size and a short checksum prefix, and keeps "Export capsule (.gscap)" next to it.
3. Omar activates "Scan QR code (camera)", allows the camera, and points the phone at Maya's screen. The camera stops
   as soon as a valid code is read. The app shows the capsule's app, document, creation time, size and checksum
   prefix. Nothing has been applied.
4. Omar activates "Import scanned capsule". The capsule goes through the normal import pipeline. The board, merge
   summary and save indicator behave exactly as after a file import. Scanning the same code again does not apply it
   again.
5. If Maya's capsule is too large, the camera is blocked, or the phone has no camera, the app says so and the file
   controls work as before.

## 3. In scope
- Frame format `GSQ1:` + Base45 for one static code, with exact byte limits (design sections 3 and 4).
- QR generation (show) and camera scan (receive) for PatchBoard, behind the new package.
- Explicit import action, at-most-once application, session binding, save outcomes.
- Camera permission handling and cleanup, offline startup, scanner assets and precache decision.
- Deterministic browser tests with a test-side camera stub; a manual physical screen-to-phone test with networking
  disabled after setup; separate evidence labels.
- Specification (not implementation) of the OPTIONAL animated tier and of second-app (FieldLedger) consumption.

## 4. Out of scope
Animated QR implementation, schema editor, FieldLedger code changes, GhostSync Studio, changes to
`packages/kit`, `packages/capsule`, `packages/persist`, encryption, sender authentication, compression, differential
capsules, server relay, NFC/Bluetooth, scanning from an uploaded image, BarcodeDetector integration (design D-QR-5),
native-app scanners, Firefox and WebKit automation.

## 5. Evidence labels (reported separately, never merged)
- EV-UNIT: Node unit and property tests, including the Node-side raster round trip (encode, rasterize, decode).
- EV-FIXTURE: Chromium tests that feed a test-side fake camera (a canvas `MediaStream`) into the real scan code. No
  lens, no screen glare, no focus, no moire. A fixture pass is NEVER reported as a physical-camera pass.
- EV-DIST: static scan of `dist/` and the precache manifest after a production build.
- EV-PHYS: a real phone camera reading a real screen, networking disabled after setup (task 9, PHYS-QR-01). Status is
  exactly one of NOT RUN, PASS, FAIL, PARTIAL. Only a person records it; no automated test writes it. EV-PHYS means the user's manual run on a real phone; Chromium and fixture passes stay EV-UNIT or EV-FIXTURE.
- EV-REVIEW: document or diff inspection with a recorded command or checklist.

### 5.1 EV-PHYS record (PHYS-QR-01, rung 1232)
EV-PHYS: PASS, 2026-11-16. User-reported manual test; not automated and not observed by the agent. The full record is the template in `tasks.md` section 9 and the `docs/progress.md` entry "QR transfer physical result (iPhone Safari)". EV-UNIT, EV-FIXTURE and EV-DIST keep their earlier results and are not part of this line.
It does not show: a second device or browser; hand-held distance, brightness and lighting beyond what was reported; per-attempt seconds or module scales (not recorded); a guarantee for other conditions ("reads in these conditions"). Animated QR stays optional and not started.

## 6. Requirements and acceptance criteria

### REQ-QR-001 Frame format and exact byte limits
- AC-QR-001-1 (MUST) THE SYSTEM SHALL encode one static frame as the literal prefix `GSQ1:` followed by the Base45
  (RFC 9285) encoding of the capsule bytes, with no trimming, padding, newline or other character. Every character
  SHALL belong to the 45-character QR alphanumeric set.
- AC-QR-001-2 (MUST) THE SYSTEM SHALL define `QR_MAX_CAPSULE_BYTES = 1232` and `QR_MAX_FRAME_CHARS = 1853`. WHEN the
  capsule is 1232 bytes or fewer, encoding SHALL succeed and the frame text SHALL be `5 + 3*floor(n/2) + 2*(n mod 2)`
  characters long. WHEN the capsule is 1233 bytes or more, or empty, encoding SHALL fail with `TooLarge` or `Empty`
  and SHALL produce no text.
- AC-QR-001-3 (MUST) THE SYSTEM SHALL implement Base45 exactly as RFC 9285: 2 bytes to 3 characters, a final odd
  byte to 2 characters, the RFC example vectors, and rejection of a 3-character group above 65535, a 2-character
  group above 255 and a single leftover character.
- AC-QR-001-4 (MUST) FOR every byte sequence of length 1 to 1232, decoding the encoded frame SHALL return the
  original bytes.
- AC-QR-001-5 (MUST) THE SYSTEM SHALL keep the frame prefix versioned: a frame starting `GSQ` followed by a digit other
  than `1` and `:` SHALL be rejected as `UnsupportedVersion`, and the animated prefix `GSA1:` SHALL be rejected as
  `AnimatedNotSupported`, not as an invalid capsule.

### REQ-QR-002 Validate before allocating (bound size before decoding)
- AC-QR-002-1 (MUST) WHEN a scanned text is longer than 1853 characters, THE SYSTEM SHALL reject it as `TooLarge`
  before any prefix, alphabet or Base45 work, and SHALL allocate no output buffer.
- AC-QR-002-2 (MUST) THE SYSTEM SHALL validate, in this order and without allocating output: input type; length bound;
  prefix; payload length (not 1 mod 3); every character in the Base45 alphabet; every group in range. IT SHALL allocate
  the output buffer exactly once, with the exact decoded byte length, only after all of those pass.
- AC-QR-002-3 (MUST) THE SYSTEM SHALL NOT normalize the scanned text (no `trim`, no case change). Lowercase letters, a
  leading space, a newline and any other non-alphabet character SHALL be rejected, never repaired. A space is a valid
  Base45 character and occurs in the interior of frames; a valid frame never ends in a space (design 3.3). A space appended
  to a valid frame is kept as data and rejected: `OutOfRange` for an odd capsule byte count, `InvalidLength` for an even
  byte count (a decoder or scanner that trims it is wrong, design 3.3).
- AC-QR-002-4 (MUST) WHEN QR bytes enter the import pipeline, THE SYSTEM SHALL pass `maxCapsuleBytes = 1232` to
  `importCapsuleIntoPersisted`, so a larger buffer is rejected as `OversizedRaw` before any parse.

### REQ-QR-003 QR symbol generation (show side)
- AC-QR-003-1 (MUST) THE SYSTEM SHALL generate the symbol with error-correction level L, one alphanumeric-mode
  segment, minimum version 1 and maximum version 25. A 1232-byte capsule SHALL give version 25 (117 x 117 modules), and
  the decoded segment mode read back from the rasterized symbol SHALL be alphanumeric.
- AC-QR-003-2 (MUST) THE SYSTEM SHALL give exactly these versions for these capsule sizes: 328 bytes -> 12, 658 -> 18,
  988 -> 24, 1231 -> 25, 1232 -> 25. (Implementation correction: the encoder alone gives version 23 for 988 bytes, but the
  bundled decoder, `jsqr` 1.4.0, cannot read any version 23 symbol at level L. `buildQrSymbol` therefore never emits version 23
  and re-encodes from version 24. See `.review/implementation-notes.md`.)
- AC-QR-003-3 (MUST) WHEN given a frame text longer than the version-25 capacity directly, THE SYSTEM SHALL fail with
  `TooLarge` and SHALL NOT raise the error-correction level or exceed version 25.
- AC-QR-003-4 (MUST) FOR every valid frame, the module matrix rasterized with a 4-module quiet zone SHALL decode (by the
  scanner's own decoder) to exactly the frame text, including frames with an interior space (for example `GSQ1: 0`, the
  frame of the single byte 0x24).

### REQ-QR-004 Show a QR code (PatchBoard)
- AC-QR-004-1 (MUST) WHEN the user activates "Show QR code", THE SYSTEM SHALL build the capsule with the same
  `buildCapsule("export")` path as file export and encode that exact byte array as the frame.
- AC-QR-004-2 (MUST) WHEN the capsule is larger than 1232 bytes, THE SYSTEM SHALL draw no code, SHALL show the actual
  size and the limit, and SHALL point to file export. The file controls SHALL stay enabled.
- AC-QR-004-3 (MUST) THE SYSTEM SHALL draw black modules on white with a 4-module quiet zone at an integer scale of at
  least 4 CSS pixels per module. IF the available width allows less, THE SYSTEM SHALL draw no code and say the screen
  is too narrow and to use file transfer or a larger screen.
- AC-QR-004-4 (MUST) THE SYSTEM SHALL show, next to the code, the capsule size in bytes, the QR version and the first 12
  hexadecimal characters of the capsule checksum from the capsule metadata.
- AC-QR-004-5 (MUST) WHEN the session changes or the user hides the code, THE SYSTEM SHALL remove the drawn code.
- AC-QR-004-6 (SHOULD) THE SYSTEM SHOULD tell the user to raise screen brightness and keep the code large and still.

### REQ-QR-005 Camera session and cleanup
- AC-QR-005-1 (MUST) THE SYSTEM SHALL request the camera only after an explicit activation of "Scan QR code (camera)",
  never on load, route restore, session open or offline startup.
- AC-QR-005-2 (MUST) THE SYSTEM SHALL request video only (`audio: false`), preferring the rear camera
  (`facingMode: { ideal: "environment" }`) at an ideal 1920 x 1080.
- AC-QR-005-3 (MUST) WHEN the camera cannot be used (permission denied or dismissed, no camera, camera in use, no
  `mediaDevices`, insecure context, other failure), THE SYSTEM SHALL end in a named state with a message that says what
  happened and what to do next and that file transfer is available. It SHALL NOT throw to the page.
- AC-QR-005-4 (MUST) THE SYSTEM SHALL stop every acquired track (`readyState` `ended`) and clear the video source on each
  of: cancel, accepted code, `pagehide`, page becoming hidden, session change, 120 s without an accepted code, and any
  error after the stream was acquired.
- AC-QR-005-5 (MUST) IF the camera permission promise, the decoder load or the video `play()` settles (resolves OR
  rejects) after the user cancelled, changed session or left the page, THE SYSTEM SHALL stop that start's own stream
  immediately, leave no live track and show no scanning state. Each scan start SHALL hold its own stream reference (a
  per-start local plus a per-session record); a stale start SHALL stop only its own stream and SHALL NOT touch a newer
  session's stream, video `srcObject`, timers, listeners or state, even when the old promise settles after Cancel and an
  immediate re-Scan. For a stale rejection the generation check comes first: nothing is emitted and no `failed` state is
  set. A video track `ended` event while scanning SHALL stop the session and end in `failed`.
- AC-QR-005-6 (MUST) THE SYSTEM SHALL allow one scan session at a time; a second activation while one is active SHALL be
  ignored, and stopping SHALL be idempotent.

### REQ-QR-006 Scanner engine, offline startup and assets
- AC-QR-006-1 (MUST) THE SYSTEM SHALL decode frames with a bundled pure-JavaScript decoder (`jsqr` 1.4.0) on the page
  thread. It SHALL use no WebAssembly, no Worker and no network request, and SHALL NOT change the Content Security Policy.
- AC-QR-006-2 (MUST) THE SYSTEM SHALL emit the decoder in `dist/assets/` and list every emitted file, including the
  decoder chunk, in `precache-manifest.json`.
- AC-QR-006-3 (MUST) WHEN a profile that loaded online and reported offline readiness is offline, THE SYSTEM SHALL start,
  open the scanner and read a code with no network request.
- AC-QR-006-4 (MUST) THE SYSTEM SHALL NOT load, request or initialize the camera or the decoder during startup. Offline
  readiness SHALL NOT depend on camera availability.
- AC-QR-006-5 (SHOULD) IF the decoder chunk cannot be loaded, THE SYSTEM SHOULD end in a `failed` state with a message and
  the file fallback.

### REQ-QR-007 Scan results
- AC-QR-007-1 (MUST) WHEN a decoded text fails frame validation (not a GhostSync code, wrong or unsupported prefix,
  animated frame, too large, bad character, bad length), THE SYSTEM SHALL keep scanning, show a hint naming the cause,
  and change nothing else.
- AC-QR-007-2 (MUST) WHEN a text decodes to bytes, THE SYSTEM SHALL stop the camera, hold the bytes in memory and show a
  preview built by `decodeCapsule`: app, document, created time, size and checksum prefix.
- AC-QR-007-3 (MUST) IF `decodeCapsule` rejects the held bytes (checksum, malformed, unsupported capsule version,
  oversized), THE SYSTEM SHALL discard them, show the same mapped message as a file import, and offer no import.
- AC-QR-007-4 (MUST) THE SYSTEM SHALL emit at most one accepted result per scan session; later frames SHALL be ignored.
- AC-QR-007-5 (MUST) THE SYSTEM SHALL NOT apply, save or otherwise write anything because a code was scanned.

### REQ-QR-008 Explicit import, at most once
- AC-QR-008-1 (MUST) THE SYSTEM SHALL import a scanned capsule only when the user activates "Import scanned capsule"
  (click, Enter or Space). There SHALL be no auto-import.
- AC-QR-008-2 (MUST) THE SYSTEM SHALL route the held bytes through the public Capsule import API
  (`importCapsuleIntoPersisted`, the function the file flow uses), so the app, document, checksum and size checks run
  there and its save outcome (`persisted` true or false) is reported unchanged.
- AC-QR-008-3 (MUST) WHEN the import button is activated twice before the first import settles (two activations in one
  task, or two key presses), THE SYSTEM SHALL start exactly one import. The two pointer clicks in one task of E2E-QR-05
  are the one deliberate exception to the keyboard-only rule (AC-QR-013-1, NFR-QR-004).
- AC-QR-008-4 (MUST) WHEN a capsule with the same checksum (capsule metadata `sha256`) was already applied in the current
  open session, or is being imported right now, and the user scans it again, THE SYSTEM SHALL show `already-imported`, offer
  no import, and apply nothing. WHILE a QR import is pending, the scan button SHALL be disabled, and the import action SHALL
  re-check the applied and in-flight checksums before it starts, so a capsule held before the import began is never applied
  a second time. Scope of this check (decision R4): the applied set records QR imports only. A capsule applied by FILE import
  is not in the set, so scanning it later by QR is not shown as `already-imported`; it can be imported again and the merge
  applies no new data (idempotent, REQ-CAP-007). The QR panel and `docs/progress.md` state this.
- AC-QR-008-9 (MUST) (cross-direction import guard, decision R3) WHILE a FILE import is pending, THE SYSTEM SHALL disable "Scan QR
  code (camera)" and `startScan` SHALL do nothing; a scan already running when a file import starts SHALL be stopped. WHILE a QR
  import is pending, THE SYSTEM SHALL disable the file input and `importFile` SHALL refuse to run. Both refusals are made in the
  session controller (one "importing" import state covers both sources), not only in the view.
- AC-QR-008-5 (MUST) WHILE an import is pending, THE SYSTEM SHALL ignore a new import activation, and Change board and
  Update now SHALL stay disabled (the existing import-pending guard, now also covering QR imports).
- AC-QR-008-6 (MUST) THE SYSTEM SHALL bind a held scan result and an in-flight QR import to the session they started
  on. IF the session changes, THE SYSTEM SHALL discard the held bytes and SHALL NOT let an old result publish an error,
  update the view or refresh another board.
- AC-QR-008-7 (MUST) WHEN a QR import applies but cannot be saved, THE SYSTEM SHALL show the same "applied, but NOT saved
  to this device" alert, with Retry save and backup, as the file flow, and SHALL NOT apply the same code a second time.
- AC-QR-008-8 (MUST) WHEN a QR import is rejected (wrong app, wrong board, checksum, unsupported version, oversized), THE
  SYSTEM SHALL leave the stored record and save sequence unchanged and show the existing mapped message.

### REQ-QR-009 Same bytes, same pipeline, same outcomes
- AC-QR-009-1 (MUST) FOR the same capsule bytes, a QR import and a file import SHALL produce the same import view (state,
  code, message, metadata, diff).
- AC-QR-009-2 (MUST) THE SYSTEM SHALL put no merge, capsule-parsing or storage logic in the QR code path of the app or
  of `@ghostsync/qr-transfer`. The app's QR modules SHALL NOT import `@ghostsync/kit` or `yjs`.

### REQ-QR-010 File transfer stays available
- AC-QR-010-1 (MUST) THE SYSTEM SHALL keep the file export button, file input and their labels present and enabled in
  every QR state (idle, requesting, scanning, scanned, denied, no camera, unsupported, insecure, failed, too large, too
  narrow), except that the file input is disabled while an import is pending, as today.
- AC-QR-010-2 (MUST) AFTER any QR failure, a real `.gscap` file import through the file input SHALL succeed.
- AC-QR-010-3 (MUST) THE SYSTEM SHALL keep "Scan QR code (camera)" enabled and focusable on devices without a usable
  camera, and explain on activation (a disabled control cannot explain).

### REQ-QR-011 Transfer mode and status
- AC-QR-011-1 (MUST) THE SYSTEM SHALL show the transfer mode in use in the existing `transfer-mode` element, with a
  matching `data-transfer-mode`: `file` ("Transfer: file (.gscap)", the unchanged default), `qr-scan` ("Transfer: QR
  scan (camera)") while a scan session, held result or QR import is active, and `qr-show` ("Transfer: QR show
  (screen)") while a code is displayed. It SHALL return to `file` when none applies.
- AC-QR-011-2 (MUST) THE SYSTEM SHALL keep the network chip visible and correct while QR panels are open.
- AC-QR-011-3 (MUST) THE SYSTEM SHALL announce each scan state change in a polite live region (`role="status"`).

### REQ-QR-012 Security and privacy
- AC-QR-012-1 (MUST) THE SYSTEM SHALL treat every scanned payload as untrusted capsule input: bound size first, validate
  before applying, apply only after explicit import and all checks.
- AC-QR-012-2 (MUST) THE QR panels SHALL state that the capsule checksum detects corruption and does not authenticate the
  sender, and that anyone who can show a code can show a valid capsule.
- AC-QR-012-3 (MUST) THE SYSTEM SHALL NOT send, store or log camera frames or decoded text. `@ghostsync/qr-transfer` SHALL
  contain no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, storage or IndexedDB call. Scanning SHALL write nothing
  to IndexedDB or `localStorage`.
- AC-QR-012-4 (MUST) THE SYSTEM SHALL keep the Content Security Policy free of `unsafe-eval` and `wasm-unsafe-eval`, and a
  scan SHALL cause no `securitypolicyviolation` event.
- AC-QR-012-5 (MUST) THE production build SHALL contain no test-only camera injection (names listed in design 13.6).
- AC-QR-012-6 (SHOULD) Fixtures, images and artifacts SHOULD contain only synthetic board IDs, titles and notes (review).

### REQ-QR-013 Accessibility and responsive layout
- AC-QR-013-1 (MUST) EVERY QR action SHALL be operable by real key presses with a visible 3 px focus outline. The only
  pointer clicks are the two in one task of the double-activation case (AC-QR-008-3, E2E-QR-05).
- AC-QR-013-2 (MUST) THE page SHALL have no horizontal overflow at 320 x 640 and 1280 x 800 with each QR panel state.
- AC-QR-013-3 (MUST) EVERY QR error message SHALL name the problem and a next step, and SHALL mention file transfer when
  the failure is about the camera, the size or the device.
- AC-QR-013-4 (MUST) THE SYSTEM SHALL move focus to "Import scanned capsule" when a code is accepted, back to "Scan QR
  code (camera)" after cancel or discard, and to "Show QR code" after hiding.
- AC-QR-013-5 (SHOULD) Escape SHOULD cancel an active scan.
- AC-QR-013-6 (SHOULD) The video element SHOULD have an accessible name.

### REQ-QR-014 Packaging and architecture
- AC-QR-014-1 (MUST) THE new package SHALL be `@ghostsync/qr-transfer` in `packages/qr-transfer`. It SHALL import nothing
  from `@ghostsync/kit`, `@ghostsync/capsule`, `@ghostsync/persist`, `yjs`, `node:` or any app.
- AC-QR-014-2 (MUST) PatchBoard SHALL consume only the package's public entry points (`@ghostsync/qr-transfer` and
  `@ghostsync/qr-transfer/browser`), never a deep import into `src` or `dist`.
- AC-QR-014-3 (MUST) THE package's runtime dependencies SHALL be exactly `uqr` 0.1.3 and `jsqr` 1.4.0, exact-pinned, and its
  dev dependencies SHALL be exact-pinned to versions already in the repo.
- AC-QR-014-4 (MUST) THE milestone SHALL NOT change `packages/kit`, `packages/capsule`, `packages/persist` or
  `apps/fieldledger`.
- AC-QR-014-5 (MUST) THE package SHALL carry `THIRD_PARTY_NOTICES.md` naming `jsqr` 1.4.0 (Apache-2.0) and `uqr` 0.1.3 (MIT).
- AC-QR-014-6 (MUST) THE lockfile diff SHALL add only the `packages/qr-transfer` importer, the `apps/patchboard` dependency
  edge, and the `uqr` and `jsqr` packages.

### REQ-QR-015 Test-only camera injection
- AC-QR-015-1 (MUST) THE fake camera SHALL live only in `apps/patchboard/e2e/` (installed with `addInitScript`) and SHALL
  replace `navigator.mediaDevices.getUserMedia` with a stub that returns a real `MediaStream` from a canvas.
- AC-QR-015-2 (SHOULD) Fixture frames for tests other than E2E-QR-01 SHOULD be drawn by the test helper's own rasterizer,
  not by the app's paint code, so a paint bug cannot hide behind a matching decoder.

### REQ-QR-016 Physical acceptance (EV-PHYS)
- AC-QR-016-1 (MUST) THE team SHALL declare static QR transfer "supported" only after PHYS-QR-01 records at least 9
  successful scans out of 10 attempts in EACH of two capsule size classes, each within 15 s, on a real iPhone in Safari
  (iOS version and iPhone model recorded), with networking disabled after setup (conditions in design section 14).
- AC-QR-016-2 (MUST) THE automated suite SHALL NOT write, infer or report an EV-PHYS result. Progress reporting SHALL list
  EV-UNIT, EV-FIXTURE, EV-DIST and EV-PHYS on separate lines, and EV-PHYS SHALL read NOT RUN until a person fills in the
  results template (satisfied: docs/progress.md entry 2026-11-16 lists the four lines separately; EV-PHYS: PASS, user-reported).
- AC-QR-016-3 (MUST) IF the threshold is missed, THE team SHALL apply the fallback ladder in design section 14.3 and record
  which rung applied. The file baseline SHALL ship regardless.
- AC-QR-016-4 (SHOULD) A second device or browser (for example an Android phone with Chrome) SHOULD be tried and recorded as informational.

### REQ-QR-017 Animated multi-frame QR (OPTIONAL tier, not part of the MVP)
Not built and not gating the MVP. Start only after AC-QR-016-1 passes (gate G1). Details in design section 12.
- AC-QR-017-1 (OPTIONAL) Frames SHOULD use prefix `GSA1:` and a 16-byte header (transfer ID 8, index 2, count 2, total
  length 4), 512 payload bytes per frame, at most 64 frames and 32768 capsule bytes in total.
- AC-QR-017-2 (OPTIONAL) The reassembler SHOULD validate each header against these bounds BEFORE allocating, allocate one
  buffer of exactly the declared total length after the first valid frame, and hold one transfer at a time.
- AC-QR-017-3 (OPTIONAL) Duplicate frames (same index, same bytes) SHOULD be ignored; a same-index frame with different
  bytes SHOULD abort the transfer; out-of-order frames SHOULD be accepted.
- AC-QR-017-4 (OPTIONAL) Frames with another transfer ID, count or total length SHOULD be rejected and never merged; the
  user SHOULD cancel to start another transfer.
- AC-QR-017-5 (OPTIONAL) A transfer SHOULD expire 120 s after its first frame or 30 s after its last new frame, and Cancel
  and any session change SHOULD discard the buffer and stop the camera.
- AC-QR-017-6 (OPTIONAL) The completed bytes SHOULD enter the same preview, explicit import and at-most-once path as the
  static code.

### REQ-QR-018 Second-app consumption (SHOULD, documentation only)
- AC-QR-018-1 (SHOULD) The design SHOULD show how FieldLedger adopts the same API, and name the prerequisites (an
  import-pending guard and session-bound results in its controller).

## 7. Non-functional requirements
- NFR-QR-001 Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), no `any`.
- NFR-QR-002 `pnpm@10.34.9` only (`pnpm.cmd` on Windows). No other package manager or lockfile.
- NFR-QR-003 Property tests: four separately named 50-case batches per property, seeds 424242 to 424245,
  `numRuns === 50` and `numSkips === 0` asserted per batch, default 5 s timeout, no overrides.
- NFR-QR-004 No `test.skip`, `test.fixme`, retries or timeout overrides. Each action is activated once (by keyboard),
  then the observable result is awaited. No click inside `expect.poll`, no click loop. The one named exception is the two
  clicks in one task of the double-activation case in E2E-QR-05 (AC-QR-008-3).
- NFR-QR-005 Transport, storage and merge stay separate. Merge is the Kit's, durability is Persist's, file validation is
  Capsule's, transport is `@ghostsync/qr-transfer`'s.
- NFR-QR-006 Offline behavior: every scan and import test that touches the app runs with the browser context offline
  after the first online load.

## 8. Limitations and decisions
### 8.1 Explicit limitations
- L-1 A static code carries at most 1232 capsule bytes. With the built Kit at `fd9b9da` an empty board is 328 bytes and
  each card with a 12-character title and 18-character notes adds about 330 bytes, so about two cards fit. This is a
  first-deliverable limit; larger boards use file transfer.
- L-2 A capsule checksum detects corruption; it does not authenticate the sender. A QR code proves nothing about who
  showed it.
- L-3 Fixture tests (EV-FIXTURE) do not exercise optics. Only EV-PHYS does; it is PASS (user-reported, 2026-11-16, one device and one browser; it was NOT RUN before that date).
- L-4 The scanner is a pure-JavaScript decoder (`jsqr` 1.4.0, 1.4.0 uploaded 2021-04; the registry's modified date is later, 2025-11, with no newer release; not actively maintained). Dense version-25
  codes may be marginal on some phones. The ladder in design 14.3 is the plan if so.
- L-5 BarcodeDetector is not used. Its support is partial (design section 17), so it cannot be the only path.
- L-6 A phone needs a secure context (HTTPS) to use the camera and the service worker. A plain-HTTP LAN address will not work. `localhost` on an iPhone is the phone itself, so the physical test needs a real HTTPS origin whose certificate the iPhone trusts (design 14.1).
- L-7 The "already imported" memory lasts for one open session and records QR imports only: a file-imported capsule scanned
  later by QR is not recognized (R4). After a reload a re-scan is allowed; the merge is
  idempotent (REQ-CAP-007), so it applies no new data.
- L-8 Chromium is the only automated browser. iPhone Safari is the physical target (retargeted from Android Chrome, see design 14); any other device is informational.
- L-9 Anything marked UNVERIFIED in design section 17 was not confirmed from an authoritative source in this pass.
- L-10 The Playwright fake-device flags are a secondary option (E2E-QR-13, SHOULD).
- L-11 A rejected scan reuses the file flow's message text (AC-QR-009-1 needs identical outcomes), so some messages say "file" or
  "export" for a scanned code. Neutral wording is a possible later change that must update both flows and their tests.

### 8.2 Decisions (rationale and alternatives in design section 2)
| ID | Decision |
| --- | --- |
| D-QR-1 | Shared package `@ghostsync/qr-transfer` at `packages/qr-transfer`; two entry points (pure, and `/browser`) |
| D-QR-2 | First camera integration in PatchBoard; FieldLedger adopts later |
| D-QR-3 | Single static frame `GSQ1:` + Base45 in QR alphanumeric mode |
| D-QR-4 | Exact limit 1232 capsule bytes = 1853 frame characters = version 25, level L |
| D-QR-5 | One scanner engine in the MVP: bundled pure-JS `jsqr` 1.4.0. BarcodeDetector deferred, WASM and Workers not used |
| D-QR-6 | Encoder `uqr` 0.1.3 |
| D-QR-7 | Decoder ships as a lazy chunk that the existing precache plugin lists automatically; no plugin change |
| D-QR-8 | Browser tests use a `getUserMedia` stub backed by `canvas.captureStream()`; Chromium fake-device flags are a SHOULD smoke test |
| D-QR-9 | At-most-once: capsule `sha256` set per open session plus a synchronous pending token, reusing the import-pending guard |
| D-QR-10 | Physical gate (iPhone Safari): at least 9 of 10 scans in each of two size classes within 15 s; fallback ladder 1232 -> 829 -> 502 bytes -> ship file-only |
| D-QR-11 | Animated QR stays OPTIONAL behind gate G1 |

## 9. Acceptance-criterion traceability (every MUST)
Evidence labels are in section 5. Observation vocabulary (exact definitions in design section 13.1):
- UI = DOM observation with the selectors in design section 9.
- P1 = the raw IndexedDB record of the page, decoded in Node (`storedState(page)`, as PatchBoard's E2E helpers).
- Unit tests are `U-QR-nn`; property batches are `P-QR-nn`; dist checks are `D-QR-01`; browser tests are `E2E-QR-nn`;
  the physical test is `PHYS-QR-01`.
- Every test row is PLANNED. None has run.
- EV-PHYS appears only on the AC-QR-016 rows. It was NOT RUN until 2026-11-16 and is now PASS (user-reported manual test, section 5.1).

| AC | Evidence | Named test(s) | Exact observation |
| --- | --- | --- | --- |
| AC-QR-001-1 | EV-UNIT | U-QR-02 frame.test.ts; P-QR-02 | `encodeFrame(Uint8Array.of(0x41,0x42))` equals `GSQ1:BB8`. For random bytes, `text.startsWith("GSQ1:")` and every character of `text.slice(5)` is in `0-9A-Z $%*+-./:`; no whitespace other than the Base45 space character |
| AC-QR-001-2 | EV-UNIT | U-QR-02; P-QR-02 | n=1232 gives `text.length === 1853`; n=1233 throws `QrTransferError` code `TooLarge`; n=0 throws code `Empty`; for random n in 1..1232, `text.length === 5 + 3*floor(n/2) + 2*(n%2)` |
| AC-QR-001-3 | EV-UNIT | U-QR-01 base45.test.ts | `Hello!!` -> `%69 VD92EX0`; `base-45` -> `UJCLQE7W581`; `QED8WEX0` -> `ietf!`; `FGW` -> `[255,255]`; `GGW` throws `OutOfRange`; `U5` -> `[255]`; `V5` throws `OutOfRange`; a single leftover character throws `InvalidLength` |
| AC-QR-001-4 | EV-UNIT | P-QR-01 base45.property.test.ts (4 batches) | for random `Uint8Array` of length 1..1232 (including all-zero and all-0xFF): `decodeFrame(encodeFrame(b))` deep-equals `b`; each batch `numRuns=50 numSkips=0` |
| AC-QR-001-5 | EV-UNIT | U-QR-02 | `GSQ2:ABC` throws `UnsupportedVersion`; `GSA1:ABC` throws `AnimatedNotSupported`; `HTTPS://EXAMPLE.INVALID` throws `NotGhostSync` |
| AC-QR-002-1 | EV-UNIT | U-QR-02 | a 1854-character text made only of lowercase letters throws code `TooLarge` (not `InvalidCharacter`), and the injected `allocate` spy has 0 calls; a 1855-character text (the length of a 1233-byte frame) also throws `TooLarge` with 0 `allocate` calls (G3) |
| AC-QR-002-2 | EV-UNIT | U-QR-02 (allocation seam) | for each rejection (type, length, prefix, length mod 3, bad character, group above 65535, group above 255) the `allocate` spy has 0 calls; for a valid frame it has exactly 1 call whose argument equals the decoded length |
| AC-QR-002-3 | EV-UNIT | U-QR-02 | `" "+frame` throws `NotGhostSync`; `frame+"\n"` and `frame.toLowerCase()` throw `InvalidCharacter`; for an ODD byte count (frame length 1852 or less, so the result fits the length bound), `frame+" "` throws `OutOfRange` (the last group becomes `x y " "` with `e = 36`, value at least 72900 > 65535), for example bytes `[0x41]`: `GSQ1:K1 `; for an EVEN byte count (at most 1230), `frame+" "` throws `InvalidLength` (payload length becomes 1 mod 3), for example `[0x41,0x42]`: `GSQ1:BB8 `. Interior space: `decodeFrame("GSQ1: 0")` returns `[0x24]`, and `decodeFrame("GSQ1: 0 ")` throws `OutOfRange` (group `" 0 "` = 72936). No case returns bytes |
| AC-QR-002-4 | EV-UNIT | U-QR-10 qr-import-flow.test.ts | `importBytes(new Uint8Array(1233), "qr")` records `importView.state === "rejected"`, `code === "OversizedRaw"`, `applyUpdate` spy has 0 calls; a valid 1232-byte capsule through the same QR import path is not rejected as `OversizedRaw` and `applyUpdate` has exactly 1 call (G2) |
| AC-QR-003-1 | EV-UNIT | U-QR-03 symbol.test.ts | `buildQrSymbol(encodeFrame(b1232)).version === 25` and `.size === 117`; the call options record `ecc "L"`, `minVersion 1`, `maxVersion 25`, `boostEcc false`. Decoded mode (G1, in U-QR-04): the jsqr result for the rasterized 1232-byte symbol has `version === 25`, `chunks.length === 1`, `chunks[0].type === "alphanumeric"` and `chunks[0].text` equals the frame text |
| AC-QR-003-2 | EV-UNIT | U-QR-03 | versions for sizes 328, 658, 988, 1231, 1232 equal 12, 18, 24, 25, 25 (version 23 is skipped, see AC-QR-003-2) |
| AC-QR-003-3 | EV-UNIT | U-QR-03 | `buildQrSymbol("GSQ1:" + "0".repeat(1849))` (1854 characters) throws `TooLarge`; no symbol is returned |
| AC-QR-003-4 | EV-UNIT | U-QR-04 raster-roundtrip.test.ts; P-QR-03 (4 batches) | rasterize modules at scale 4 with a 4-module quiet zone, decode with the scanner's `decodeImage`, text equals the frame for sizes 11, 328, 658, 988, 1231, 1232, the interior-space frame `GSQ1: 0` (byte 0x24: byte-for-byte equal after `decodeFrame`, exact text equal at the scan step), and random sizes in 11..1232 (generator biased to include bytes with value % 45 == 36). Separately, the synthetic text `GSQ1: 0 ` (not an `encodeFrame` output) is returned verbatim by the engine/scan path (no trim, no case change) and `decodeFrame` of it throws `OutOfRange`. For the 1232-byte symbol the decoded `chunks[0].type` is `"alphanumeric"` and `version` is 25 (G1) |
| AC-QR-004-1 | EV-UNIT; EV-FIXTURE | U-QR-10; E2E-QR-01 | unit: the bytes passed to `encodeFrame` are the exact array returned by `buildCapsule("export")`. UI: the receiver's `qr-meta-checksum` text equals the sender's `qr-show-checksum` text, and `decodeCapsule` of the bytes behind the receiver's preview reports `app` `patchboard` and `documentId` `sprint-board`. (A later file export has a different `createdAt`, so its checksum differs; the check is between the two screens.) |
| AC-QR-004-2 | EV-FIXTURE | E2E-QR-09 | board with one 2000-character note: after "Show QR code", `qr-show-panel[data-qr-state="too-large"]`, no `canvas[data-testid="qr-canvas"]`, `qr-show-message` contains the capsule size and `1232`; `export-btn` enabled |
| AC-QR-004-3 | EV-FIXTURE | E2E-QR-01; E2E-QR-08 | at 1280 x 800 `qr-canvas[data-qr-scale]` is an integer >= 4, `data-qr-modules` equals `size + 8`, and its pixel at (0,0) is white and its pixel at (4*scale+1, 4*scale+1), inside the first finder module, is black. At 320 x 640 `qr-show-panel[data-qr-state="too-narrow"]` and no canvas |
| AC-QR-004-4 | EV-FIXTURE | E2E-QR-01 | `qr-show-bytes`, `qr-show-version`, `qr-show-checksum` are visible and match `qr-canvas[data-qr-bytes]`, `[data-qr-version]` |
| AC-QR-004-5 | EV-FIXTURE | E2E-QR-03; E2E-QR-10 | after Hide, and after Change board, `qr-canvas` count is 0 |
| AC-QR-005-1 | EV-FIXTURE | E2E-QR-07 | the test stub's `getUserMedia` call count is 0 after load, join, reload and file import, and 1 after one activation of `qr-scan-btn` |
| AC-QR-005-2 | EV-UNIT | U-QR-05 scan-session.test.ts | the fake `getUserMedia` receives exactly `{ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }` |
| AC-QR-005-3 | EV-UNIT; EV-FIXTURE | U-QR-05; E2E-QR-02 | fake rejects `NotAllowedError`, `NotFoundError`, `NotReadableError`, `SecurityError`, other, and a missing `mediaDevices`: states `denied`, `no-camera`, `in-use`, `insecure`, `failed`, `unsupported`. UI: `qr-scan-panel[data-qr-state]` equals the state and `qr-scan-message` contains the next step and the word "file" |
| AC-QR-005-4 | EV-UNIT; EV-FIXTURE | U-QR-05; E2E-QR-03 | stub-recorded track `readyState === "ended"` and `video.srcObject === null` after: Cancel, accepted code, `pagehide`, hidden `visibilitychange`, Change board, and error after acquisition; unit also: 120 s fake-timer timeout gives state `timed-out` with tracks ended. Each start holds its own stream; a stale start's cleanup never touches a newer session's stream (see AC-QR-005-5) |
| AC-QR-005-5 | EV-UNIT | U-QR-05 | deferred-await cases, each with `stop()` called while one await is deferred, for `getUserMedia`, `loadEngine` and `video.play()`, each in a RESOLVE and a REJECT variant; then settle it. In each: the fake track `stop` spy has exactly 1 call (where a stream exists), `video.srcObject` is `null`, final state is `idle`, no `scanning` and no `failed` state was ever emitted (the generation check comes first, so a stale rejection emits nothing). Restart regressions: (a) Cancel then IMMEDIATE re-Scan, the OLD `getUserMedia` resolving AFTER the new stream is active: each old track `stop` spy has exactly 1 call; each new track has 0 `stop` calls and `readyState === "live"`; `video.srcObject` is still the new stream; the new loop keeps running and a valid frame still yields exactly 1 `onAccepted`; the final `stop()` calls each new track's `stop` exactly once. (b) The old start's `loadEngine` REJECTS after the new session is `scanning`: no `failed` state emitted, new session unaffected, old stream tracks stopped once. (c) The same for a rejected `play()` of the old start. Negative control: an implementation with one shared mutable `currentStream` field cleared by stale continuations MUST fail case (a). Also: a track `ended` event while `scanning` gives state `failed` with the tracks stopped |
| AC-QR-005-6 | EV-UNIT | U-QR-05 | second `start()` while active returns without a second `getUserMedia` call; `stop()` twice leaves one `stop` call per track |
| AC-QR-006-1 | EV-DIST; EV-FIXTURE | D-QR-01 `tests/dist-scan.test.ts`; E2E-QR-07 | dist has no `.wasm` file, no `new Worker`, no `https://` or `jsdelivr`/`unpkg` string in `assets/*.js`, CSP meta unchanged (no `unsafe-eval`, no `wasm-unsafe-eval`). E2E: during a scan the request recorder shows only same-origin GETs and no request after the decoder chunk |
| AC-QR-006-2 | EV-DIST | D-QR-01 | every `dist/assets/*` file name appears in `precache-manifest.json` entries; at least one `assets/*.js` other than `index-*.js` contains the `jsQR` decoder marker |
| AC-QR-006-3 | EV-FIXTURE | E2E-QR-07 | fresh profile loads online until `data-offline-ready="true"`, `setOffline(true)`, reload, join, activate scan with a valid code: `qr-scan-panel[data-qr-state="scanned"]`; `page.on("request")` saw no non-`localhost` URL |
| AC-QR-006-4 | EV-FIXTURE | E2E-QR-07 | after first load and before any activation, no PAGE-initiated request (`request.frame() !== null`) has a URL containing the decoder chunk name from the manifest (the service worker's own precache fetch is allowed), the stub's `getUserMedia` count is 0, and `html[data-offline-ready]` is `true` |
| AC-QR-007-1 | EV-FIXTURE | E2E-QR-06 | for each of: URL code, `GSQ2:` code, `GSA1:` code, 1854-character code, lowercase code: `qr-scan-panel[data-qr-state="scanning"]` stays, `qr-scan-hint` text names the cause, `qr-video` still has a live track, stored record equals the pre-scan record |
| AC-QR-007-2 | EV-FIXTURE | E2E-QR-04 | after a valid code: `data-qr-state="scanned"`, stub track ended, `qr-meta-app` `patchboard`, `qr-meta-document-id` `sprint-board`, `qr-meta-created-at`, `qr-preview-bytes` equal the capsule size, `qr-meta-checksum` equals `sha256.slice(0,12)` of the fixture capsule |
| AC-QR-007-3 | EV-FIXTURE | E2E-QR-06 | codes carrying a corrupted-checksum capsule, a truncated capsule and a version-2 capsule give `data-qr-state="rejected"`, `qr-scan-message` equals the mapped file-flow text (`This file looks damaged ...` family), `qr-import-btn` count 0, P1 unchanged |
| AC-QR-007-4 | EV-UNIT | U-QR-05 | engine fake returns a valid frame on frames 3, 4 and 5: `onResult` has exactly 1 call, tracks stopped after the first |
| AC-QR-007-5 | EV-FIXTURE | E2E-QR-04 | after `scanned` and a further 1 s of the stub still showing the code, `storedState(page)` deep-equals the pre-scan state and `save-indicator[data-save-sequence]` is unchanged |
| AC-QR-008-1 | EV-FIXTURE | E2E-QR-04 | `import-result[data-import-state]` absent until `press(qr-import-btn)`; then `applied-saved`; the board shows the two fixture cards and P1 matches |
| AC-QR-008-2 | EV-UNIT | U-QR-10 | with a fake persisted target: `applyUpdate` receives `{documentId, kind: "full", bytes}` once; `flush` called after; result `persisted` true; with `flush` rejecting, view is `applied-unsaved` with `code` from the save error |
| AC-QR-008-3 | EV-UNIT; EV-FIXTURE | U-QR-10; E2E-QR-05 | unit: two `importScanned()` calls in one task give 1 `applyUpdate` call (and one call returns with the held capsule kept when `importPending`; when `importBytes` returns without importing the view says "The import did not run. Scan the code again."). UI: `page.evaluate(() => { b.click(); b.click(); })` on `qr-import-btn` then `applied-saved` and `save-indicator[data-save-sequence]` increased by exactly 1 |
| AC-QR-008-4 | EV-UNIT; EV-FIXTURE | U-QR-10; E2E-QR-05 | after an applied import, scanning the same fixture again gives `data-qr-state="already-imported"`, `qr-import-btn` count 0, `applyUpdate` count unchanged (unit), `data-save-sequence` unchanged (UI). Pending-import window: with the import held open, `qr-scan-btn` is disabled and `startScan` is a no-op (unit: `getUserMedia` count unchanged); unit: a capsule held before the import started, then the same sha256 applied by another path, gives `already-imported` and `applyUpdate` count 1 when `importScanned` runs. UI: with `SubtleCrypto.digest` held, `qr-scan-btn` is disabled; after release `qr-scan-btn` is enabled, a rescan shows `already-imported`, `data-save-sequence` rose by exactly 1 |
| AC-QR-008-9 | EV-UNIT; EV-FIXTURE | U-QR-10; E2E-QR-05b | unit: a pending file import gives `scanDisabled` true and `startScan` creates no scan session, and a running scan is stopped when a file import starts; a pending QR import makes `importFile` refuse without reading the file, and `importBytes` returns false while a file import is pending. UI: with the file read held, `qr-scan-btn` is disabled and a forced click leaves the `getUserMedia` count unchanged; with the checksum digest held, `import-input` is disabled; both re-enable after release |
| AC-QR-008-5 | EV-UNIT; EV-FIXTURE | U-QR-10; E2E-QR-05 | with `SubtleCrypto.digest` held test-side: `import-result[data-import-state="importing"]`, `change-board` and Update now disabled, a second activation starts nothing; after release both are enabled and the import is `applied-saved` |
| AC-QR-008-6 | EV-UNIT; EV-FIXTURE | U-QR-10; E2E-QR-10 | unit: a held result then `changeBoard` leaves no held result; a delayed import result after a session change publishes no `importView`, no refresh. UI: scan on board A, Change board, open board B: `qr-scan-panel[data-qr-state="idle"]`, `qr-import-btn` count 0, B's stored record unchanged |
| AC-QR-008-7 | EV-FIXTURE | E2E-QR-12 | setup writes flushed and asserted, one-shot write abort armed, QR import: `save-error-alert[data-save-error-kind="import"]`, board shows the cards, rescan gives `already-imported`, `Retry save` by keyboard gives `data-save-state="saved"` and P1 holds the cards |
| AC-QR-008-8 | EV-FIXTURE | E2E-QR-06 | wrong-app and wrong-board capsule codes: preview shows, `press(qr-import-btn)`, `import-result[data-import-state="rejected"]` with `data-import-code` `AppIdentityMismatch` / `DocumentIdentityMismatch`, P1 deep-equals the pre-import state and sequence |
| AC-QR-009-1 | EV-UNIT | U-QR-10 | for 6 byte arrays (valid, valid duplicate, wrong app, wrong board, bad checksum, truncated) `importView` after `importFile(file)` deep-equals `importView` after `importBytes(bytes, "qr")` apart from the `source` field |
| AC-QR-009-2 | EV-UNIT | U-QR-13 qr-boundary.test.ts; U-QR-06 | static scan: no file under `apps/patchboard/src/transfer/qr/` or `packages/qr-transfer/src/` matches `@ghostsync/kit`, `from "yjs"`, or `Y.` |
| AC-QR-010-1 | EV-FIXTURE | E2E-QR-02; E2E-QR-08; E2E-QR-09 | in each failure state, `export-btn` and `import-input` are enabled (`toBeEnabled`) and labelled |
| AC-QR-010-2 | EV-FIXTURE | E2E-QR-02 | after `denied`, a real `.gscap` file is imported with `setInputFiles`: `import-result[data-import-state="applied-saved"]` and `transfer-mode[data-transfer-mode="file"]` |
| AC-QR-010-3 | EV-FIXTURE | E2E-QR-02 | with `navigator.mediaDevices` deleted, `qr-scan-btn` is enabled and focusable; activation gives `data-qr-state="unsupported"` |
| AC-QR-011-1 | EV-UNIT; EV-FIXTURE | U-QR-11 transfer-mode.test.ts; E2E-QR-01, 03 | unit: label and attribute for each state. UI: `transfer-mode` text `Transfer: file (.gscap)` / `Transfer: QR scan (camera)` / `Transfer: QR show (screen)` with matching `data-transfer-mode`, and back to `file` after cancel, hide, import and session change |
| AC-QR-011-2 | EV-FIXTURE | E2E-QR-01 | `network-chip` reads `Network: offline` while `qr-scan-panel` is `scanning` |
| AC-QR-011-3 | EV-FIXTURE | E2E-QR-01; E2E-QR-02 | `qr-scan-message` has `role="status"` and its text changes to the state text at each of `scanning`, `scanned`, `denied` |
| AC-QR-012-1 | EV-UNIT; EV-FIXTURE | U-QR-02; P-QR-04 qr-mutation.property.test.ts (4 batches); E2E-QR-04, 06 | see AC-QR-002-1..4, AC-QR-007-5, AC-QR-008-1 and AC-QR-008-8; plus P-QR-04: for a real capsule frame and any single-character mutation, either `decodeFrame` throws a `QrTransferError`, or `decodeCapsule` of the result rejects, or the bytes equal the original; never a different accepted capsule |
| AC-QR-012-2 | EV-FIXTURE | E2E-QR-08 | `qr-show-panel` and `qr-scan-panel` text each contain `detects corruption` and `does not authenticate the sender` |
| AC-QR-012-3 | EV-UNIT; EV-FIXTURE | U-QR-06 package-boundary.test.ts; E2E-QR-07 | static scan: no `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `localStorage` in `packages/qr-transfer/src`. UI: during a scan the request recorder adds 0 requests and `storedState(page)` and `localStorage` key list are unchanged |
| AC-QR-012-4 | EV-DIST; EV-FIXTURE | D-QR-01; E2E-QR-07 | dist CSP meta equals the pre-change string; the page recorded 0 `securitypolicyviolation` events during a full scan |
| AC-QR-012-5 | EV-DIST | D-QR-01 | `dist/**` contains none of `__ghostsyncCamera`, `__ghostsyncFixture`, `captureStream`, `qr-fixture`, plus the existing banned names |
| AC-QR-013-1 | EV-FIXTURE | E2E-QR-01, 02, 04, 05, 12 | each QR action is activated with the `press` helper (focus asserted, `outlineWidth === "3px"`, one key press); no pointer click, except the two clicks in one task of the E2E-QR-05 double-activation case (a named exception) |
| AC-QR-013-2 | EV-FIXTURE | E2E-QR-08 | at 320 x 640 and 1280 x 800, in states idle, scanning, scanned, rejected, show, too-narrow: `scrollWidth - clientWidth <= 0` |
| AC-QR-013-3 | EV-UNIT | U-QR-12 qr-errors.test.ts | every state and hint message in the design 9.3 table is at least 40 characters and contains an imperative next step; the `denied`, `no-camera`, `in-use`, `insecure`, `unsupported`, `failed`, `timed-out`, `show too-large` and `show too-narrow` messages contain `file` or `Export capsule` |
| AC-QR-013-4 | EV-FIXTURE | E2E-QR-03 | after accept `document.activeElement` is `qr-import-btn`; after Cancel it is `qr-scan-btn`; after Discard it is `qr-scan-btn`; after Hide it is `qr-show-btn` |
| AC-QR-014-1 | EV-UNIT | U-QR-06 | static scan of `packages/qr-transfer/src/**`: no `@ghostsync/`, `yjs`, `node:` or `../apps` import |
| AC-QR-014-2 | EV-UNIT | U-QR-13 | static scan of `apps/patchboard/src/**`: every import of `@ghostsync/qr-transfer` is exactly that or `@ghostsync/qr-transfer/browser`; no `qr-transfer/src` or `qr-transfer/dist` |
| AC-QR-014-3 | EV-UNIT | U-QR-06 | `package.json` `dependencies` deep-equals `{ "jsqr": "1.4.0", "uqr": "0.1.3" }`; every `devDependencies` value matches `^\d+\.\d+\.\d+$` |
| AC-QR-014-4 | EV-REVIEW | task 8.1 | exact command: `git status --short -- packages/kit packages/capsule packages/persist apps/fieldledger` prints nothing (pass = empty output) |
| AC-QR-014-5 | EV-UNIT | U-QR-06 | `THIRD_PARTY_NOTICES.md` exists and contains `jsqr`, `1.4.0`, `Apache-2.0`, `uqr`, `0.1.3`, `MIT` |
| AC-QR-014-6 | EV-REVIEW | task 8.1 | exact command: `git diff -U0 -- pnpm-lock.yaml`; pass = every added or removed importer or package key is `packages/qr-transfer`, the `apps/patchboard` `@ghostsync/qr-transfer` edge, `jsqr@1.4.0` or `uqr@0.1.3`, and nothing else is listed (any other key is a fail) |
| AC-QR-015-1 | EV-DIST; EV-FIXTURE | D-QR-01; E2E-QR-01 | dist has no stub names; E2E: `window.__ghostsyncCamera.calls` is defined only under the test hook and `getUserMedia` returns a `MediaStream` whose video track `readyState` is `live` |
| AC-QR-016-1 | EV-PHYS | PHYS-QR-01 (manual, task 9) | results template filled: per size class (classes of design 14.2 for the active rung) successes out of 10 and per-attempt seconds; PASS only if both classes have >= 9/10 within 15 s each, with Airplane Mode on with Wi-Fi off, `Network: offline` shown on the iPhone, the iOS version and iPhone model recorded, and `data-qr-scale` >= 5 on every attempt (a run below scale 5 is INVALID, not PASS or FAIL); Status: PASS (user-reported, 2026-11-16; record in section 5.1 and `docs/progress.md`; per-attempt seconds and scales not recorded, `Network: offline` indicator not separately reported) |
| AC-QR-016-2 | EV-REVIEW | task 10 | the progress note has four separate lines (EV-UNIT, EV-FIXTURE, EV-DIST, EV-PHYS) and EV-PHYS reads `NOT RUN` unless the template is filled and attached; Status: satisfied 2026-11-16, four separate lines in `docs/progress.md`, EV-PHYS: PASS (user-reported) |
| AC-QR-016-3 | EV-REVIEW; EV-PHYS | task 9.4 | the template's "rung applied" field names a rung from design 14.3, the shipped `QR_MAX_CAPSULE_BYTES` equals that rung's limit, and both classes of that rung (design 14.2 table: 829 -> S 300 to 400, L 750 to 829; 502 -> S 328, L 380 to 502) were re-run with each `data-qr-bytes` inside its range; Status: rung 1232 applied, no fallback; classes S 650 bytes and L 1232 bytes passed 10/10 each (user-reported, 2026-11-16); lower rungs not exercised |

## 10. Requirement to test summary
| Requirement | Node tests (EV-UNIT) | Dist (EV-DIST) | Chromium fixture (EV-FIXTURE) | Physical (EV-PHYS) |
| --- | --- | --- | --- | --- |
| REQ-QR-001 | U-QR-01, 02; P-QR-01, 02 | none | none | none |
| REQ-QR-002 | U-QR-02, 10 | none | none | none |
| REQ-QR-003 | U-QR-03, 04; P-QR-03 | none | E2E-QR-01, 08 | none |
| REQ-QR-004 | U-QR-10 | none | E2E-QR-01, 03, 08, 09, 10 | none |
| REQ-QR-005 | U-QR-05 | none | E2E-QR-02, 03, 07 | none |
| REQ-QR-006 | none | D-QR-01 | E2E-QR-07, 11 (SHOULD) | none |
| REQ-QR-007 | U-QR-05 | none | E2E-QR-04, 06 | none |
| REQ-QR-008 | U-QR-10 | none | E2E-QR-04, 05, 06, 10, 12 | none |
| REQ-QR-009 | U-QR-06, 10, 13 | none | none | none |
| REQ-QR-010 | none | none | E2E-QR-02, 09 | none |
| REQ-QR-011 | U-QR-11 | none | E2E-QR-01, 02, 03 | none |
| REQ-QR-012 | U-QR-02, 06; P-QR-04 | D-QR-01 | E2E-QR-04, 06, 07, 08 | none |
| REQ-QR-013 | U-QR-12 | none | E2E-QR-01, 02, 03, 04, 05, 08, 12 | none |
| REQ-QR-014 | U-QR-06, 13 | none | none | none |
| REQ-QR-015 | none | D-QR-01 | E2E-QR-01 | none |
| REQ-QR-016 | none | none | none | PHYS-QR-01 |
| REQ-QR-017 | planned U-QRA-nn (OPTIONAL, design 12.6) | none | none | none |
| REQ-QR-018 | none (SHOULD, documentation) | none | none | none |
