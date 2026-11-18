# QR Transfer MVP: Design
Status: IMPLEMENTED for the static MVP (see `docs/progress.md` for the run results and `.review/implementation-notes.md` for the
corrections made while implementing). Baseline `fd9b9da`, branch `feat/qr-transfer`. Code-shaped blocks below are specification
sketches; the code is authoritative where they differ. EV-PHYS: PASS (user-reported manual run, 2026-11-16; see 14.5). It was NOT RUN before that date.
Companion: `requirements.md` (REQ-QR / AC-QR IDs, AC-level test table in its section 9), `tasks.md`.

## 1. Architecture overview
```
                        apps/patchboard (first integration)
  +-------------------------------------------------------------------+
  | src/transfer/qr/  qr-controller.ts  qr-view.ts  qr-errors.ts      |
  |                   transfer-mode.ts                                |
  | src/session/session-controller.ts  importFile -> importBytes      |
  +-------------+-----------------------------+-----------------------+
                | public API only             | public API only
     @ghostsync/qr-transfer          @ghostsync/capsule   @ghostsync/persist
     (frame, symbol, camera)         decodeCapsule        PersistSession
     NO kit, NO capsule, NO storage  encodeCapsule        (flush, applyUpdate)
                                     importCapsuleIntoPersisted
```
- Bytes are opaque to the transport. `@ghostsync/qr-transfer` turns bytes into a frame text and a symbol, and a
  camera into one accepted byte array. It never parses a capsule. The app calls `decodeCapsule` for the preview and
  `importCapsuleIntoPersisted` (through the existing controller) for the import, exactly as the file flow does.
- Merge stays in the Kit, durability in Persist, file validation in Capsule. QR code contains none of them
  (`.kiro/steering/architecture.md`).
- File transfer is untouched: `export-btn`, `import-input`, `importFile` keep their behavior (the existing PatchBoard
  suites are the regression guard).

## 2. Decisions (rationale and alternatives)
| ID | Decision | Alternatives considered | Why |
| --- | --- | --- | --- |
| D-QR-1 | New package `packages/qr-transfer`, name `@ghostsync/qr-transfer`, tsc-built like `@ghostsync/capsule` (`main ./dist/index.js`). Two entry points: `.` (pure, Node-testable: frame, Base45, symbol) and `./browser` (camera session, canvas paint, decoder loader) | Put it in `packages/kit`; put it in `packages/capsule`; keep it inside PatchBoard | Steering says `packages/kit` owns sync logic and apps consume public APIs. Transport is separate from merge, and a second app must reuse it, so it cannot live in an app. Capsule is file-format logic; adding camera code there breaks its "no DOM, no persist" scope (`no-node-imports.test.ts` pattern). A separate package keeps `kit`, `capsule`, `persist` unchanged |
| D-QR-2 | First camera integration in PatchBoard | FieldLedger | PatchBoard already has what the at-most-once rule needs: `importPending`, a session `generation` that discards stale import results, `requestUpdate`, a `transfer-mode` element, `ImportView`, and the E2E-PB-20 pattern for holding an import open (read from `session-controller.ts`; `grep` finds no `importPending`, `generation` or `requestUpdate` in `apps/fieldledger/src/session/session-controller.ts`). FieldLedger would need that guard backported first. PatchBoard boards are small (about 330 bytes per card), so a static code fits real boards |
| D-QR-3 | One static frame: `GSQ1:` + Base45(capsule bytes), QR alphanumeric mode | QR byte mode with raw bytes; byte mode with Base64; numeric mode | RFC 9285 states that QR readers interpret byte-mode data as UTF-8 or ISO 8859-1, so arbitrary binary does not survive a text-returning scanner. Base64 in byte mode wastes capacity (section 4.5: 951 bytes vs 1232). Base45 in alphanumeric mode is 3.2% below the raw byte-mode ceiling (1232 vs 1273) and is plain ASCII end to end |
| D-QR-4 | Exact limit `QR_MAX_CAPSULE_BYTES = 1232` = 1853 frame characters = version 25, level L | Version 30 (1676 bytes); version 40 (3 KB class); level M | Version 25 is 117 x 117 modules, 125 with the quiet zone, so a laptop screen can show it at 5 to 6 px per module. Larger versions shrink modules on the same screen and are the usual failure of screen-to-camera reads. Level L maximizes capacity per version; a screen has no print damage. The limit is one constant, lowered by the physical-test ladder if needed (14.3) |
| D-QR-5 | One scanner engine in the MVP: bundled pure-JS `jsqr` 1.4.0 on the page thread, loaded lazily. BarcodeDetector is deferred, not used | BarcodeDetector first with a JS fallback; `qr-scanner`; `zxing-wasm` | BarcodeDetector support is partial: Chrome on Android, macOS and ChromeOS only; Safari behind a flag; Firefox none (MDN data, section 17). Playwright on Windows or Linux Chromium has none, so it could not be exercised by the fixture tests, and the fixture and the phone would run different decoders. One engine means the fixture and the phone share a decode path. `qr-scanner` (1.4.2, 2022) needs a separate worker file, `zxing-wasm` (3.1.6) needs a `.wasm` asset, `wasm-unsafe-eval` in the CSP and, by default, loads the `.wasm` from a CDN, which breaks offline use. Escalation order if the phone misses the threshold is in 14.3 |
| D-QR-6 | Encoder: `uqr` 0.1.3 (MIT, zero dependencies, port of Nayuki's generator) | `qrcode`, `qrcode-generator`, `zxing-wasm` writer, own encoder | It exposes `ecc`, `minVersion`, `maxVersion`, `boostEcc` and the module matrix (`encode`), so the symbol parameters are set explicitly and the app draws its own canvas (no HTML string injection). Published 2026-04. Own encoder would add risk for no gain |
| D-QR-7 | The decoder lives in a lazy chunk that the existing precache plugin lists automatically. No plugin change | Static import in the main bundle; an explicit precache entry; a separate Worker file | `apps/patchboard/scripts/sw-precache-plugin.ts` enumerates every emitted chunk and asset in `generateBundle` and skips only `sw.js` and `precache-manifest.json`; install is atomic, so a missing chunk blocks readiness instead of failing later offline. A lazy chunk keeps the first load small |
| D-QR-8 | Browser tests replace `navigator.mediaDevices.getUserMedia` with a stub that returns a real `MediaStream` from a canvas (`captureStream`). Chromium fake-device flags are a SHOULD smoke test (E2E-QR-13) | Fake-device flags only; a pure DOM stub of `<video>` | The stub gives per-test frames, failure modes and observable `track.readyState`, uses the single existing Playwright project and default timeouts, needs no binary video file, and still runs the real `<video>` to canvas to decoder path (13.3) |
| D-QR-9 | At-most-once: a per-open-session set of applied capsule `sha256` values plus a synchronous consume of the held result before the first `await`, on top of the existing `importPending` guard | Rely only on CRDT idempotency; a global (persistent) set | CRDT idempotency means a repeat is harmless, but the requirement is "apply at most once", and a user-visible "already imported" is clearer. A persistent set adds storage and a sync concern for no gain (L-7) |
| D-QR-10 | Physical gate: at least 9 of 10 scans in each of two size classes, each within 15 s, real iPhone in Safari (retargeted from Android Chrome; iOS version and iPhone model recorded), networking disabled after setup. Fallback ladder 1232 -> 829 -> 502 bytes -> ship file-only | A single class; 10 of 10; statistics | Practical, cheap to run by hand, and it covers the smallest and the largest code. 9 of 10 is a gate, not a statistical guarantee (14.2) |
| D-QR-11 | Animated QR stays OPTIONAL behind gate G1 (AC-QR-016-1 passes) | Build it now | The user requirement: optional until a real phone reliably scans the static code |
| D-QR-12 | Evidence labels EV-UNIT, EV-FIXTURE, EV-DIST, EV-PHYS, EV-REVIEW, reported on separate lines | One "tests passed" line | A canvas stream cannot show whether a phone can focus on a screen; mixing them would overstate the result |

## 3. Frame format (static, MVP)
### 3.1 Layout
```
frame text = "GSQ1:" + base45(capsuleBytes)
```
- `GSQ1:` is 5 ASCII characters, all in the QR alphanumeric set: `G S Q 1 :`. `GSQ` marks GhostSync QR, `1` is the frame
  version, `:` ends the prefix. A future frame version changes the digit. The animated tier uses `GSA1:` (section 12).
- `capsuleBytes` is the byte array of a `.gscap` file (`GSCAP\0` magic, version byte, metadata length, JSON metadata,
  update; `packages/capsule/src/format.ts`), unchanged. The frame adds no checksum, length or sender field: the capsule has
  its own SHA-256 (integrity only), and the QR symbol has Reed-Solomon error correction.
- Base45 alphabet, value to character: `0-9` = 0..9, `A-Z` = 10..35, space = 36, `$` = 37, `%` = 38, `*` = 39, `+` = 40,
  `-` = 41, `.` = 42, `/` = 43, `:` = 44.
- Two bytes `[a, b]` become `n = 256a + b = c + 45d + 2025e` and the characters `c d e` (least significant first). A final odd
  byte `a` becomes `c d` with `n = a = c + 45d`. A 3-character group with `n > 65535` and a 2-character group with `n > 255` are
  invalid. A single leftover character is invalid. (Derived from RFC 9285; vectors in 3.2.)

### 3.2 Reference vectors (RFC 9285 examples, fetched; the `AB` vector is computed)
| Bytes | Base45 |
| --- | --- |
| `AB` (0x41 0x42): 16706 = 11 + 11*45 + 8*2025 | `BB8` |
| `Hello!!` | `%69 VD92EX0` |
| `base-45` | `UJCLQE7W581` |
| `ietf!` | `QED8WEX0` |
| `[0xFF, 0xFF]` (65535 = 15 + 16*45 + 32*2025) | `FGW` |
| `[0xFF]` (255 = 30 + 5*45) | `U5` |
| invalid: `GGW` (65536), `V5` (256), `A` (one character), `a` (lowercase) | rejected |

### 3.3 Text must be used verbatim
The decoder returns the scanner text unchanged. The space character (value 36) is part of the alphabet, so spaces occur in
the interior of frames, for example `%69 VD92EX0`. A valid frame never ends in a space:
the last character of an even-length payload is the top digit `e = floor(n / 2025)` of a 3-character group with `n <= 65535`,
so `e <= 32` (`W`); the last character of an odd-length payload is `d = floor(a / 45)` with `a <= 255`, so `d <= 5`. A space is 36.
Trimming therefore cannot damage a valid frame, but the engine contract stays "exact text": interior spaces must survive, and
invalid text (a leading or appended space, other case) must be judged by `decodeFrame`, never repaired by the scanner.

Interior-space fixture (derived by hand from RFC 9285, 3.1 above): the single byte 0x24 is decimal 36. A final odd byte `a`
becomes `c d` with `a = c + 45d`: `36 = 36 + 45*0`, so `c = 36` (space) and `d = 0` (`0`). Characters, low digit first: space then
`0`, giving the Base45 text ` 0` and the frame text `GSQ1: 0` (7 characters; the space is interior to the frame, followed by `0`).
Decode check: payload ` 0` has length 2 (2 mod 3 is not 1), both characters are in the alphabet, the 2-character group is
`36 + 0*45 = 36 <= 255`, so the result is `[0x24]`. The U-QR-04 fixture round-trips `[0x24]` through `encodeFrame`, symbol,
rasterization, jsqr decode (exact text `GSQ1: 0` at the scan step) and `decodeFrame` (byte-for-byte equal).

Negative case, appended space: `GSQ1: 0 ` is synthetic and is NOT an `encodeFrame` output. It is checked at the engine/text
level (the fake or jsqr engine returns the string exactly, no trim, no case change; the scan path passes it unchanged to
`decodeFrame`). It is rastered only if that is cheap (a 8-character symbol is trivially small, so it is rastered in U-QR-04 too); if
rastering an invalid frame proves awkward, the text-level check is the requirement. `decodeFrame("GSQ1: 0 ")` throws
`OutOfRange`: the payload ` 0 ` has length 3, all characters are valid, and the 3-character group is
`36 + 0*45 + 36*2025 = 72936 > 65535`.

Worked parity rule for `frame + " "` (design 5 check order: type, length bound, prefix, payload length not 1 mod 3, alphabet, group
range):
- Odd byte count `n`: the payload length is `3*floor(n/2) + 2`, which is 2 mod 3. Adding a space gives 0 mod 3 (passes the length rule). The
  space is valid, so the alphabet check passes. The last group is `x y " "` with `e = 36`, so its value is at least `36*2025 = 72900 > 65535`:
  `OutOfRange`. Example `[0x41]`: `K1`, `GSQ1:K1 ` has group `K1 ` = `20 + 1*45 + 36*2025 = 72965`: `OutOfRange`.
- Even byte count `n` (frame length at most 1852, so `n <= 1230`; at `n = 1232` the longer text is `TooLarge` first): the payload length is
  `3*(n/2)`, 0 mod 3. Adding a space gives 1 mod 3, so the length rule fails first: `InvalidLength`. Example `[0x41,0x42]`: `BB8`, so
  `GSQ1:BB8 ` has payload `BB8 `, 4 characters (1 mod 3): `InvalidLength`, before any alphabet or range check.
- Neither parity returns bytes. The test asserts both codes and the examples above.

## 4. Byte limits and QR overhead (arithmetic shown)
### 4.1 Sources for capacity (see section 17 for verification status)
Version `v` has `4v + 17` modules per side (Wikipedia "QR code", Denso Wave version page: 21 x 21 for version 1, 177 x 177 for
version 40). Capacity at level L, from the Thonky table (a secondary reproduction of the ISO/IEC 18004 table) and confirmed at
version 40 by Wikipedia (40-L: 7,089 numeric, 4,296 alphanumeric, 2,953 byte):

| Version | Modules | L: alphanumeric chars | L: byte-mode bytes |
| --- | --- | --- | --- |
| 12 | 65 | 535 | 367 |
| 15 | 77 | 758 | 520 |
| 16 | 81 | 854 | 586 |
| 18 | 89 | 1046 | 718 |
| 20 | 97 | 1249 | 858 |
| 22 | 105 | 1460 | 1003 |
| 23 | 109 | 1588 | 1091 |
| 24 | 113 | 1704 | 1171 |
| 25 | 117 | 1853 | 1273 |
| 26 | 121 | 1990 | 1367 |
| 30 | 137 | 2520 | 1732 |
| 40 | 177 | 4296 | 2953 |

### 4.2 The limit
1. Level L, alphanumeric segment, version 25: capacity C = 1853 characters.
2. The prefix `GSQ1:` takes 5 characters, so the Base45 body has at most 1853 - 5 = 1848 characters.
3. Base45 maps 2 bytes to 3 characters. 1848 / 3 = 616 groups, 616 x 2 = 1232 bytes. (A body of 1848 characters has length
   0 mod 3, so no half group is left.)
4. `QR_MAX_CAPSULE_BYTES = 1232`, `QR_MAX_FRAME_CHARS = 5 + 1848 = 1853`.
5. Frame length for `n` bytes: `5 + 3*floor(n/2) + 2*(n mod 2)`. For 1232: 5 + 1848 = 1853 (fits exactly). For 1233: 5 + 1848 +
   2 = 1855 > 1853 (does not fit).
6. Self-check on the bit budget (derived, not independently sourced): alphanumeric mode costs 11 bits per pair and 6 bits for a
   final single; mode indicator 4 bits; character-count indicator 11 bits at versions 10 to 26 (ISO value from memory, UNVERIFIED
   against the standard). 1853 characters = 926 pairs + 1 single = 11 x 926 + 6 = 10,192 bits, plus 4 + 11 = 10,207 bits, which is
   at most 1276 x 8 = 10,208 bits (1276 data codewords for 25-L, from memory, UNVERIFIED). 1854 characters = 927 pairs = 10,197 +
   15 = 10,212 bits > 10,208. So 1853 is the last character count that fits, consistent with the cited table. The boundary unit
   test (U-QR-03) is the executable check: 1232 bytes must give version 25 and a 1854-character text must throw.

### 4.3 What fits (measured with the built Kit and Capsule at `fd9b9da`, throwaway script outside the repo, not committed)
Capsule overhead = 11-byte header + metadata JSON. Metadata JSON length = 179 + len(app) + len(documentId) + digits of
`updateByteLength`. For app `patchboard`, document `sprint-board` and a 4-digit length: 179 + 10 + 12 + 4 = 205, so 216 bytes
(215 with a 3-digit length). Worst case with a 64-character board ID: 179 + 10 + 64 + 4 = 257 + 11 = 268 bytes.

| Cards (title ~12 chars, notes 18 chars) | Update bytes | Capsule bytes | Frame chars | Version (L) | Modules | Fits 1232? |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 113 | 328 | 497 | 12 | 65 | yes |
| 1 | 443 | 658 | 992 | 18 | 89 | yes |
| 2 | 773 | 988 | 1487 | 24 (23 by capacity, skipped: `jsqr` 1.4.0 cannot read 23-L, see 17) | 113 | yes |
| 3 | 1103 | 1319 | 1984 | 26 | 121 | no (use file) |
| 5 | 1762 | 1978 | 2972 | 33 | 149 | no |

Per card: about 330 bytes (443 - 113 = 330; 773 - 443 = 330). Frame chars = 5 + 3*floor(n/2) + 2*(n mod 2); versions from the
table in 4.1 (smallest version whose alphanumeric capacity is at least the frame chars; versions 26 and 33 for the "no" rows are
informational and are never generated). So the first deliverable covers about two typical cards. That is the stated first
deliverable ("small capsules"); everything larger uses the file baseline.

### 4.4 Quiet zone and on-screen size
Drawn modules per side = version modules + 2 x 4 quiet zone: version 25 = 117 + 8 = 125. Integer scale `s` in CSS pixels per module,
`4 <= s <= 8`: version 25 at 5 px = 625 px, at 6 px = 750 px; version 18 at 6 px = 582 px. Minimum width for the code = 125 x 4 =
500 CSS px for version 25. Below that the app does not draw (AC-QR-004-3).

### 4.5 Encoding comparison at version 25, level L
| Encoding | Characters or bytes available | Capsule bytes | Safe through a text scanner? |
| --- | --- | --- | --- |
| Raw bytes, byte mode (no prefix) | 1273 | 1273 | No (RFC 9285 section 1: readers interpret byte mode as UTF-8 or ISO 8859-1) |
| Raw bytes with a 5-byte prefix | 1273 - 5 = 1268 | 1268 | No |
| Base64 in byte mode with prefix | (1273 - 5) = 1268 characters = 317 groups of 4 | 317 x 3 = 951 | Yes, but 23% smaller than Base45 |
| Base45 in alphanumeric mode with prefix | 1853 - 5 = 1848 characters = 616 groups of 3 | 616 x 2 = 1232 | Yes, plain ASCII |

1232 / 951 = 1.295 (+29.5% over Base64). 1273 / 1232 = 1.033 (raw byte mode is 41 bytes, 3.3%, larger but unsafe).

## 5. Decode order and error codes (validate before allocating)
`decodeFrame(text: string): Uint8Array` (public) calls the internal `decodeFrameWith(text, allocate)` with
`allocate = (n) => new Uint8Array(n)`. The seam exists so the tests can count allocations. Order, stop at the first failure:
1. `typeof text === "string"`, else `TypeError` (programmer error, not a `QrTransferError`).
2. `text.length <= 1853`, else `QrTransferError("TooLarge")`. Nothing else is read, so a 5 MB string costs one length read.
3. Prefix. `text.startsWith("GSQ1:")`; else if `/^GSQ[0-9]:/` is a different version, `UnsupportedVersion`; else if it starts with
   `GSA1:`, `AnimatedNotSupported`; else `NotGhostSync`.
4. Body = `text.slice(5)`. Empty, or length mod 3 equal to 1, is `InvalidLength`.
5. One pass over the body: every character is in the alphabet, else `InvalidCharacter`; every 3-group value `<= 65535` and the final 2-group
   `<= 255`, else `OutOfRange`. No output is written.
6. `byteLength = 2*floor(len/3) + (len mod 3 === 2 ? 1 : 0)`; assert `1 <= byteLength <= 1232`; call `allocate(byteLength)` ONCE; second pass fills.
`encodeFrame(bytes)`: not a `Uint8Array` is `TypeError`; length 0 is `Empty`; length above 1232 is `TooLarge`; else prefix + Base45.
Both directions never trim, lowercase or otherwise repair text. Error type:
```ts
type QrTransferErrorCode =
  | "TooLarge" | "Empty" | "NotGhostSync" | "UnsupportedVersion" | "AnimatedNotSupported"
  | "InvalidLength" | "InvalidCharacter" | "OutOfRange";
class QrTransferError extends Error { readonly code: QrTransferErrorCode }
```
Messages name the check only and never contain scanned text.

## 6. Package `@ghostsync/qr-transfer`
### 6.1 Files (all new; nothing else outside `apps/patchboard` and the lockfile changes)
```
packages/qr-transfer/
  package.json            name @ghostsync/qr-transfer, private, type module, exports "." and "./browser", scripts typecheck test build
  tsconfig.json           strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, lib ES2022 + DOM
  tsconfig.build.json     rootDir src, outDir dist
  vitest.config.ts  vitest.setup.ts  (numRuns 200 seed 424242, as other packages)
  THIRD_PARTY_NOTICES.md  jsqr 1.4.0 Apache-2.0; uqr 0.1.3 MIT
  README.md               scope, "integrity, not authenticity", API, limits
  src/index.ts            pure public API
  src/base45.ts  src/frame.ts  src/symbol.ts  src/errors.ts  src/constants.ts
  src/browser.ts          browser public API
  src/browser/scan-session.ts  src/browser/engine.ts  src/browser/jsqr-engine.ts  src/browser/paint.ts
  tests/ (section 13.2)
```
Dependencies (exact pins): `uqr` 0.1.3, `jsqr` 1.4.0. Dev: `fast-check` 4.10.2, `typescript` 7.0.2, `vitest` 5.1.0,
`@types/node` 24.19.2 (the versions `@ghostsync/capsule` already uses). No workspace dependency.

### 6.2 Public API v0 (pure entry `@ghostsync/qr-transfer`)
```ts
export const QR_FRAME_VERSION = 1;
export const QR_FRAME_PREFIX = "GSQ1:";
export const QR_MAX_CAPSULE_BYTES = 1232;
export const QR_MAX_FRAME_CHARS = 1853;
export const QR_ECC_LEVEL = "L";
export const QR_MAX_VERSION = 25;
export function encodeFrame(bytes: Uint8Array): string;
export function decodeFrame(text: string): Uint8Array;
export interface QrSymbol { readonly version: number; readonly size: number; readonly modules: Uint8Array } // size*size, 1 = dark
export function buildQrSymbol(frameText: string): QrSymbol;   // level L, alphanumeric, versions 1..25, boostEcc false
export class QrTransferError extends Error { readonly code: QrTransferErrorCode }
```
`buildQrSymbolWith(text, encode)` is internal (a test seam that records the options passed to `uqr.encode`). Everything above is pure
and Node-testable. `modules` is a flat copy of the matrix; `buildQrSymbol` throws `TooLarge` when `uqr` reports the data does not fit
in version 25.

### 6.3 Browser entry `@ghostsync/qr-transfer/browser`
```ts
export function paintQr(canvas: HTMLCanvasElement, symbol: QrSymbol, scale: number): void; // black on white, 4-module quiet zone
export function chooseScale(availableCssPx: number, symbol: QrSymbol): number | undefined;  // largest integer 4..8 that fits, else undefined
export type ScanState = "idle" | "requesting" | "scanning" | "accepted" | "denied" | "no-camera" | "in-use"
  | "insecure" | "unsupported" | "failed" | "timed-out";
export interface ScanDeps {
  readonly mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined;
  readonly isSecureContext: boolean;
  readonly loadEngine: () => Promise<FrameDecoder>;          // default: lazy import of the jsqr engine
  readonly now: () => number;                                // default performance.now
  readonly setTimeout: typeof setTimeout; readonly clearTimeout: typeof clearTimeout;
  readonly pageEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">; // window; pagehide
  readonly visibility: { readonly hidden: () => boolean; readonly target: EventTarget }; // document
}
export type FrameDecoder = (rgba: Uint8ClampedArray, width: number, height: number) => string | undefined;
// Internal, test-side seam (not exported from the package index): jsqr-engine.ts also exports decodeDetailed(rgba, w, h)
// returning { text, version, chunkTypes } from the jsqr result (see 3.3 and 13.2 U-QR-04); FrameDecoder is built on it.
export interface ScanCallbacks {
  onState(state: ScanState): void;
  onHint(code: QrTransferErrorCode): void;           // non-terminal frame rejection, rate limited
  onAccepted(bytes: Uint8Array): void;               // at most once per session
}
export interface ScanSession { start(video: HTMLVideoElement): Promise<void>; stop(): void; readonly state: ScanState }
export function createScanSession(deps: Partial<ScanDeps>, cb: ScanCallbacks): ScanSession;
```
`FrameDecoder` is the engine seam: the MVP implements only the `jsqr` engine. A BarcodeDetector engine, if ever added (14.3 step 2), must
return exact text (3.3) and pass the same engine tests. The package performs no network, storage or capsule call.

## 7. Scan session behavior
### 7.1 States and transitions
```
idle --start()--> requesting --stream ok--> scanning --valid frame--> accepted (camera stopped)
                      |                        |  \--120 s--> timed-out (camera stopped)
                      |                        \--stop()/pagehide/hidden/session change--> idle (camera stopped)
                      +-- NotAllowedError --> denied        +-- NotFoundError --> no-camera
                      +-- NotReadableError/AbortError --> in-use   +-- SecurityError or insecure context --> insecure
                      +-- no mediaDevices --> unsupported (secure) | insecure (not secure)   +-- anything else --> failed
```
`ScanState` has no `rejected`, `importing`, `imported` or `already-imported`: those belong to the app (section 8). Invalid frames
call `onHint` and stay in `scanning`.

### 7.2 Start
1. `start(video)` while `state !== "idle"` returns at once (AC-QR-005-6). Set `requesting`.
2. If `mediaDevices` is undefined: `insecure` when `isSecureContext` is false, else `unsupported`. Stop.
3. `await mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } })`.
   Capture `const gen = generation` before this await. Each start owns its own stream reference: a per-start local `const stream` plus a per-session record
   `sessions.get(gen) = { stream, video }`. There is NO single shared mutable `currentStream` field that a stale continuation can overwrite or clear (R1).
4. As the first statement after the await, store the stream in this start's local and in `sessions[gen]` (so `stop()` can close it from here on). Then, if `generation !== gen`
   (the session was stopped or replaced), stop every track of THIS start's own `stream` only, delete `sessions[gen]` and return. It does not touch the newer session's stream,
   `video.srcObject`, timers, listeners or state, and emits no state (AC-QR-005-5).
5. `try { await loadEngine() } catch`: in the catch, the generation check comes FIRST. If `generation !== gen`, stop this start's own tracks, delete `sessions[gen]`, return, emit nothing and set no `failed` state (R2).
   Only when `generation === gen` does a rejection end in `failed` with the stream stopped. After a resolve the same check applies: if `generation !== gen`, stop own tracks, return, emit nothing.
6. `video.srcObject = stream`, `muted`, `playsInline`, `await video.play()`. In the catch and after a resolve, the generation check comes FIRST: if `generation !== gen`, stop this start's own tracks and
   set `srcObject = null` ONLY while `video.srcObject` is still this start's `stream`; return and emit nothing (a `play()` rejection caused by a stop or restart is not reported as `failed`).
   Otherwise a rejection (generation unchanged) is `failed` and stops the tracks. Set `scanning`. Arm the 120 s
   timer. Register `pagehide` (window) and `visibilitychange` (document, acting when hidden), and an `ended` listener on each video track (7.4).
   Steps 4 to 6 are the only awaits after acquisition; each is followed by the same `generation` re-check, so no stop can leave a live track or a `scanning` state after it.

### 7.3 Frame loop
- One loop, one decode in flight, minimum 100 ms between decodes (`setTimeout`, not a tight loop). Skip while `video.readyState < 2`.
- Draw the current video frame to one off-DOM canvas, long edge scaled to at most 1280 px (`SCAN_MAX_EDGE_PX`), `getImageData`, call the
  engine with `inversionAttempts: dontInvert` (one decode attempt per frame). The canvas and buffer are reused, so memory is bounded
  (at most 1280 x 720 x 4 = 3.69 MB).
- A `string` result goes to `decodeFrame`. On success: `accept(bytes)`. On `QrTransferError`: `onHint(code)` (at most one hint per 1 s per
  code) and keep scanning.
- `accept(bytes)` runs once: set `accepted`, stop (below), call `onAccepted(bytes)`. Any later decode result is dropped.

### 7.4 Stop (idempotent, AC-QR-005-4)
`stop()` bumps `generation`, clears the loop timer and the 120 s timer, removes the `pagehide`, `visibilitychange` and track `ended` listeners, calls
`track.stop()` on every track of the ACTIVE session's recorded stream (`sessions[generation]`, recorded at step 4, so a stop during engine load or `play()` also closes it), deletes that record, sets `video.srcObject = null`, then emits `idle` (or the terminal state that caused it).
Stop touches only the session that was current when it ran. A later stale continuation of an earlier start cleans up its own per-start `stream` only (7.2) and never reads or clears another session's record, so Cancel, immediate re-Scan, then the old `getUserMedia` resolving late stops the old stream once and leaves the new stream, `srcObject`, timers, listeners and loop untouched (R1).
A second call does nothing. A video track `ended` event while `scanning` (device unplugged, permission revoked) calls the same stop path and ends in `failed`
(message: the `failed` copy). Callers: Cancel, accept, pagehide, hidden, session end, timeout, any error after acquisition.

## 8. PatchBoard integration (controller)
### 8.1 Behavior-preserving split of `importFile`
Today `importFile(file)` checks `file.size`, reads the file, then runs `importCapsuleIntoPersisted(s, bytes)` with the stale-result guard.
The refactor, done first and run against the existing suites before any QR code exists (task 4.1):
```ts
async importFile(file: File): Promise<void>   // size check + read, then:
private async importBytes(bytes: Uint8Array, source: "file" | "qr", opts?: { sha256?: string }): Promise<void>
```
`importBytes` is the old body from "`const before = this.model`" on, unchanged except: `source` is stored on `ImportView` (`source?: "file" | "qr"`,
rendered as `data-import-source`), and for `source === "qr"` the call is `importCapsuleIntoPersisted(s, bytes, { maxCapsuleBytes: QR_MAX_CAPSULE_BYTES })`
(AC-QR-002-4). The `importing` view, the `stale()` check against `generation` and the session, and the catch mapping stay as they are. The file path
passes no `opts`, so its behavior is byte-identical.

### 8.2 Session additions
```ts
get sessionGeneration(): number                         // read-only view of `generation`
onSessionEnd(listener: () => void): () => void         // called from dropSession(); returns an unsubscribe
hasAppliedQr(sha256: string): boolean                  // per open session
```
`dropSession()` already bumps `generation`; it additionally clears the applied set and calls the listeners. The set is added to inside `importBytes`
only when `source === "qr"`, `r.applied` is true and `stale()` is false (so it records both applied-saved and applied-unsaved).
To close the window while an import is pending, `importScanned` also records the sha256 in a separate `inFlightQr` set synchronously (8.3 step 3) and `hasAppliedQr`
returns true for a value in either set; the `inFlightQr` entry is removed when the import settles, or at once if it was rejected or not applied.

### 8.3 `QrTransferController` (app module `src/transfer/qr/qr-controller.ts`)
Holds the scan session, the held result and the panel state, and exposes `showQr()`, `hideQr()`, `startScan(video)`, `cancelScan()`, `importScanned()`,
`discardScan()`. Dependencies are injected (`ScanSessionFactory`, the `SessionController`, `decodeCapsule`), as `SessionController` takes `deps.openReplica`.
- `showQr()`: `buildCapsule("export")`; `bytes.length > QR_MAX_CAPSULE_BYTES` gives `too-large` with the size; else `encodeFrame` -> `buildQrSymbol` -> `chooseScale(width)`;
  `undefined` gives `too-narrow`; else `ready` (the view paints). `decodeCapsule(bytes)` supplies the checksum prefix for display.
- `startScan`: registers `session.onSessionEnd(() => this.reset())`, creates the scan session, `start(video)`.
- `onAccepted(bytes)`: `decodeCapsule(bytes)` (no apply). Failure: `rejected` with `mapCapsuleError(code, ...)`, bytes dropped. Success: if
  `session.hasAppliedQr(metadata.sha256)` then `already-imported`; else hold `{ bytes, metadata }` and set `scanned`. The captured `sessionGeneration` is compared after the
  await; a changed generation drops the result.
- `importScanned()` (the at-most-once core, all steps before the first `await`):
  1. `const held = this.held; if (held === undefined || this.state !== "scanned") return;`
  2. `if (session.hasAppliedQr(held.metadata.sha256)) { this.held = undefined; this.state = "already-imported"; return; }` (re-check at import time, M1)
  3. `if (session.importPending) { return; }` and nothing is consumed, so the held capsule stays `scanned` and the import button stays available; the user sees the existing
     pending-import state and message of the file flow. Otherwise: `this.held = undefined; this.state = "importing";` and the sha256 is added to `inFlightQr` (consume synchronously).
  4. `await session.importBytes(held.bytes, "qr", { sha256: held.metadata.sha256 });`
  5. state becomes `imported` (applied) or `idle`/`rejected` view per the `ImportView`. If `importBytes` returned without importing (no open session, or the session ended), the
     controller sets `idle` with the message "The import did not run. Scan the code again." (copy added to 9.3 and U-QR-12) so a held capsule is never lost silently (L4). `inFlightQr` is cleared.
  A second activation in the same task finds `held === undefined` at step 1; one after the first `await` finds state `importing` or `imported` (step 1) or `importPending`.
- Scan during an import (M1): while the controller state is `importing`, `qr-scan-btn` is disabled (`aria-disabled`/`disabled`, the same rule as Change board during a pending import), and
  `startScan` returns at once if `state === "importing"` or `session.importPending`. If a scan was already running when the import began it is stopped at step 3. A code of the same
  checksum scanned after the import settles finds the sha256 in the applied set and shows `already-imported`; one scanned at any moment finds it in `inFlightQr`. The `onAccepted`
  `hasAppliedQr` check and the step 2 re-check both read both sets, so no ordering can apply the same capsule twice.
- Cross-direction guard (decision R3, implemented): `importBytes` and `importFile` both go through one `beginImport`, which refuses when `importView.state === "importing"` whatever the source, so a QR import
  blocks a file import and a file import blocks a QR import in the controller. `scanDisabled` is true while the session reports `importPending` (file or QR), `startScan` returns at once then, and the
  session's `onImportStart` listener stops a scan that is already running when a FILE import begins. The view disables `qr-scan-btn` and the file input from the same getters.
- Scope of the duplicate check (decision R4): `appliedQr` and `inFlightQr` are written only by `importBytes` with `source === "qr"`. A capsule applied by FILE is not recorded, so a later QR scan of it reaches
  `scanned` and may be imported again; the merge is idempotent (diff empty). The QR panel states this (`DUPLICATE_SCOPE_NOTE`, U-QR-12), and U-QR-10 asserts it.
- `reset()` (session end, hide, cancel, discard): stops the scan session, drops `held`, sets `idle`.

### 8.4 What the user sees after the import
The import outcome renders in the existing `import-result` region (`applied-saved`, `applied-unsaved` with Retry save and backup, `rejected`), with the same merge
summary. The QR panel shows `imported` and a "Scan again" button. There is no QR-specific result UI to keep in sync.

## 9. UI contract
### 9.1 Layout
The existing "Transfer (file)" section becomes "Transfer" with two blocks. The file block keeps its DOM and IDs (`export-btn`, `import-file`, `import-input`, `import-result`,
`merge-summary`) unchanged. The QR block follows it, in this tab order: Show QR code, Hide QR code (when shown), Scan QR code (camera), Cancel scan, Import scanned capsule,
Discard scan, Scan again.

### 9.2 Selectors and data attributes (the only ones tests rely on)
| Element | `data-testid` | Notes |
| --- | --- | --- |
| Transfer mode | `transfer-mode` | existing; text per AC-QR-011-1; adds `data-transfer-mode` = `file`, `qr-scan`, `qr-show` |
| Show button | `qr-show-btn` | label "Show QR code" |
| Hide button | `qr-hide-btn` | label "Hide QR code" |
| Show panel | `qr-show-panel` | `data-qr-state` = `idle`, `ready`, `too-large`, `too-narrow`, `error` |
| Canvas | `qr-canvas` | only in `ready`; `data-qr-version`, `data-qr-modules`, `data-qr-scale`, `data-qr-bytes`; has an `aria-label` "QR code carrying the capsule" |
| Show details | `qr-show-bytes`, `qr-show-version`, `qr-show-checksum`, `qr-show-message` | checksum = first 12 hex characters of metadata `sha256` |
| Scan button | `qr-scan-btn` | label "Scan QR code (camera)"; never disabled for camera reasons; disabled only while an import is pending (`importing`) |
| Scan panel | `qr-scan-panel` | `data-qr-state` = `idle`, `requesting`, `scanning`, `scanned`, `rejected`, `importing`, `imported`, `already-imported`, `denied`, `no-camera`, `in-use`, `insecure`, `unsupported`, `failed`, `timed-out` |
| Video | `qr-video` | `<video muted playsinline>`, `aria-label` "Camera preview"; shown only while `requesting`/`scanning` |
| Message / hint | `qr-scan-message` (`role="status"`, `aria-live="polite"`), `qr-scan-hint` | |
| Preview | `qr-preview`, `qr-meta-app`, `qr-meta-document-id`, `qr-meta-created-at`, `qr-preview-bytes`, `qr-meta-checksum` | values capped by `capMetaValue` (80 characters), set with `textContent` only |
| Actions | `qr-scan-cancel`, `qr-import-btn`, `qr-discard-btn`, `qr-rescan-btn` | |

### 9.3 Copy (exact strings; every one is covered by U-QR-12)
| State or hint | Text |
| --- | --- |
| requesting | "Waiting for camera permission. Choose Allow in the browser prompt." |
| scanning | "Point the camera at the QR code. Keep it steady and let it fill most of the preview." |
| scanned | "QR code read. Nothing has been applied yet. Check the details below, then import." |
| rejected | the existing `mapCapsuleError(code)` text (the same words as a file import, AC-QR-009-1) |
| already-imported | "This QR code was already imported in this session. Nothing was changed." |
| denied | "Camera access was blocked. Allow the camera for this site in the browser settings and try again, or use Import capsule file (.gscap) instead." |
| no-camera | "No usable camera was found on this device. Use Import capsule file (.gscap) instead." |
| in-use | "The camera could not be started. Close other apps that use the camera and try again, or use Import capsule file (.gscap) instead." |
| insecure | "The camera needs a secure page (HTTPS or localhost). Open the app from its secure address, or use Import capsule file (.gscap) instead." |
| unsupported | "This browser cannot use the camera for scanning. Use Import capsule file (.gscap) instead." |
| failed | "Scanning could not start or the camera stopped. Try again, or use Import capsule file (.gscap) instead." |
| import did not run | "The import did not run. Scan the code again." |
| timed-out | "Scanning stopped after 2 minutes to turn the camera off. Select Scan QR code (camera) to try again, or use Import capsule file (.gscap)." |
| hint NotGhostSync | "That is not a GhostSync QR code. Keep scanning or cancel." |
| hint UnsupportedVersion | "This QR code uses a newer GhostSync format. Update PatchBoard, or use file transfer." |
| hint AnimatedNotSupported | "This is a multi-frame code, which this version cannot read. Use file transfer." |
| hint TooLarge | "This QR code is larger than the 1232-byte limit. Use file transfer." |
| hint InvalidLength / InvalidCharacter / OutOfRange | "This code looks damaged or incomplete. Hold steady and keep scanning." |
| show too-large | "This capsule is N bytes. A QR code holds at most 1232 bytes. Use Export capsule (.gscap) instead." |
| show too-narrow | "This screen is too narrow to show a code a phone can read. Use a wider screen, or use Export capsule (.gscap)." |
| Trust note (both panels) | "A capsule checksum detects corruption. It does not authenticate the sender: anyone who can show a code can show a valid capsule." |
| Show tip (SHOULD) | "Raise the screen brightness and keep the code large and still." |

### 9.4 Focus, announcements, layout
- After accept: focus `qr-import-btn`. After Cancel or Discard: focus `qr-scan-btn`. After Hide: focus `qr-show-btn`. After a camera error: focus stays on `qr-scan-btn`.
- `qr-scan-message` is the one live region for scan state text (polite). Existing announcers are untouched.
- The panel is a single column. The video has `max-width: 100%` and a fixed aspect ratio; the canvas is drawn at an integer scale and never scaled by CSS. No horizontal overflow
  at 320 px (the show panel gives way to the too-narrow message, so the canvas is never wider than the viewport).
- Focus ring: the existing `:focus-visible { outline: 3px solid #1a56db }` applies to the new buttons; no new focus style.
- Escape cancels an active scan (SHOULD, AC-QR-013-5).
- At viewports of 1000 px or wider the QR block gets at least 760 px of width, so a version-25 code draws at scale 6 (750 px). SHOULD: `data-qr-scale` is 5 or more at 1280 x 800 (the physical test needs 5 or more; E2E-QR-08 reads it). If the existing page layout cannot give that width, the layout is adjusted, not the scale rule.
- Colors: the symbol is always `#000` on `#fff` regardless of theme.

## 10. Offline startup, scanner assets and precache
- Startup does not touch the camera or the decoder. `index.html` and `main.ts` import the QR controller, but the controller loads the engine only inside `start()` (`loadEngine`), so
  the decoder is a lazy chunk and the first load does not pay for it.
- Precache decision: no change to the plugin. It adds every emitted chunk and asset to the precache manifest (verified in `apps/patchboard/scripts/sw-precache-plugin.ts`,
  `generateBundle`) and install is atomic (any failed entry fails the install, so offline readiness is never reported without the decoder). D-QR-1 and D-QR-5 mean no WASM, no Worker file, no
  external URL. So the decoder is available offline exactly when the app is offline-ready. D-QR-01 asserts it from `dist`; E2E-QR-07 proves it by scanning offline from a profile that loaded online.
- CSP: unchanged (`default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; img-src 'self' data:`). A camera `MediaStream` assigned to `video.srcObject` is not a CSP-controlled
  fetch; the canvas is not either. This is the expectation, not a verified fact: E2E-QR-07 listens for `securitypolicyviolation` and requires 0 events. If a violation appears, the fix is a
  documented CSP change decided by review, never a silent relaxation.
- Playwright `static-server.mjs` serves `dist` unchanged. The existing `/__test/request-log` records every request, including the service worker's own precache fetches, so the "page-initiated"
  distinction in AC-QR-006-4 uses `page.on("request")` with `request.frame() !== null`.
- The phone needs a secure context for `getUserMedia` and service workers: HTTPS or `localhost` (MDN). The physical test serves the build to the phone through `localhost` (14.1).

## 11. Security
- Untrusted input at three points: scanned text (bounded and validated by `decodeFrame`), decoded bytes (validated by `decodeCapsule` for the preview, again by `importCapsuleIntoPersisted`), and
  capsule contents (Kit). Nothing is applied before the explicit import. Nothing is stored by a scan.
- Checksum, not authentication: the preview and both QR panels say so (AC-QR-012-2). A hostile screen can show a valid capsule for the open board only if the attacker can produce one the Kit accepts for
  this app and document; the same trust model as a file from an unknown sender. Wrong-app and wrong-board capsules are rejected by the identity check.
- DoS: text length is bounded before anything else; the loop allows one decode in flight, 100 ms apart, on a canvas bounded to 1280 x 720; the camera turns off after 120 s; the held result is at most 1232 bytes.
- Privacy: frames stay in memory and in one reused canvas; they are never sent, stored or logged. `@ghostsync/qr-transfer` has no network or storage API (static test U-QR-06).
- No secrets or PII in fixtures: board `sprint-board`, titles like `Draft spec v1`, notes `Outline plus risks`.
- UI output: all untrusted strings are set with `textContent`; the QR canvas is drawn from a boolean matrix.

## 12. Animated multi-frame QR (OPTIONAL; not built; not part of the MVP; gate G1)
Gate G1: PHYS-QR-01 passes for the static code (AC-QR-016-1). Until then none of this is implemented. The static tests above must not depend on it.
### 12.1 Frame format
`GSA1:` + Base45(header || chunk). Header (16 bytes, big-endian):
| Offset | Size | Field | Rule |
| --- | --- | --- | --- |
| 0 | 8 | `transferId` | random per transfer (`crypto.getRandomValues`) |
| 8 | 2 | `index` | `0 <= index < count` |
| 10 | 2 | `count` | `2 <= count <= 64` |
| 12 | 4 | `totalLength` | `(count-1)*512 < totalLength <= count*512` and `totalLength <= 32768` |
Chunk = 512 bytes for every frame except the last, which is `totalLength - 512*(count-1)` bytes (1..512). Frame text length at most 5 + 3 x (528 / 2) = 797 characters, which fits version 16
at level L (854 characters). Limits: `ANIMATED_MAX_FRAMES = 64`, `ANIMATED_MAX_CAPSULE_BYTES = 32768` (64 x 512), `ANIMATED_CHUNK_BYTES = 512`.
### 12.2 Reassembly (all checks before any allocation)
1. Text bound and prefix as in section 5 (limit 797 characters). `GSQ1:` frames are the static path; the two prefixes never mix in one session.
2. Decode Base45 (two-pass, no output until valid). `decoded.length` must be `16 <= length <= 16 + 512`.
3. Parse the header. Reject unless: `2 <= count <= 64`, `index < count`, the `totalLength` rule above, and the chunk length equals the length implied by `index`, `count` and `totalLength`.
4. First valid frame: allocate ONE `Uint8Array(totalLength)` and a 64-bit "received" bitmap; record `transferId`, `count`, `totalLength`, `startedAt`, `lastNewAt`.
5. Later frames: a different `transferId`, `count` or `totalLength` is a foreign frame: ignored, counted, shown as "Different transfer. Cancel to start over." It is never merged and never replaces the active
   transfer.
6. Same `transferId`: a duplicate (index already received, identical bytes) is ignored (no progress change, no `lastNewAt` update). A same-index frame with different bytes aborts the transfer (`Conflict`): buffer dropped, camera stopped, message shown.
7. Out-of-order frames are written at `index * 512` and the bitmap bit is set. Progress = set bits / `count`.
8. All bits set: the buffer is the capsule. It enters the static path at "`onAccepted(bytes)`": `decodeCapsule` preview, explicit import, at-most-once set. Buffer and bitmap are released.
### 12.3 Expiry and cancellation
Expire 120 s after `startedAt` or 30 s after `lastNewAt`, whichever comes first (fake-timer testable). Expiry, Cancel, `pagehide`, hidden, session change and error all drop the buffer and stop the camera. One transfer at a time.
### 12.4 Sender
Loop frames at no more than 3 per second (a flashing-content limit), with Pause and Next frame buttons (keyboard), starting paused when `prefers-reduced-motion: reduce`. A loop shows `count` frames in order and repeats.
### 12.5 Why it waits
Animated frames multiply the optical risk (each frame must be read, in any order) and add a stateful reassembler. If a single static code cannot be read reliably, animation will not fix it; if it can, animation extends the size limit.
### 12.6 Planned tests (OPTIONAL, described as planned; not in the MVP gate)
U-QRA-01 header codec and bounds before allocation (allocation spy: 0 calls on each rejected header); U-QRA-02 duplicates ignored, conflicting duplicate aborts; U-QRA-03 out-of-order permutations (property, 4 batches) reassemble
to the original bytes; U-QRA-04 foreign `transferId`, `count`, `totalLength` never merge; U-QRA-05 expiry with fake timers (120 s total, 30 s stall); U-QRA-06 cancel and session end release buffer and stop tracks; U-QRA-07 completed
bytes equal the static-path bytes and then run the same preview and import; E2E-QRA-01 fixture two-profile animated transfer; PHYS-QRA-01 manual.

## 13. Test strategy
### 13.1 Observation helpers
- UI: DOM observation with the selectors in 9.2, through PatchBoard's existing `press`, `btn`, `saveIndicator`, `importResult`, `join`, `loadUntilOfflineReady`, `offlineProfileOnBoard` helpers.
- P1: `storedState(page)` (raw IndexedDB record decoded in Node), as in PatchBoard's E2E helpers.
- Camera stub (new, in `apps/patchboard/e2e/camera.ts`): `installFakeCamera(context)`, `setCameraFrame(page, frame)`, `setCameraMode(page, mode)`, `cameraCalls(page)`, `trackStates(page)`.
- Request recorder: `page.on("request")` plus the server's `/__test/request-log`.
### 13.2 Unit and property inventory (Vitest, Node; default 5 s timeout; none has run)
| ID | File | Covers |
| --- | --- | --- |
| U-QR-01 | `packages/qr-transfer/tests/base45.test.ts` | RFC vectors (3.2), empty input, boundaries `FGW`/`GGW`/`U5`/`V5`, leftover character, lowercase |
| U-QR-02 | `.../frame.test.ts` | prefix, limits 1232/1233/0, text length 1853, a 1855-character text throws `TooLarge` with 0 `allocate` calls (G3), rejection matrix with the `allocate` seam, order of checks, no normalization, the interior-space frame `GSQ1: 0` and the appended-space cases (odd count `OutOfRange`, even count `InvalidLength`, `GSQ1: 0 ` `OutOfRange`; 3.3) |
| U-QR-03 | `.../symbol.test.ts` | versions for 328, 658, 988, 1231, 1232 bytes; option recording through `buildQrSymbolWith`; 1854-character text throws `TooLarge` |
| U-QR-04 | `.../raster-roundtrip.test.ts` | rasterize at scale 4 with quiet zone, decode with the jsqr engine; sizes 11, 328, 658, 988, 1231, 1232; the interior-space frame `GSQ1: 0` (byte 0x24) round-tripped through encode, raster, scan-step exact text, `decodeFrame`; negative text `GSQ1: 0 ` returned verbatim by the engine and rejected `OutOfRange` by `decodeFrame` (synthetic, not an `encodeFrame` output; engine/text level if rastering it is awkward). For the 1232-byte symbol, assert from the jsqr result (`QRCode.chunks`, `QRCode.version`): `version === 25`, `chunks.length === 1`, `chunks[0].type === "alphanumeric"`, `chunks[0].text === frame`, alongside size 117, `ecc "L"` (asserted via the recorded options in U-QR-03; the raster does not expose ECC) and exact text equality (G1). jsqr's result type has `chunks` and `version` fields and its `Mode` enum value for alphanumeric is the string `"alphanumeric"` (README and source of jsQR, fetched; field names confirmed, exact enum value to be confirmed on first run). The `FrameDecoder` seam returns only a string, so the test calls the engine module's internal `decodeDetailed`; if it turns out jsqr does not expose `chunks[].type` at the pinned 1.4.0, record that as a finding in design 17 and observe the mode with the minimal alternative: decode the raster's 4-bit mode indicator from the format-corrected data bits in a test-side helper (no new public API) |
| U-QR-05 | `.../scan-session.test.ts` | fake `getUserMedia`, fake timers and events: constraints, error mapping, cleanup on each trigger, deferred `getUserMedia`, deferred `loadEngine` and deferred `play()` races, each in a resolve and a reject variant (generation check first, stale rejection emits nothing), restart regressions (a) Cancel then immediate re-Scan with the OLD `getUserMedia` resolving after the new stream is active (old tracks `stop` once; new tracks 0 `stop` calls, `readyState` live, `srcObject` still the new stream, new loop still delivers one accepted result, final `stop()` closes new tracks once), (b) stale `loadEngine` rejection after restart (no `failed`, new session unaffected, old tracks stopped), (c) stale `play()` rejection after restart; negative control: a shared-`currentStream` implementation must fail (a). Also track `ended`, single result, idempotent stop, second `start`, non-terminal hints, engine load failure |
| U-QR-06 | `.../package-boundary.test.ts` | static scan of `src` (no workspace/yjs/node/network/storage names), `package.json` dependency pins, `THIRD_PARTY_NOTICES.md` content |
| P-QR-01 | `.../base45.property.test.ts` | round trip of bytes length 1..1232 (generator includes all-zero, all-0xFF, odd and even lengths) |
| P-QR-02 | `.../frame.property.test.ts` | frame length formula, alphabet, `<= 1853`, prefix |
| P-QR-03 | `.../raster.property.test.ts` | symbol raster round trip through the decoder; generator `fc.record({ n: biased 11..1232 })` over random bytes biased to include bytes that produce the space character (for example values with `a % 45 == 36`, and 2-byte values whose digit `c` or `d` is 36), so interior spaces are covered naturally; no end-in-space generator exists because a valid frame never ends in a space |
| P-QR-04 | `apps/patchboard/tests/qr-mutation.property.test.ts` | single-character mutations of a real capsule frame never produce an accepted capsule with different bytes (either `decodeFrame` throws a `QrTransferError`, or `decodeCapsule` of the result rejects, or the bytes equal the original). It lives in the app because it needs the real Capsule and Kit; the package keeps no workspace dependency |
| U-QR-10 | `apps/patchboard/tests/qr-import-flow.test.ts` | controller seam tests with the existing `controller-seams.ts`: pipeline use, outcomes equal to file import, at-most-once (double activation, rescan, reentry, scan during a pending import, applied-set re-check, held capsule kept when `importPending`, "import did not run"), session binding, applied-unsaved, limit 1233 rejected and 1232 accepted through the QR import path (G2) |
| U-QR-11 | `.../transfer-mode.test.ts` | label and attribute per state |
| U-QR-12 | `.../qr-errors.test.ts` | every copy string in 9.3: length, next step, "file" where required |
| U-QR-13 | `.../qr-boundary.test.ts` | static scan of `apps/patchboard/src`: only public entries, no kit/yjs in `src/transfer/qr/` |
Property batches: four separately named 50-case batches per property (`registerBatches`, seeds 424242 to 424245, `numRuns === 50`, `numSkips === 0`), default timeout, no overrides. P-QR-04 builds its capsule with a `buildCapsule`-style helper in `apps/patchboard/tests/helpers.ts`.
Risk R-1: a decode of a version-25 raster at scale 4 is a 500 x 500 image; if 50 such cases exceed the 5 s default, the P-QR-03 generator is restricted to 11..658 bytes (documented), and the at-limit sizes stay in the example test U-QR-04. The timeout is never raised.

### 13.3 The fake camera: exact mechanism (EV-FIXTURE)
Installed per context with `context.addInitScript(installFakeCamera)`, in `apps/patchboard/e2e/camera.ts`; nothing of it exists in `src` or `dist`.
```
window.__ghostsyncCamera = {
  mode: "ok" | "NotAllowedError" | "NotFoundError" | "NotReadableError" | "SecurityError" | "OtherError" | "none",
  calls: 0, streams: [] as MediaStream[], frame: undefined as FrameSource | undefined,
  setFrame(source), setMode(mode)
}
navigator.mediaDevices.getUserMedia = async (constraints) => {
  window.__ghostsyncCamera.calls += 1
  if (mode !== "ok") throw new DOMException("fixture", mode)          // rejection by name
  canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720   // not attached to the DOM
  draw = () => { fill white; draw frame centered (modules at the largest integer scale that fits 600 px with a 4-module quiet zone, or an image) }
  setInterval(draw, 100)                                              // frames keep flowing; captureStream emits on change
  stream = canvas.captureStream(10); streams.push(stream); return stream
}
mode "none": Object.defineProperty(navigator, "mediaDevices", { value: undefined })
```
- `FrameSource` is `{ kind: "modules", size, data: number[] }` (the test rasterizes the Node-built `buildQrSymbol` matrix itself: the test helper's rasterizer, not `paintQr`, REQ-QR-015) or `{ kind: "image", dataUrl }` (the
  sender's real `qr-canvas.toDataURL()`, used by E2E-QR-01 to cross profiles).
- Observations: `calls` (AC-QR-005-1), `streams.map(s => s.getTracks().map(t => t.readyState))` (`live` then `ended`, AC-QR-005-4), `securitypolicyviolation` listener, `document.activeElement`.
- Real parts exercised: the real `<video>` playing a real `MediaStream`, the real canvas read-back, the real jsqr decode, the real controller. Not exercised: lens, focus, exposure, moire, glare, screen refresh, motion blur. That is why EV-FIXTURE never stands in for EV-PHYS.
- Why not only the Chromium flags: `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` and `--use-file-for-fake-video-capture=<file>` take one video file per browser launch (Y4M or MJPEG per secondary sources), so each test case would need its own
  launch and binary file, with no way to inject permission errors or read track state. E2E-QR-13 (SHOULD) is a smoke test through a second Playwright project with those flags and one committed MJPEG; it would carry the label EV-FIXTURE-FAKEDEVICE and is
  optional because the file format restrictions are UNVERIFIED here.

### 13.4 Browser scenarios (Playwright, real Chromium, each profile a separate `browser.newContext`; default timeouts; no retries)
| ID | Scenario (summary) |
| --- | --- |
| E2E-QR-01 | Two offline profiles A and B on `sprint-board`. A adds 2 cards, `press(qr-show-btn)`; canvas drawn; details match. The test passes A's `qr-canvas.toDataURL()` to B's camera stub. B `press(qr-scan-btn)`, state `scanning`, `Network: offline`, then `scanned`, preview and checksum equal A's, camera tracks ended, nothing stored. B `press(qr-import-btn)`: `applied-saved`, B shows both cards, P1 equal to A's cards, offline reload keeps them |
| E2E-QR-02 | Camera failure matrix on one profile: `NotAllowedError`, `NotFoundError`, `NotReadableError`, `SecurityError`, other, `mediaDevices` deleted: state, message, file controls enabled, then a real `.gscap` import via `setInputFiles` applies and `transfer-mode` is `file` |
| E2E-QR-03 | Lifecycle: cancel, accept, `pagehide`, hidden, Change board each end with tracks `ended` and `srcObject === null`; transfer mode returns to `file`; focus targets (AC-QR-013-4); Hide removes the canvas |
| E2E-QR-04 | Explicit import: after `scanned`, 1 s later P1 and `data-save-sequence` unchanged; preview fields; `press(qr-import-btn)` applies |
| E2E-QR-05 | At most once: two clicks in one task, rescan of the same code (`already-imported`), activation during a held `SubtleCrypto.digest` (importing, Change board, Update now and `qr-scan-btn` disabled, a pending-window scan cannot start), release, then rescan gives `already-imported` and `data-save-sequence` rose by exactly 1. The two clicks in one task are the one deliberate exception to keyboard-only activation |
| E2E-QR-06 | Rejection matrix by scanning: non-terminal frame rejections stay `scanning`; corrupted, truncated, version-2 capsules give `rejected`; wrong-app and wrong-board capsules reject at import with `AppIdentityMismatch` / `DocumentIdentityMismatch`; P1 unchanged each time |
| E2E-QR-07 | Offline startup and assets: fresh profile, online until ready, `setOffline(true)`, reload, scan works; request recorder only same-origin; 0 CSP violations; 0 `getUserMedia` calls before activation; no page-initiated decoder request before activation; no storage writes by scanning |
| E2E-QR-08 | Layout and wording at 1280 x 800 and 320 x 640: no horizontal overflow in each state; show panel `too-narrow` at 320; trust note text; focus order |
| E2E-QR-09 | Too-large capsule: one card with a 2000-character note; `too-large` with size and 1232; file export still downloads |
| E2E-QR-10 | Session binding: scan on board A (held), Change board, open board B: `idle`, no import button, B unchanged |
| E2E-QR-11 (SHOULD) | Decoder chunk blocked with `context.route` in a profile that has not precached it: `failed` and file fallback |
| E2E-QR-12 | Applied-but-unsaved by QR: flush and assert setup writes, arm one-shot abort, import; alert; rescan `already-imported`; Retry save by keyboard |
| E2E-QR-13 (SHOULD) | Fake-device flag smoke (13.3) |
Test files: `apps/patchboard/e2e/qr-transfer.spec.ts` (01, 04, 05, 06, 10, 12), `qr-camera.spec.ts` (02, 03, 07, 11, 13), `qr-layout.spec.ts` (08, 09). `playwright.config.ts` is unchanged except E2E-QR-13's optional project.

### 13.5 Fixtures (all synthetic)
Node-built capsules with `buildCapsule(BOARD, "patchboard", fill)` (existing helper): `ok-2-cards` (988 bytes), `ok-1-card`, `wrong-app` (`app` `fieldledger`), `wrong-board` (`documentId` `other-board`), `bad-checksum` (one flipped byte inside the update), `truncated`, `version-2` (header byte 2), `too-large` (notes 2000 characters), frames: `foreign-url` (`HTTPS://EXAMPLE.INVALID/`), `gsq2`, `gsa1`, `oversize-text` (1854 characters), `lowercase`, `bad-length`.

### 13.6 Banned names in `dist` (D-QR-01 and the existing list)
`__ghostsyncCamera`, `__ghostsyncFixture`, `captureStream`, `qr-fixture`, plus the existing `armWriteAbortOnce`, `holdNextFileRead`, `releaseFileRead`, `__ghostsyncTest`, `sw-install-fail`, `/__test/`, `fail-asset`, `request-log`. Also: no `*.wasm` in `dist`;
no `new Worker`; no `jsdelivr` or `unpkg`; the CSP meta unchanged; every `dist/assets/*` file appears in the precache manifest.
Caution: `captureStream` must not appear in the shipped decoder bundle. `jsqr` does not use it; if the bundle does contain the word for any reason, the ban is narrowed to the stub's own names and D-QR-01 records why.

### 13.7 Reporting rule
`docs/progress.md` entries for this feature list `EV-UNIT`, `EV-FIXTURE`, `EV-DIST` and `EV-PHYS` on separate lines with counts and status. `EV-PHYS` is `NOT RUN` until the task 9 template is filled and a person signs it (done 2026-11-16: PASS, user-reported, 14.5). EV-PHYS means the user's manual run on a real phone. A passing fixture test
is never described as a camera test of a phone.

## 14. Physical screen-to-phone test (EV-PHYS, manual, networking disabled after setup)
### 14.1 Setup
- Target phone: a real iPhone running Safari (not a home-screen app, not an in-app browser). Record the iPhone model and the iOS version (Settings > General > About) and the Safari version (the iOS version). Any other device is informational only. The 14.2 threshold applies to this phone. The iOS facts behind this section are in 14.4.
- Sender: a laptop or desktop with the production build served on `http://localhost:4339` (`pnpm.cmd -F @ghostsync/patchboard build`, then `node apps/patchboard/e2e/static-server.mjs`). Chromium or Chrome, brightness 70 to 100 percent (record), indoor light, no glare. `data-qr-scale` must be 5 or more: PHYS-QR-01 is INVALID (not a failure) for any attempt set recorded below scale 5, the scale is recorded in the template, and the tester widens the window or uses a wider screen and repeats. The 5 is a physical-test precondition; the app-level rule (AC-QR-004-3) stays 4 or more, with 5 or more a SHOULD at 1280 x 800.
- Phone access to the build with a secure context: an HTTPS URL the iPhone can reach over Wi-Fi while setup is online and whose certificate the iPhone trusts (a public HTTPS tunnel or host, or a locally generated CA that is installed on the iPhone and enabled under Settings > General > About > Certificate Trust Settings). `http://localhost:4339` and `adb reverse` do not apply: `localhost` on the iPhone is the iPhone. A plain-HTTP LAN address is not a secure context and gives no camera access and no service worker (L-6). An untrusted self-signed certificate is expected to block service worker registration (UNVERIFIED on iOS Safari; the check is "Ready to work offline" on the phone in 14.1). The HTTPS URL used is recorded in the template.
- Setup while online: both devices load the app, show "Ready to work offline", open board `sprint-board`. The sender builds the board for each size class. Then disable networking on the iPhone: turn Airplane Mode on in Control Center, then confirm Wi-Fi is also off (Airplane Mode keeps a Wi-Fi setting you turned on separately; turn Wi-Fi off in Settings > Wi-Fi; Bluetooth is irrelevant). The sender goes Wi-Fi off or Ethernet unplugged. Confirm `Network: offline` on both screens and reload the iPhone page in the same Safari tab: it must load from the service worker cache with no network. If the reload fails, the run does not start (setup failure, not a QR failure). The camera permission prompt is expected on the first Scan tap of a page load (14.4).
### 14.2 Procedure and threshold
- Size classes are defined per rung, as a small class S and a large class L that sits close to the active limit. Every class must be reachable by a capsule the app can produce, and `data-qr-bytes` must fall inside the range:

  | Rung (limit) | Class S (capsule bytes) | Class L (capsule bytes) | How the board is built |
  | --- | --- | --- | --- |
  | 0, 1: 1232 | 600 to 700 (1 card, near 658, versions 17 to 19) | 1150 to 1232 (2 cards with longer notes, version 25) | as in 4.3 |
  | 2a: 829 | 300 to 400 (empty board, 328, or a longer board ID, versions 12 to 14) | 750 to 829 (1 card with notes of about 100 more characters than 4.3, versions 19 to 20) | 1 card is 658 bytes, so L needs longer notes |
  | 2b: 502 | 328 (empty board, versions 12) | 380 to 502 (empty board with a 64-character board ID gives 380; no app-built capsule is larger than 502 and nothing between 380 and 502 may be reachable) | only empty boards fit; the largest symbol, version 15, may be unreachable, and the record says so |

  Roughly: S is about 40 to 55 percent of the limit and L is at least 90 percent of it where the app can build one. At rung 2b the L class is the biggest reachable capsule and the result is recorded with its real size; it is a weaker test than rung 0 and is labelled that way. Record `data-qr-bytes`, `data-qr-version`, `data-qr-scale` for every attempt.
- Attempt: the phone is hand-held (no tripod, no flash) 20 to 50 cm from the screen so the code fills 50 to 90 percent of the preview height. Press Scan; start the clock when the preview shows. Success = `scanned` with the preview within 15 s. Rescan after each attempt (Cancel or Discard, fresh Scan). 10 attempts per class, 20 total.
- Import: at least one attempt per class is imported with the explicit button and the board must show the cards.
- PASS (AC-QR-016-1): both classes at least 9 of 10 within 15 s, airplane mode on, `Network: offline` shown on the phone. 9 of 10 is a practical gate, not a statistical guarantee; a pass means "reads in these conditions".
- Record: device, OS and browser versions, brightness, scale, distance range, lighting, each attempt's seconds or FAIL, notes, pass or fail, rung applied.
### 14.3 Fallback ladder if the threshold is missed (decided now)
0. Tuning without changing the format: raise the decode edge `SCAN_MAX_EDGE_PX` from 1280 to 1920, allow a larger on-screen scale (up to 8). Re-run the full threshold.
1. (Not applicable on iPhone Safari: BarcodeDetector is not available by default there, 14.4, so this rung cannot improve an iPhone result; skip to rung 2, or consider a WASM engine such as `zxing-wasm` as a separate decision with its CSP and precache costs, section 16.) If failures are decoder-related (a sharp, focused, steady code that jsqr misses): add a BarcodeDetector engine behind the same `FrameDecoder` seam where `BarcodeDetector` and the `qr_code` format are available, jsqr as fallback; add the engine tests; re-run. This changes the decoder, not the format.
2. Lower the byte limit one rung and re-run BOTH classes at that rung, using the classes of the 14.2 table for the new rung (results from a higher rung are never carried over, and S is re-measured even if only L failed, because the symbol, the scale and the capsule all change): version 20 level L gives (1249 - 5 = 1244 characters = 414 groups of 3 + 2) 414 x 2 + 1 = 829 bytes; then version 15 level L gives (758 - 5 = 753 = 251 x 3) 502 bytes. Change only `QR_MAX_CAPSULE_BYTES`, `QR_MAX_FRAME_CHARS` and `QR_MAX_VERSION`, and the U-QR-02/03 expectations. (At 829 bytes about one card fits; at 502 bytes only an empty or nearly empty board.)
3. If the 502-byte rung still misses: QR transfer ships as unsupported-optional. `QR_ENABLED = false` in the app config hides the QR block; the code and tests stay; file transfer is the only tier. The progress note records the result; animated QR is not started.
Rungs 0 and 1 keep the 1232 limit and re-run both 1232-rung classes. The shipped constants always equal the highest rung that passed.

### 14.4 iOS Safari facts behind this protocol (researched 2026-11; sources in section 17)
| Fact | Effect on this design |
| --- | --- |
| `getUserMedia` is available only in a secure context (HTTPS) and prompts the user for permission (MDN). | Needs an HTTPS origin (14.1). Matches the `insecure` state in 7.1. Expect a permission prompt on the Scan tap; a denial maps to `denied`. |
| WebKit requires a user gesture for `video.play()` unless the video is muted; a muted `play()` is allowed without a gesture, and `playsinline` keeps it from entering fullscreen on iPhone (WebKit blog, "New video policies for iOS"). | The scan starts from the Scan button tap, and step 6 of 7.2 already sets `muted` and `playsInline` before `play()`. No change. Whether Safari additionally requires a gesture for `getUserMedia` itself was not confirmed from an authoritative source; the Scan tap satisfies it either way, but `loadEngine()` runs between the tap and `play()`, so the tester records any `play()` rejection (shown as `failed`). |
| BarcodeDetector is not on by default in Safari; iOS 17 and later can enable it under Settings > Safari > Advanced > Feature Flags (MDN data, whatpwacando.today). | Not relied on (D-QR-5). Rung 1 of 14.3 does not help on iPhone (see 14.3). |
| Service workers need a secure context; an untrusted certificate is reported to block registration (secondary sources). | "Ready to work offline" on the iPhone is the setup gate. |
| WebKit caps script-writable storage (IndexedDB, service worker registration, Cache API) at 7 days of Safari use without user interaction with the site (WebKit ITP posts, forum quotes). | Irrelevant within one test session. A phone not used with the site for 7 days must repeat the online setup. |
| Airplane Mode turns off Wi-Fi, cellular and Bluetooth, but Wi-Fi or Bluetooth turned on afterwards stay on the next time (Apple Support). | "Networking off" is Airplane Mode plus a check that Wi-Fi is off (14.1). The page's `Network: offline` indicator and a successful offline reload confirm it. |
| On iOS a backgrounded or locked page can lose its camera (the track is muted or ended). Not measured here. | 7.2 already stops the scan on `pagehide` and when the document is hidden, and on track `ended`. No `mute` listener is added; the tester notes any frozen preview after returning to the tab. UNVERIFIED. |

### 14.5 Result record (PHYS-QR-01, rung 1232, 2026-11-16)
EV-PHYS: PASS. User-reported manual test (the tester ran it by hand; not automated, not observed by the agent). iPhone 14 Pro Max, iOS 27.2.1 as reported, Safari tab. PatchBoard loaded and restored `sprint-board` fully offline (Airplane Mode on, Wi-Fi off). Class S (650 bytes, version 18) 10/10; class L (1232 bytes, Version 25-L, 1853 frame characters) 10/10; each within 15 s; module scale >= 5 on every attempt. Rung 1232, no fallback applied (14.3 not triggered). The filled template is in `tasks.md` section 9; the entry is in `docs/progress.md`.
Not shown: a second device or browser, hand-held distance, brightness and lighting beyond what was reported, per-attempt seconds and scales (not recorded). "Reads in these conditions", not a guarantee. Fixture and Chromium passes remain EV-UNIT and EV-FIXTURE. The 14.4 items marked UNVERIFIED (backgrounding, Safari gesture rules) were not separately reported. Animated QR stays optional and not started.

## 15. How the second app consumes the API (FieldLedger; not built here)
1. Add `"@ghostsync/qr-transfer": "workspace:*"` to `apps/fieldledger/package.json`.
2. Backport the guard that PatchBoard already has to `apps/fieldledger/src/session/session-controller.ts`: an `importPending` getter, a session `generation` captured by `importFile` and checked after each `await`, `onSessionEnd`, and the `importFile` to `importBytes` split (section 8.1), with FieldLedger's own tests. This is the only prerequisite.
3. Copy the app-side QR module shape (`src/transfer/qr/`): the controller, view and copy depend only on the package's two entry points, `decodeCapsule`, and the app's `SessionController`; nothing in them mentions a board, so the port is a rename of labels and the `transfer-mode` element FieldLedger already has.
4. The frame text, the 1232-byte limit, scanner and paint code, and the tests of the package are shared and unchanged. FieldLedger adds its own E2E reusing the camera stub (moved into a shared e2e helper if two apps need it, a later refactor, not now).
5. Capsule identity is unchanged: `app` `fieldledger` capsules are rejected by PatchBoard by the existing check, and vice versa.

## 16. Packaging and dependencies
| Package | Version | License | Last release (registry timestamp) | Role | Why this one |
| --- | --- | --- | --- | --- | --- |
| `jsqr` | 1.4.0 | Apache-2.0 | 2021-04 | decoder, pure JS, input `Uint8ClampedArray` RGBA, returns `data` string and `binaryData` | no WASM, no worker, no network, works in Node for tests. Not actively maintained (registry modified date 2025-11 is later than the 2021-04 1.4.0 upload; no newer release): accepted risk L-4, mitigated by the ladder (14.3). Apache-2.0 requires keeping its license and notice with redistributions: `THIRD_PARTY_NOTICES.md` and a copy in the app build (task 7.3) |
| `uqr` | 0.1.3 | MIT | 2026-04 | encoder, `encode()` returns the module matrix | explicit `ecc`, `minVersion`, `maxVersion`; zero dependencies; maintained by the unjs organization |
Not chosen: `qr-scanner` 1.4.2 (MIT, 2022-11; wraps a jsqr fork plus a worker file and its own BarcodeDetector use: more moving parts); `zxing-wasm` 3.1.6 (MIT, WASM ~1.04 MiB reader, `.wasm` fetched from a CDN by default,
needs `wasm-unsafe-eval`; the strongest decoder, kept as an escalation, not a default); BarcodeDetector (section 17).
Lockfile: `pnpm.cmd install` adds the `packages/qr-transfer` importer, the PatchBoard dependency edge and the `uqr` and `jsqr` packages. No other package. The app depends on `@ghostsync/qr-transfer` only.
Build order: kit, capsule, persist, qr-transfer, then PatchBoard (the app resolves built entries, as today).

## 17. Sources and verification status
Verified in this pass (fetched):
- QR capacity at 40-L (7,089 numeric, 4,296 alphanumeric, 2,953 byte) and `4v + 17` modules: https://en.wikipedia.org/wiki/QR_code (Information capacity).
- Capacity per version and level: https://www.thonky.com/qr-code-tutorial/character-capacities (secondary reproduction of the ISO/IEC 18004 table; the full table was read, version 25 L = numeric 3057, alphanumeric 1853, byte 1273).
- Version range and module counts (21 x 21 to 177 x 177): https://www.qrcode.com/en/about/version.html (the capacity tables on that site were NOT retrievable in this pass, and ISO/IEC 18004 itself was not read).
- Base45, vectors and the statement about byte-mode readers: https://www.rfc-editor.org/rfc/rfc9285 and https://datatracker.ietf.org/doc/html/rfc9285 (examples 2 to 4 and the decoding example fetched; example 1 `AB` -> `BB8` computed here).
- BarcodeDetector support (Chrome desktop on ChromeOS and macOS only, Chrome Android 83, Safari 17 behind a flag, Firefox none; `rawValue` is a string): https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/BarcodeDetector.json and https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector (not Baseline, secure context).
- `jsqr` 1.4.0, Apache-2.0, input and output shape: https://registry.npmjs.org/jsqr/latest and https://raw.githubusercontent.com/cozmo/jsQR/master/README.md. Release date from the registry upload timestamp (1619234240477 ms = 2021-04-24).
- `uqr` 0.1.3, MIT, zero dependencies, options (`ecc`, `minVersion`, `maxVersion`, `boostEcc`, `border`): https://registry.npmjs.org/uqr/latest, https://github.com/unjs/uqr/blob/main/README.md, https://unpkg.com/uqr@0.1.3/dist/index.d.ts (timestamp 2026-04-03).
- `qr-scanner` 1.4.2 MIT (2022-11): https://registry.npmjs.org/qr-scanner/latest. `zxing-wasm` 3.1.6 MIT, wasm sizes and the default jsDelivr serve path: https://registry.npmjs.org/zxing-wasm/latest and https://raw.githubusercontent.com/Sec-ant/zxing-wasm/main/README.md.
- `getUserMedia` needs a secure context and rejects with `NotAllowedError` or `NotFoundError`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia (search excerpt and the MDN source file at https://github.com/mdn/content/blob/main/files/en-us/web/api/mediadevices/getusermedia/index.md).
iOS Safari retarget (2026-11, search results, not an iPhone run):
- Video playback policy, `playsinline`, muted `play()` without a gesture: https://webkit.org/blog/6784/ (fetched).
- `getUserMedia` secure context and permission prompt: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia.
- BarcodeDetector missing in Safari, iOS 17+ feature flag: https://dev.to/ilhannegis/barcode-scanning-on-ios-the-missing-web-api-and-a-webassembly-solution-2in2 and https://whatpwacando.today/barcode/ (snippets only).
- Service worker with untrusted certificate: https://mswjs.io/guides/recipes/using-local-https and https://stackoverflow.com/questions/71149601/ (snippets; not iOS-specific).
- 7-day cap on script-writable storage: https://webkit.org/blog/9521/intelligent-tracking-prevention-2-3/ (snippet) and https://stackoverflow.com/questions/50795409/ (quotes the WebKit statement for iOS 13.4).
- Airplane Mode and Wi-Fi: https://support.apple.com/en-vn/HT204234.
Not verified (marked UNVERIFIED; the plan includes a check):
- Character-count indicator bits (11 at versions 10 to 26) and 1276 data codewords at 25-L: from memory; covered by the boundary test U-QR-03.
- That `uqr` picks alphanumeric mode automatically for an all-alphanumeric string and throws when the data exceed `maxVersion`: not read in source; covered by U-QR-03 (version for each size, the 1854-character case).
- `jsqr` reading dense version-25 codes reliably on phones: not claimed; that is what PHYS-QR-01 measures.
- Chromium fake-device flags and the Y4M/MJPEG restriction: only from secondary sources (https://www.browserless.io/blog/webrtc-video-automation, https://github.com/microsoft/playwright/issues/24589); the primary test does not depend on them.
- A search result claiming BarcodeDetector shipped by default in Chrome 134 on all platforms (a dev.to article) contradicts the MDN compatibility data above; it was NOT relied on.
- `adb reverse` for the phone test: no longer used (the physical target is an iPhone, 14.1).
- iOS Safari items of 14.4 marked UNVERIFIED (a `getUserMedia` user-gesture requirement, an untrusted certificate blocking service workers on iOS specifically, camera behavior on backgrounding): confirm in task 9.
- Whether a `MediaStream` on a `<video>` and a canvas are exempt from the CSP `default-src 'self'`: expected; E2E-QR-07 checks for violations.
- Whether `page.on("request")` reports the dynamic-import fetch with `request.frame() !== null` while excluding the service worker's own fetches: expected from Playwright's request model; confirmed when E2E-QR-07 is first written.

### 17.1 Findings from the implementation run (confirmed or changed)
- `uqr` 0.1.3 picks alphanumeric mode for an all-alphanumeric frame and throws `Data too long` above `maxVersion`. Confirmed (U-QR-03). `border: 0` is passed so `size` is the module count (117 at version 25).
- `jsqr` 1.4.0 exposes `chunks[].type` with the string value `"alphanumeric"` and `version`. Confirmed (U-QR-04, G1): the 1232-byte symbol decodes as version 25 with one alphanumeric chunk equal to the frame.
- CHANGED: `jsqr` 1.4.0 does not decode ANY version 23 symbol at level L (checked for every mask pattern and several contents; versions 1 to 22, 24 and 25 at L decode, and 23 at M, Q and H decode). The cause was not isolated:
  either `jsqr` or `uqr` mishandles 23-L. The wrapper therefore never emits version 23 (`JSQR_UNREADABLE_VERSION`); a text that fits version 23 is re-encoded from version 24. Capsules of 971 to 1055 bytes (frames of 1461 to 1588 characters) use version 24
  instead of 23, the 1232-byte limit is unchanged, and the 988-byte fixture is version 24 (requirements AC-QR-003-2).
- CHANGED (D-QR-01): the entry bundle already contained one `https://` string before this feature (a Yjs warning link, `https://github.com/yjs/yjs/issues/438`). The dist check allows exactly that one URL in the entry bundle and none in the decoder chunk.
- Property batch time for P-QR-03 over 11..1232 bytes: about 1.2 s per 50-case batch, so R-1 did not need the 11..658 restriction and the timeout stays at the 5 s default.
- Not implemented here: E2E-QR-13 (fake-device flags project, SHOULD), a 1854-character frame in the browser (the symbol builder refuses it by design; the text-level case is covered by U-QR-02), and any second-device run.

## 18. Traceability
Requirement to test: `requirements.md` section 10. Every MUST to named test and exact observation: `requirements.md` section 9. Tasks to requirements: `tasks.md` section 11.
