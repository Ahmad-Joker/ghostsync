# QR Transfer MVP: Tasks
Status: IMPLEMENTED. The manual physical test (task 9) is recorded as EV-PHYS: PASS, user-reported on 2026-11-16 (it was NOT RUN before that date); still open: 9.5 (optional second device), the optional items (12, 13) and the closing lists 10.2 and 10.3. A task is ticked only where its evidence is recorded in `docs/progress.md`. Baseline `fd9b9da`, branch
`feat/qr-transfer`. Requirement IDs refer to `requirements.md`; design sections refer to `design.md`. Test IDs (`U-QR-nn`,
`P-QR-nn`, `D-QR-01`, `E2E-QR-nn`, `PHYS-QR-01`) are defined in design sections 13.2 and 13.4 and in requirements section 9.

Rules for the implementer:
- Only `packages/qr-transfer/**`, `apps/patchboard/**`, `pnpm-lock.yaml` (via install), `.kiro/specs/qr-transfer/**` and
  `docs/progress.md` may change. `packages/kit`, `packages/capsule`, `packages/persist` and `apps/fieldledger` must not change
  (AC-QR-014-4). `.agents/` and `.review-artifacts/` stay untouched.
- Use `pnpm.cmd` from the repo root (never `pnpm`, `npm` or `yarn`). Add only `uqr` 0.1.3 and `jsqr` 1.4.0, exact-pinned.
- No `test.skip`, `test.fixme`, retries or timeout overrides. Keep the default 5 s unit timeout and Playwright's existing timeouts.
- Activate each action once by keyboard (the `press` helper), then await the observable result. No click inside `expect.poll`, no click loop.
  The one deliberate exception is the double-activation case in E2E-QR-05, which dispatches two clicks in one task on purpose.
- Failure injection and the fake camera stay in `apps/patchboard/e2e/`. Flush and assert setup writes before arming a one-shot failure.
- Write each pure test before the code it covers.
- Report evidence with separate labels (EV-UNIT, EV-FIXTURE, EV-DIST, EV-PHYS). Never report a fixture pass as a physical-camera
  pass. Do not claim a test passed without the command, exit code and totals recorded in `docs/progress.md`.
- Commit nothing until the reviewer asks; the working tree stays uncommitted for review.

## 1. Preflight
- [x] 1.1 Confirm `git branch --show-current` is `feat/qr-transfer`, `git rev-parse --short HEAD` is `fd9b9da`, and `git status --short`
  shows only the untracked `.agents/` and `.review-artifacts/` plus this spec and the progress note. Record the output.
- [x] 1.2 Baseline (so later differences are explainable): `pnpm.cmd install --frozen-lockfile`; build kit, capsule, persist
  (`pnpm.cmd -F @ghostsync/kit build`, `-F @ghostsync/capsule build`, `-F @ghostsync/persist build`); run `-F @ghostsync/patchboard typecheck`,
  `test`, `build`, `test:dist`, `test:e2e`; `-F @ghostsync/kit test`, `-F @ghostsync/capsule test`, `-F @ghostsync/persist test`,
  `-F @ghostsync/fieldledger typecheck` and `test`. Record each exit code and totals. `docs/progress.md` last recorded: PatchBoard 26 files /
  158 tests, 20 Chromium tests, dist 4, kit 112, capsule 120, persist 50, FieldLedger 81. If a total differs, record the new number
  as the baseline.

## 2. Package scaffold (REQ-QR-014)
- [x] 2.1 Create `packages/qr-transfer` files from design 6.1: `package.json` (`name` `@ghostsync/qr-transfer`, `private`, `type module`, `exports` `.` and
  `./browser` each with `types` and `import`, scripts `typecheck`, `test`, `build`; dependencies exactly `jsqr` `1.4.0` and `uqr` `0.1.3`; exact-pinned
  devDependencies `fast-check` 4.10.2, `typescript` 7.0.2, `vitest` 5.1.0, `@types/node` 24.19.2; no workspace dependency), `tsconfig.json`,
  `tsconfig.build.json`, `vitest.config.ts`, `vitest.setup.ts` (`fc.configureGlobal({ numRuns: 200, seed: 424242 })`), `tests/batches.ts` and
  `tests/fc-report.ts` copied from `apps/patchboard/tests` (not named `*.test.ts`). (AC-QR-014-1, 014-3)
- [x] 2.2 Run `pnpm.cmd install`. Inspect `git diff -- pnpm-lock.yaml`: only the `packages/qr-transfer` importer and the `uqr` and `jsqr` packages (the
  PatchBoard edge comes in 5.1). Then `pnpm.cmd install --frozen-lockfile`. (AC-QR-014-6)
- [x] 2.3 Add `THIRD_PARTY_NOTICES.md` (`jsqr` 1.4.0 Apache-2.0 with its copyright and license reference; `uqr` 0.1.3 MIT) and `README.md` (scope, "a checksum detects
  corruption; it does not authenticate the sender", limits, API). (AC-QR-014-5)

## 3. Pure codec, tests first (REQ-QR-001, 002, 003)
- [x] 3.1 `tests/base45.test.ts` (U-QR-01) then `src/base45.ts`: RFC 9285 vectors from design 3.2, boundaries `FGW`/`GGW`/`U5`/`V5`, leftover character, lowercase, empty.
  Property `tests/base45.property.test.ts` (P-QR-01, four named 50-case batches). (AC-QR-001-3, 001-4)
- [x] 3.2 `src/constants.ts` and `src/errors.ts` (`QrTransferError` with the codes in design 5). `tests/frame.test.ts` (U-QR-02) then `src/frame.ts`: `encodeFrame`, `decodeFrame`,
  internal `decodeFrameWith(text, allocate)`; the check order of design 5; the rejection matrix with an allocation spy (0 calls on every rejection, exactly 1 call
  with the exact length on success); the interior-space frame `GSQ1: 0` and the appended-space cases (odd byte count `OutOfRange`, even byte count `InvalidLength`, `GSQ1: 0 ` `OutOfRange`; design 3.3); a 1855-character text `TooLarge` with 0 allocations (G3); no normalization. `tests/frame.property.test.ts` (P-QR-02, four batches). (AC-QR-001-1, 001-2, 001-5, 002-1, 002-2, 002-3)
- [x] 3.3 `tests/symbol.test.ts` (U-QR-03) then `src/symbol.ts`: `buildQrSymbol` and the internal `buildQrSymbolWith(text, encode)`. Expected versions 12, 18, 24 (23 is skipped, see design 17.1), 25, 25 for 328, 658, 988, 1231, 1232 bytes;
  options recorded (`ecc "L"`, `minVersion 1`, `maxVersion 25`, `boostEcc false`); a 1854-character text throws `TooLarge`. If `uqr` does not pick alphanumeric mode or
  throws a different error, fix the wrapper (never raise the version cap) and record the finding in design 17. (AC-QR-003-1, 003-2, 003-3)
- [x] 3.4 `src/browser/jsqr-engine.ts` (the `FrameDecoder` for `jsqr`, `inversionAttempts: "dontInvert"`) and a test-side rasterizer helper. `tests/raster-roundtrip.test.ts` (U-QR-04) with sizes 11, 328, 658, 988, 1231,
  1232 and the interior-space frame `GSQ1: 0` (byte 0x24); the synthetic `GSQ1: 0 ` returned verbatim by the engine and rejected `OutOfRange` by `decodeFrame`; for the 1232-byte raster assert from the jsqr result `version === 25`, `chunks.length === 1`, `chunks[0].type === "alphanumeric"`, `chunks[0].text` equal to the frame (via an internal `decodeDetailed` in `jsqr-engine.ts`; if `chunks[].type` is not exposed at 1.4.0, record a finding in design 17, G1); `tests/raster.property.test.ts` (P-QR-03, four batches, generator biased to bytes that produce the space character, no end-in-space generator). Measure one batch's wall time. If a batch is near the 5 s default, restrict the P-QR-03 generator to 11..658 bytes (design R-1), document it, and
  do NOT raise the timeout. (AC-QR-003-4)
- [x] 3.5 `tests/package-boundary.test.ts` (U-QR-06): static scan of `src` for `@ghostsync/`, `yjs`, `node:`, `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `indexedDB`, `localStorage`; `package.json` dependency pins;
  `THIRD_PARTY_NOTICES.md` contents. (AC-QR-009-2, 012-3, 014-1, 014-3, 014-5)
- [x] 3.6 Run `pnpm.cmd -F @ghostsync/qr-transfer typecheck` and `test`. Record exit codes, file and test totals, and each property batch line (`numRuns=50 numSkips=0`).

## 4. Browser entry (REQ-QR-005, 006)
- [x] 4.1 `tests/scan-session.test.ts` (U-QR-05) then `src/browser/scan-session.ts` and `src/browser/engine.ts` with the injected deps of design 6.3: constraints, state machine (7.1), error-name mapping, the 100 ms loop with one decode in
  flight, hint rate limit, single accepted result, stop on cancel, accept, `pagehide`, hidden, 120 s timeout (fake timers), error after acquisition; the deferred `getUserMedia`, deferred `loadEngine` and deferred `video.play()` races, each in a resolve and a reject variant (each start holds its own stream: a per-start local plus a per-session record, no shared mutable `currentStream`; `generation` checked FIRST after every await and in every catch, a stale rejection emits nothing and sets no `failed`; a stale start stops only its own stream; no `scanning` emitted); restart regressions (a) Cancel then immediate re-Scan with the OLD `getUserMedia` resolving after the new stream is active (old tracks `stop` exactly once; new tracks 0 `stop` calls and `readyState` live; `srcObject` still the new stream; new loop still delivers one accepted result; final `stop()` closes new tracks once), (b) stale `loadEngine` rejection after restart (no `failed`, new session unaffected, old tracks stopped), (c) stale `play()` rejection after restart; negative control: temporarily use a shared `currentStream` field and confirm (a) FAILS, then restore; a track `ended` event gives `failed`; idempotent `stop()`;
  a second `start()` ignored; engine load failure ends in `failed` with tracks stopped. (AC-QR-005-2 to 005-6, 007-4)
- [x] 4.2 `src/browser/paint.ts`: `chooseScale` (largest integer 4..8, else `undefined`) and `paintQr` (black on white, 4-module quiet zone, integer scale, canvas size = modules x scale). Unit tests for `chooseScale`
  boundaries in `scan-session.test.ts` or a sibling file; pixel checks run in E2E-QR-01. (AC-QR-004-3)
- [x] 4.3 `src/browser.ts` and `src/index.ts` public exports as design 6.2 and 6.3. Make the decoder a lazy `import()` inside `src/browser/engine.ts`. Run `pnpm.cmd -F @ghostsync/qr-transfer build`; confirm `dist/index.js`, `dist/browser.js`
  and a separate emitted file for the engine are present. (AC-QR-006-1)

## 5. PatchBoard integration (REQ-QR-004 to 011, 013)
- [x] 5.1 Add `"@ghostsync/qr-transfer": "workspace:*"` to `apps/patchboard/package.json`; `pnpm.cmd install`, inspect the lockfile diff (adds only the importer edge), `pnpm.cmd install --frozen-lockfile`. (AC-QR-014-6)
- [x] 5.2 Behavior-preserving refactor first: split `importFile` into `importFile` (size check, read) and `importBytes(bytes, "file" | "qr", opts)` in `src/session/session-controller.ts` (design 8.1). The file path passes no `opts`. Run the
  EXISTING PatchBoard suite (`typecheck`, `test`, then `test:e2e` once the build is current) BEFORE adding any QR code and confirm U-PB-19 and E2E-PB-20 still pass unchanged. (AC-QR-009-1)
- [x] 5.3 Add `sessionGeneration`, `onSessionEnd`, `hasAppliedQr`, the applied-set and the `source` field on `ImportView` / `data-import-source` (design 8.2). `QR_MAX_CAPSULE_BYTES` is passed as `maxCapsuleBytes` for `source === "qr"`. (AC-QR-002-4, 008-4, 008-6)
- [x] 5.4 `src/transfer/qr/qr-controller.ts` (`showQr`, `hideQr`, `startScan`, `cancelScan`, `importScanned`, `discardScan`, `reset`), following design 8.3 step by step; `src/transfer/qr/transfer-mode.ts`; `src/transfer/qr/qr-errors.ts` with the copy of
  design 9.3. Tests first: `tests/qr-import-flow.test.ts` (U-QR-10, using `controller-seams.ts`; cases: pipeline use and `applyUpdate` carrier, outcomes equal to file import for 6 byte arrays, double activation, rescan, reentry, scan button disabled and `startScan` a no-op while importing, applied-set re-check in `importScanned` (design 8.3 step 2), held capsule kept when `importPending`, "import did not run" message, session binding, applied-unsaved,
  1233 bytes rejected and 1232 bytes accepted through the QR import path), `tests/transfer-mode.test.ts` (U-QR-11), `tests/qr-errors.test.ts` (U-QR-12), `tests/qr-boundary.test.ts` (U-QR-13), `tests/qr-mutation.property.test.ts` (P-QR-04, four batches).
  (AC-QR-004-1, 007-2 to 007-5, 008-1 to 008-8, 009-1, 009-2, 011-1, 013-3, 014-2)
- [x] 5.5 `src/transfer/qr/qr-view.ts` and the `app-view.ts` wiring: the "Transfer" section with the file block unchanged and the QR block (design 9); `transfer-mode` stays "Transfer: file (.gscap)" by default and gains `data-transfer-mode`; `qr-scan-message` live region;
  focus moves (9.4); Escape cancels (SHOULD); the `<video>` element with an accessible name; `QR_ENABLED` constant in `src/config.ts` (true for the build under test). Styles in `src/styles.css` reuse the existing focus ring; no horizontal overflow at 320 px;
  at 1000 px or wider the QR block is at least 760 px wide (design 9.4). (AC-QR-004-2 to 004-5, 010-1, 010-3, 011-1 to 011-3, 013-1, 013-2, 013-4)
- [x] 5.6 Subscribe the QR controller to `session.onSessionEnd` and to `pagehide` through the package's scan session. Do not request the camera or load the decoder anywhere at startup. (AC-QR-005-1, 006-4)
- [x] 5.7 Run `pnpm.cmd -F @ghostsync/qr-transfer build` then `pnpm.cmd -F @ghostsync/patchboard typecheck` and `test`. Record totals; the pre-existing tests must be unchanged and passing.

## 6. Browser tests (EV-FIXTURE; REQ-QR-005 to 013, 015)
- [x] 6.1 `apps/patchboard/e2e/camera.ts`: `installFakeCamera(context)`, `setCameraFrame`, `setCameraMode`, `cameraCalls`, `trackStates`, exactly as design 13.3 (canvas `captureStream`; modes by DOMException name; `mediaDevices` removal; a
  `securitypolicyviolation` counter). Add the Node-side rasterizer that turns a `buildQrSymbol` matrix into a frame source. Fixture capsules and frames from design 13.5 go in `e2e/qr-fixtures.ts`. (AC-QR-015-1, 015-2)
- [x] 6.2 `e2e/qr-transfer.spec.ts`: E2E-QR-01 (two offline profiles, real canvas to the other profile's stub, preview, explicit import, offline reload), E2E-QR-04, E2E-QR-05 (two clicks in one task; rescan `already-imported`; held `SubtleCrypto.digest`
  with Change board and Update now disabled), E2E-QR-06 (rejection matrix, P1 unchanged each time), E2E-QR-10, E2E-QR-12 (flush and assert setup writes, then arm the one-shot abort). Each QR action via `press`. (AC-QR-004-1, 004-3, 004-4, 007-1 to 007-3,
  007-5, 008-1, 008-3 to 008-8, 011-2, 011-3, 013-1)
- [x] 6.3 (E2E-QR-13, a SHOULD that needs a committed MJPEG fixture, was not added) `e2e/qr-camera.spec.ts`: E2E-QR-02 (failure matrix; file import still works), E2E-QR-03 (cleanup triggers, focus targets, transfer-mode returns to `file`), E2E-QR-07 (offline startup and assets; request recorder; 0 CSP violations; 0 `getUserMedia` calls before activation),
  E2E-QR-11 (SHOULD: decoder chunk blocked), E2E-QR-13 (SHOULD: fake-device flags project, only if a committed MJPEG fixture is added). (AC-QR-005-1, 005-3, 005-4, 006-3, 006-4, 010-1 to 010-3, 012-3, 012-4, 013-4)
- [x] 6.4 `e2e/qr-layout.spec.ts`: E2E-QR-08 (320 x 640 and 1280 x 800, no overflow in each state, `too-narrow` at 320, trust-note text, `data-qr-scale` read) and E2E-QR-09 (too-large capsule keeps file export working). Capture desktop and 320 px screenshots with
  `testInfo.outputPath` after the assertions (gitignored `test-results`). (AC-QR-004-2, 004-3, 012-2, 013-2)

## 7. Build and dist checks (EV-DIST; REQ-QR-006, 012, 015)
- [x] 7.1 Build in order: `pnpm.cmd -F @ghostsync/kit build`, `capsule`, `persist`, `qr-transfer`, then `pnpm.cmd -F @ghostsync/patchboard build`. Confirm a lazy decoder chunk exists in `dist/assets/` and is listed in `dist/precache-manifest.json`. (AC-QR-006-2)
- [x] 7.2 Extend `apps/patchboard/tests/dist-scan.test.ts` (D-QR-01): banned names of design 13.6, no `*.wasm`, no `new Worker`, no `jsdelivr`/`unpkg`/`https://` in `assets/*.js`, the CSP meta string unchanged and without `unsafe-eval` or `wasm-unsafe-eval`, every
  `dist/assets/*` file in the manifest, a non-index chunk carrying the decoder marker. (AC-QR-006-1, 006-2, 012-4, 012-5, 015-1)
- [x] 7.3 Ship the Apache-2.0 notice with the build: add the `jsqr` and `uqr` notice text as `apps/patchboard/public/THIRD_PARTY_NOTICES.txt` (Vite copies `public/` to `dist/`). Verify the file appears in `dist/` and that the existing dist tests still pass. (AC-QR-014-5)

## 8. Verification runs (record actual results)
Run from `C:\Users\ahmad\ghostsync` with `pnpm.cmd`. Record each command, exit code and totals in `docs/progress.md`; report each evidence label separately.
- [x] 8.1 Scope: `git status --short -- packages/kit packages/capsule packages/persist apps/fieldledger` prints nothing; `git diff --stat -- pnpm-lock.yaml` and a read of the diff show only the importers and packages of AC-QR-014-6. (AC-QR-014-4, 014-6)
- [x] 8.2 Typecheck: `-F @ghostsync/qr-transfer typecheck`, `-F @ghostsync/patchboard typecheck`.
- [x] 8.3 Unit and property (EV-UNIT): `-F @ghostsync/qr-transfer test`, `-F @ghostsync/patchboard test`. Every property batch prints `result=PASS numRuns=50 numSkips=0`; four batches per property (P-QR-01 to 04).
- [x] 8.4 Build: `-F @ghostsync/qr-transfer build`, `-F @ghostsync/patchboard build`.
- [x] 8.5 Dist (EV-DIST): `-F @ghostsync/patchboard test:dist`.
- [x] 8.6 Chromium (EV-FIXTURE): `-F @ghostsync/patchboard test:e2e` (the whole suite, including the existing 20, and the new E2E-QR tests). Targeted first: `pnpm.cmd -F @ghostsync/patchboard exec playwright test e2e/qr-transfer.spec.ts`.
- [x] 8.7 Shared regressions: `-F @ghostsync/kit test`, `-F @ghostsync/capsule test`, `-F @ghostsync/persist test`, `-F @ghostsync/fieldledger typecheck`, `-F @ghostsync/fieldledger test`. Totals equal the task 1.2 baseline.
- [x] 8.8 Negative control for at-most-once: temporarily remove the synchronous consume in `importScanned` (design 8.3 step 3) and the applied-set check, confirm U-QR-10 and E2E-QR-05 FAIL, restore, rerun. Record both results. Same for the session-end reset (U-QR-10, E2E-QR-10).
- [x] 8.9 `git diff --check` exits 0 (CRLF warnings are acceptable, whitespace errors are not).
- [x] 8.10 Optional fresh-snapshot run, as PatchBoard task 8.3 (copy the working tree to `%TEMP%`, no `node_modules` or `dist`, same sequence from `pnpm.cmd install --frozen-lockfile`).

## 9. MANUAL physical screen-to-phone test (EV-PHYS; a person runs this; no automated test may write its result)
Do not start until 8.2 to 8.7 pass. Protocol: design section 14. Not part of any automated check. PHYS-QR-01.
- [x] 9.1 (user-reported 2026-11-16; brightness, sender browser and lighting not recorded) Prepare: record the iPhone model, the iOS version, the Safari version (same as iOS), the sender machine and browser, screen brightness, and the app build hash (`dist/precache-manifest.json` `cacheVersion`). Give the iPhone an HTTPS URL for the built app whose certificate the iPhone trusts (design 14.1; `localhost` and `adb reverse` do not apply). Both devices: online load, "Ready to work offline", open `sprint-board`; on the iPhone use a Safari tab, not a home-screen app.
- [x] 9.2 (user-reported 2026-11-16: PatchBoard loaded and restored `sprint-board` offline, Airplane Mode on, Wi-Fi off; the `Network: offline` indicator was not separately reported) Disable networking on the iPhone: Airplane Mode on in Control Center, then confirm Wi-Fi is also off (Settings > Wi-Fi); sender offline. Confirm `Network: offline` on both screens and reload the iPhone page in the same Safari tab (it must load from the service worker cache).
- [x] 9.3 (user-reported 2026-11-16: S 10/10, L 10/10, each within 15 s, scale >= 5; per-attempt values and a per-class explicit import not separately reported) Run the 20 attempts of design 14.2 (10 per size class, 15 s limit; the classes are those of the active rung in the 14.2 table) and fill the template below. Every attempt needs `data-qr-scale` >= 5 (otherwise the run is INVALID: widen the window and repeat) and `data-qr-bytes` inside the class range. Import at least one capsule per class with the explicit button and check the board.
- [x] 9.4 (PASS, rung 1232, no fallback applied; user-reported 2026-11-16) Decide: PASS (both classes at least 9 of 10 within 15 s). If not, apply the first applicable rung of design 14.3, update `QR_MAX_CAPSULE_BYTES`, `QR_MAX_FRAME_CHARS`, `QR_MAX_VERSION` and the U-QR-02/03 expectations together,
  rerun 8.2 to 8.7, and repeat 9.3 for BOTH classes of the new rung (never reuse a higher rung's results; build the capsules from the 14.2 table: 829 -> S 300 to 400, L 750 to 829; 502 -> S 328, L 380 to 502 with the largest symbol possibly unreachable, recorded). Record the rung applied. If the last rung fails, set `QR_ENABLED = false`, keep file transfer, and record that QR is unsupported-optional.
- [ ] 9.5 Optional (SHOULD): repeat on a second device or browser (for example an Android phone with Chrome) and record it as informational.

Tester guide with the HTTPS URL steps, the laptop fixture page (class S: 650 bytes, class L: 1232 bytes) and the 10-attempt tables: [docs/qr-physical-test.md](../../../docs/qr-physical-test.md). The tooling is `apps/patchboard/tools/phone-test/` (not shipped). Both are support material; EV-PHYS was NOT RUN until the template below was filled; it is now PASS (user-reported manual run, 2026-11-16). EV-PHYS means the user's manual run; fixture and Chromium passes remain EV-UNIT and EV-FIXTURE.

Results template (copy into `docs/progress.md`; leave a field empty rather than guessing):
```
PHYS-QR-01  status: NOT RUN | PASS | FAIL | PARTIAL        date: ____   tester: ____
Phone: iPhone model ____  iOS version ____  Safari tab (not home-screen app) yes/no     Sender: machine ____  browser ____  brightness ___%  lighting ____
App build: cacheVersion ____    HTTPS URL used: ____    Certificate trusted by the iPhone (yes/no, how)    Networking: Airplane Mode ON, Wi-Fi OFF (yes/no)
Camera permission prompt seen (yes/no)    iPhone page showed "Network: offline" (yes/no)    iPhone reloaded from service worker with networking off (yes/no)
Limits in effect: QR_MAX_CAPSULE_BYTES ____  version cap ____   Scanner engine: jsqr 1.4.0 | other: ____   SCAN_MAX_EDGE_PX ____
Rung and class ranges in effect (design 14.2): limit ____  S range ____  L range ____
Class S: data-qr-bytes ____  data-qr-version ____  data-qr-scale ____  distance ____ cm
  attempts 1..10 (seconds or FAIL): __ __ __ __ __ __ __ __ __ __      successes ___/10     imported + board correct (yes/no)
Class L: data-qr-bytes ____  data-qr-version ____  data-qr-scale ____  distance ____ cm
  attempts 1..10 (seconds or FAIL): __ __ __ __ __ __ __ __ __ __      successes ___/10     imported + board correct (yes/no)
Threshold (>= 9/10 per class, each within 15 s): MET | NOT MET
Failure notes (glare, focus hunting, moire, wrong class, decoder miss): ____
Rung applied (design 14.3): none | 0 tuning | 1 BarcodeDetector engine (not applicable on iPhone Safari) | 2a 829 bytes | 2b 502 bytes | 3 QR hidden (QR_ENABLED=false)
Backgrounding/freeze notes (preview frozen after switching apps: yes/no): ____
Second device (informational): ____
Signed: ____
```

Filled record (user-reported manual test; not automated; not observed by the agent). Fields the tester did not supply say so; nothing below is invented.
```
PHYS-QR-01  status: PASS        date: 2026-11-16   tester: the user
Phone: iPhone 14 Pro Max  iOS version 27.2.1 (as reported by the user)  Browser: Safari tab (not home-screen app): yes (reported as a Safari tab)
Sender: laptop, browser Chrome or Edge fixture page (apps/patchboard/tools/phone-test/fixture-display.html)  brightness: not recorded  lighting: not recorded
App build: cacheVersion 8ac23023603a6859 is the cacheVersion of the current apps/patchboard/dist build; it is not necessarily the build the tester used (not recorded by the tester)
HTTPS URL used: https://<laptop-lan-ip>:4443/ (template; real address not recorded)    Certificate trusted by the iPhone: yes (mkcert root, per docs/qr-physical-test.md; the user reported the page loaded)
Networking: Airplane Mode ON, Wi-Fi OFF: yes    PatchBoard loaded and restored sprint-board offline: yes
Camera permission prompt seen: not reported    iPhone page showed "Network: offline": not separately reported    iPhone reloaded from service worker with networking off: PatchBoard loaded and restored sprint-board offline (as reported)
Limits in effect: QR_MAX_CAPSULE_BYTES 1232  version cap 25   Scanner engine: jsqr 1.4.0   SCAN_MAX_EDGE_PX: not recorded by the tester
Rung and class ranges in effect (design 14.2): limit 1232  S range 600 to 700  L range 1150 to 1232
Class S: data-qr-bytes 650  data-qr-version 18  data-qr-scale >= 5 on every attempt  distance: not recorded
  attempts 1..10 (seconds or FAIL): not recorded (user reported all within 15 s and scale >= 5) x10      successes 10/10     imported + board correct: not separately reported
Class L: data-qr-bytes 1232  data-qr-version 25 (Version 25-L, 1853 frame characters)  data-qr-scale >= 5 on every attempt  distance: not recorded
  attempts 1..10 (seconds or FAIL): not recorded (user reported all within 15 s and scale >= 5) x10      successes 10/10     imported + board correct: not separately reported
Threshold (>= 9/10 per class, each within 15 s): MET
Failure notes: none reported
Rung applied (design 14.3): none (rung 1232, no fallback applied)
Backgrounding/freeze notes: not reported
Second device (informational): none (9.5 not done)
Signed: the user (reported; recorded by the agent from the user's message)
```
What this result does not show: one device and one browser only; no second device; hand-held distances and brightness not recorded beyond what was reported; per-attempt seconds and scales not recorded (not recorded: user reported all within 15 s and scale >= 5). It means "reads in these conditions", not a guarantee. Animated QR stays optional and not started.
## 10. Progress reporting
- [x] 10.1 Append the implementation entry to `docs/progress.md` with four separate evidence lines (EV-UNIT, EV-FIXTURE, EV-DIST, EV-PHYS) and a table of commands, exit codes and totals. EV-PHYS read `NOT RUN` until 9.3 was filled; it is PASS (user-reported) since 2026-11-16. Update this file's checkboxes only for
  work with recorded evidence; change the spec status from PLANNED only for items whose evidence exists. (AC-QR-016-2)
- [ ] 10.2 List every UNVERIFIED item of design section 17 and its resolution (confirmed, changed or still open).
- [ ] 10.3 Record limitations L-1 to L-11 as still applicable, and any new one found.

## 11. Task to requirement and test traceability
| Requirement | Tasks | Node tests | Dist | Chromium fixture | Physical |
| --- | --- | --- | --- | --- | --- |
| REQ-QR-001 frame and limits | 3.1, 3.2 | U-QR-01, 02; P-QR-01, 02 | none | none | none |
| REQ-QR-002 validate before allocating | 3.2, 5.3, 5.4 | U-QR-02, 10 | none | none | none |
| REQ-QR-003 symbol | 3.3, 3.4, 4.2 | U-QR-03, 04; P-QR-03 | none | E2E-QR-01, 08 | none |
| REQ-QR-004 show QR | 4.2, 5.4, 5.5, 6.2, 6.4 | U-QR-10 | none | E2E-QR-01, 03, 08, 09, 10 | none |
| REQ-QR-005 camera session | 4.1, 5.6, 6.3 | U-QR-05 | none | E2E-QR-02, 03, 07 | none |
| REQ-QR-006 scanner and assets | 3.4, 4.3, 7.1, 7.2, 7.3 | none | D-QR-01 | E2E-QR-07, 11 | none |
| REQ-QR-007 scan results | 4.1, 5.4, 6.2 | U-QR-05 | none | E2E-QR-04, 06 | none |
| REQ-QR-008 explicit import, at most once | 5.2, 5.3, 5.4, 6.2, 8.8 | U-QR-10 | none | E2E-QR-04, 05, 06, 10, 12 | none |
| REQ-QR-009 same pipeline | 5.2, 5.4 | U-QR-06, 10, 13 | none | none | none |
| REQ-QR-010 file stays available | 5.5, 6.3, 6.4 | none | none | E2E-QR-02, 09 | none |
| REQ-QR-011 transfer mode | 5.4, 5.5 | U-QR-11 | none | E2E-QR-01, 02, 03 | none |
| REQ-QR-012 security | 3.5, 5.4, 7.2 | U-QR-02, 06; P-QR-04 | D-QR-01 | E2E-QR-04, 06, 07, 08 | none |
| REQ-QR-013 accessibility | 5.4, 5.5, 6.2 to 6.4 | U-QR-12 | none | E2E-QR-01 to 05, 08, 12 | none |
| REQ-QR-014 packaging | 2.1 to 2.3, 3.5, 5.1, 7.3, 8.1 | U-QR-06, 13 | none | none | none |
| REQ-QR-015 test-only injection | 6.1, 7.2 | none | D-QR-01 | E2E-QR-01 | none |
| REQ-QR-016 physical acceptance | 9.1 to 9.5, 10.1 | none | none | none | PHYS-QR-01 |
| REQ-QR-017 animated (OPTIONAL) | 12.1 to 12.7 | planned U-QRA-nn | none | planned E2E-QRA-01 | planned PHYS-QRA-01 |
| REQ-QR-018 second app (SHOULD) | 13.1 | none | none | none | none |
The AC-level table (every MUST, test and exact observation) is `requirements.md` section 9.

## 12. OPTIONAL animated tier (do NOT start until gate G1: AC-QR-016-1 passes; none of this is in the MVP)
- [ ] 12.1 Re-read design section 12 and confirm G1 in `docs/progress.md` (EV-PHYS PASS recorded).
- [ ] 12.2 Tests first: header codec and bounds-before-allocation (U-QRA-01), duplicates and conflict (U-QRA-02), out-of-order property with four batches (U-QRA-03), foreign transfer rejection (U-QRA-04), expiry with fake timers (U-QRA-05),
  cancel and session end (U-QRA-06), completed bytes equal the static-path bytes (U-QRA-07).
- [ ] 12.3 `GSA1:` frame codec and bounded reassembler in `packages/qr-transfer` (no merge, no capsule parsing).
- [ ] 12.4 Sender loop at most 3 frames per second with Pause and Next frame, paused under `prefers-reduced-motion`.
- [ ] 12.5 App wiring into the same preview, explicit import and at-most-once path; `transfer-mode` text for the animated mode.
- [ ] 12.6 E2E-QRA-01 (fixture two-profile) with the same camera stub.
- [ ] 12.7 PHYS-QRA-01 manual test with its own threshold and results template, reported under its own label.

## 13. Later, not in this milestone (second app)
- [ ] 13.1 FieldLedger adoption per design section 15: backport the import-pending and session-generation guard with its own tests, add the package dependency, port `src/transfer/qr/`, add its Chromium tests.
