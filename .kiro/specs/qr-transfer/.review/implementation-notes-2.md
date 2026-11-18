# Implementation notes 2: iPhone Safari retarget (2026-11)

Scope: spec text only. No code, test or device run. EV-PHYS stays NOT RUN.

## Change
The physical target moved from Android Chrome to a real iPhone in Safari. Thresholds are unchanged (9 of 10 per class within 15 s, networking off after setup, scale >= 5, fallback ladder).

## iOS facts that contradicted the spec, and the minimal correction
1. Phone access (design 14.1, tasks 9.1/9.2, L-6). The spec served the phone through `adb reverse` and `http://localhost:4339`. On an iPhone `localhost` is the phone, and `adb` does not apply. Corrected to: an HTTPS URL the iPhone can reach during online setup, with a certificate the iPhone trusts. The URL and certificate trust are recorded in the results template.
2. Fallback rung 1 (design 14.3). It adds a BarcodeDetector engine "where available". Safari does not enable BarcodeDetector by default (iOS 17+ has a feature flag), so the rung cannot improve an iPhone result. Corrected: rung 1 is marked not applicable on iPhone Safari; the next step is rung 2. A WASM engine is noted as a separate decision (it would need `wasm-unsafe-eval` and precache changes, design 16).
3. "Networking off" (design 14.1). Airplane Mode alone is not enough to assert: Apple documents that Wi-Fi turned on separately stays on. Corrected: Airplane Mode, then confirm Wi-Fi is off, then `Network: offline` plus a successful reload from the service worker.

## Checked and consistent (no change)
- Scan starts from a button tap; `muted` and `playsInline` are set before `play()` (WebKit video policy). Consistent with design 7.2 step 6.
- `getUserMedia` constraints (`facingMode` ideal environment, ideal 1920x1080) are ideal values, not exact, so they cannot cause `OverconstrainedError`.
- Scan stops on `pagehide`, hidden document and track `ended` (design 7.2, 7.4).

## Not verified (recorded as UNVERIFIED in design 14.4 and 17)
- Whether Safari requires a user gesture for `getUserMedia` itself (not confirmed from an authoritative source; the Scan tap satisfies it).
- Whether an untrusted certificate blocks service worker registration on iOS specifically (sources found are general).
- Whether iOS mutes or ends the camera track when the page is backgrounded (the template records any frozen preview).

## Sources
- https://webkit.org/blog/6784/ (fetched)
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://whatpwacando.today/barcode/ and https://dev.to/ilhannegis/barcode-scanning-on-ios-the-missing-web-api-and-a-webassembly-solution-2in2
- https://mswjs.io/guides/recipes/using-local-https
- https://webkit.org/blog/9521/intelligent-tracking-prevention-2-3/
- https://support.apple.com/en-vn/HT204234

Search snippets only, except the WebKit blog page.
