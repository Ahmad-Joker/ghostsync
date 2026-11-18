# QR transfer: physical iPhone test guide

Evidence label: **EV-PHYS: PASS (user-reported manual run, 2026-11-16, iPhone 14 Pro Max, Safari; record in `.kiro/specs/qr-transfer/tasks.md` section 9 and `docs/progress.md`)**. It was NOT RUN before that date. EV-PHYS means your manual run on a real phone. Nothing in this guide, and no fixture check, is a physical result (those stay EV-UNIT and EV-FIXTURE). Only a table filled in and signed by you is. Spec: `.kiro/specs/qr-transfer/design.md` section 14. Tooling: `apps/patchboard/tools/phone-test/` (not shipped, not in `dist`).

Setup: the laptop shows QR codes. The iPhone (Safari tab, not a home-screen app) loads PatchBoard over HTTPS, joins board `sprint-board`, then scans with networking off.

## 1. Prerequisites
- Windows laptop and an iPhone on the **same Wi-Fi** (no guest network or client isolation). Laptop screen at least 1366 x 768, brightness 70 to 100 percent, browser zoom 100%.
- Repo built once (from the repo root): `pnpm.cmd install --frozen-lockfile`, then `pnpm.cmd -F @ghostsync/kit build`, `-F @ghostsync/capsule build`, `-F @ghostsync/persist build`, `-F @ghostsync/qr-transfer build`, `-F @ghostsync/patchboard build`.
- You supply: the laptop's **LAN IP** (the `<laptop-lan-ip>` below), and on the iPhone the certificate trust step (section 3). No IP, key or token is stored in the repo.
- Find the IP: `ipconfig`, then the "IPv4 Address" under the Wi-Fi adapter (usually `192.168.x.x` or `10.x.x.x`). The server also prints candidates when it starts.

## 2. Why HTTPS, and the two ways
Camera access (`getUserMedia`) needs a secure context, and Safari gives service workers (offline use) only to HTTPS pages whose certificate it trusts. `http://localhost` on the iPhone is the iPhone, and a plain `http://<ip>` is not secure. In a Chromium check of the helper, the same page with an untrusted certificate ended in `failed` offline state and with a trusted one reached "Ready to work offline"; that is not a Safari result.

| | Recommended: local certificate (mkcert) | Alternative: public tunnel |
| --- | --- | --- |
| URL on the iPhone | `https://<laptop-lan-ip>:4443/` | `https://<random-words>.trycloudflare.com/` (printed by the tunnel) |
| What you install | mkcert on the laptop; its root certificate on the iPhone (profile plus "full trust") | `cloudflared` on the laptop; nothing on the iPhone |
| Exposure | LAN only; the helper refuses non-private clients | The static build is reachable by anyone who has the URL while the tunnel runs. **Only with your consent.** No app data leaves the phone: boards live in the phone's IndexedDB |
| Offline after first load | Yes (service worker, same origin) | Yes, but only while you keep the same URL. A new tunnel gets a new origin, which is a fresh profile (re-join the board) |
| Sources | [mkcert README](https://github.com/FiloSottile/mkcert) (mobile devices), [Apple: trust manually installed certificate profiles](https://support.apple.com/en-gb/102390) | [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare) |

This guide has not been run on an iPhone. The iOS steps follow the two sources above and are unverified until you do them.

## 3. Recommended path: mkcert certificate on the LAN IP
Do these once, from the repo root. They are your decisions: nothing here has been run for you.
1. Install mkcert (`choco install mkcert` or `scoop install mkcert`, see the README). You do not need `mkcert -install` (it only adds the root to the laptop's own trust stores, which this test does not need); mkcert creates its local CA the first time it issues a certificate.
2. Make the certificate (replace the IP):
   ```
   mkdir apps\patchboard\tools\phone-test\certs
   mkcert -key-file apps\patchboard\tools\phone-test\certs\lan-key.pem -cert-file apps\patchboard\tools\phone-test\certs\lan.pem <laptop-lan-ip> localhost
   mkcert -CAROOT
   ```
   `certs/` is git-ignored. The last command prints the folder holding `rootCA.pem`. Give the iPhone only `rootCA.pem`. Never share `rootCA-key.pem`.
3. Start the server (leave it running; stop it with Ctrl+C):
   ```
   node apps/patchboard/tools/phone-test/serve-https.mjs --root-ca "<CAROOT folder>\rootCA.pem"
   ```
   Windows may ask to allow Node.js on **Private** networks: allow it, or the phone cannot connect. The helper listens on port **4443**.
4. Put the root certificate on the iPhone, either way:
   - In Safari on the iPhone open `https://<laptop-lan-ip>:4443/__root-ca.crt`. Safari warns the site is not trusted (it is not yet): continue to the page and allow the profile download. Or email or AirDrop `rootCA.pem` to yourself (the mkcert README lists these).
   - Settings > **Profile Downloaded** > Install.
   - Settings > General > About > **Certificate Trust Settings** > turn on full trust for the mkcert root (Apple's steps).
5. Open `https://<laptop-lan-ip>:4443/` in Safari. There must be no certificate warning.

## 4. Alternative: public tunnel (only if you agree to publish the static build for the test)
```
node apps/patchboard/tools/phone-test/serve-https.mjs --http
cloudflared tunnel --url http://127.0.0.1:4480
```
Open the printed `https://<random-words>.trycloudflare.com/` on the iPhone. Keep the tunnel running until the first-load check passes, and do not restart it afterwards (the URL, and therefore the stored board, would change). Stop the tunnel when you finish. `--http` serves only the built files (no test endpoints).

## 5. First load and offline-ready check (iPhone, still online)
1. Open the URL in a Safari tab. Wait until the status says **"Ready to work offline."**. If it says offline use is not available, the certificate is not trusted: redo step 4 of section 3. Do not continue.
2. Enter board ID **`sprint-board`** and choose Open board. The phone must be on this board first: PatchBoard rejects a capsule whose document ID is not the open board, and a capsule from another app.
3. Record the build hash (`apps/patchboard/dist/precache-manifest.json`, `cacheVersion`), the iPhone model and the iOS version.

## 6. Networking off, then verify
1. On the iPhone turn Airplane Mode on (Control Center), then open Settings > Wi-Fi and confirm Wi-Fi is **off** (Wi-Fi turned on separately can stay on). Bluetooth does not matter.
2. Stop the laptop server (Ctrl+C), and the tunnel if you used one. The fixture page needs no network.
3. The page must show **"Network: offline"**. Reload in the same Safari tab: the app must load from the service worker. If it does not, this is a setup failure, not a QR failure: go back online and repeat section 5.
4. The camera prompt appears on the first "Scan QR code (camera)" tap. Allow it.

## 7. Fixtures on the laptop
Open `apps/patchboard/tools/phone-test/fixture-display.html` in Chrome or Edge (a file, no server, no network). 20 fixtures were generated, all real PatchBoard capsules for app `patchboard`, board `sprint-board`, level L, 4-module white quiet zone:

| Class | Fixtures | Capsule bytes | Frame characters | QR version | Modules | Keys |
| --- | --- | --- | --- | --- | --- | --- |
| S (small) | S01 to S10 | 650 | 980 | 18 | 89 | press `S` |
| L (large, the upper boundary of the 1,232-byte limit) | L01 to L10 | 1232 | 1853 | 25 | 117 | press `L` |

- Other keys: `Right`/`N` and `Left`/`P` next and previous code in the class, `+` and `-` scale, `A` automatic scale. Buttons do the same. `fixture-display.html#L03` opens one fixture.
- The side panel shows class, capsule bytes, frame characters, version, module scale and checksum (first 12 characters of the SHA-256, the same value PatchBoard shows in its preview). A red banner appears if the scale is below 5 or the screen scaling makes modules fractional.
- Use **a different code for each of the 10 attempts** of a class (S01 to S10, L01 to L10). Re-scanning one code 10 times is acceptable for a quick look, but once you import it PatchBoard shows it as already imported, so use distinct codes for the counted attempts.
- Regenerate (new capsules, new checksums; the data is synthetic): `node apps/patchboard/tools/phone-test/generate-fixtures.mjs`. Check them again: `node apps/patchboard/tools/phone-test/verify-fixtures.mjs` and `node apps/patchboard/tools/phone-test/verify-import.mjs`.

## 8. The attempts
For each class: hold the phone by hand (no tripod, no flash), 20 to 50 cm from the screen so the code fills 50 to 90 percent of the preview height. Tap **Scan QR code (camera)**, start the clock when the preview shows, stop when the preview lists the capsule. Then Discard scan (or Cancel) and start the next attempt with the next code.
- **VALID attempt**: module scale shown on the laptop is **5 or more** and the capsule bytes are in the class range. Otherwise it is **INVALID**: widen the window or use a bigger screen, then repeat it. An INVALID attempt is not a failure and does not count.
- **Success**: the preview appears within 15 seconds. **Failure**: no preview in 15 seconds, or a wrong-code message.
- Import one capsule per class with **Import scanned capsule** and confirm the board shows the new card (`fx-s-01` or `fx-l-01` style entries with the title "Phone test S01" and so on).

Table (copy into `docs/progress.md`, one per class):

| Attempt | Code | Scale | Seconds (or FAIL) | Result (VALID success / VALID fail / INVALID) |
| --- | --- | --- | --- | --- |
| 1 | S01 | | | |
| 2 | S02 | | | |
| 3 | S03 | | | |
| 4 | S04 | | | |
| 5 | S05 | | | |
| 6 | S06 | | | |
| 7 | S07 | | | |
| 8 | S08 | | | |
| 9 | S09 | | | |
| 10 | S10 | | | |

Repeat with L01 to L10 for class L.

## 9. Pass threshold and fallback
- **PASS**: in **both** classes at least **9 of 10** valid attempts succeed, each within 15 s, with Airplane Mode on, Wi-Fi off and `Network: offline` shown. This means "reads in these conditions", not a guarantee.
- **If a class misses**, follow design 14.3 in order: (0) raise the decode edge `SCAN_MAX_EDGE_PX` from 1280 to 1920 and allow a larger scale (up to 8), rerun both classes; (1) not applicable on iPhone Safari; (2) lower the limit to 829 bytes and then 502 bytes, rerun **both** classes with that rung's class ranges (design 14.2; the fixtures need new targets in `generate-fixtures.mjs`); (3) if 502 also misses, set `QR_ENABLED = false` and keep file transfer only. Never reuse a higher rung's results.
- File transfer (Export and Import capsule file) stays available whatever the result.

## 10. Record the result
Fill the results template in `.kiro/specs/qr-transfer/tasks.md` section 9 (task 9.3) and copy it into `docs/progress.md`. Until a run is filled in, the status is **EV-PHYS: NOT RUN**; the 2026-11-16 run is already recorded (PASS, user-reported). A fixture or Chromium pass is EV-UNIT or EV-FIXTURE and never replaces it.
## 11. Re-test the redesigned build on your iPhone (Kiroween redesign)
Status: **EV-PHYS NOT RUN** for the redesigned build. The earlier PASS (2026-11-16) applies to the previous interface only. Nothing below has been run; tick it yourself.
- [ ] Hero: open PatchBoard fresh in Safari with the toolbars showing. Board ID field and "Open board" are visible without scrolling. The illustration does not push them down.
- [ ] Tap the Board ID field so the keyboard opens. "Open board" can still be reached (scroll or already visible) and is not covered.
- [ ] Safari bottom toolbar: scroll to the bottom of the workspace. The last control is not hidden behind the toolbar or the home indicator.
- [ ] "See how it works" opens three short steps; Help is still in the header; "Built with Kiro for Kiroween" appears in Help.
- [ ] Offline banner: turn on Airplane Mode with the board open. One banner "The network vanished. Your work didn't." appears, the lantern flickers once, then stays still; you can keep editing and the save status stays accurate. With Reduce Motion on, nothing animates.
- [ ] Reload while offline: the board is still there and the banner shows.
- [ ] QR sender: "Show QR code" shows the code on a plain white stage with a wide white border and nothing drawn over it (use a larger screen if the phone is too narrow; the file fallback must be easy to find).
- [ ] Receiver: "Scan QR code (camera)" then Scan, Review, Import. After the scan you see the board name and "Import scanned capsule". After import the message says whether it saved.
- [ ] Camera scan of the unchanged QR: repeat the section 8 attempts if you want a new PASS for this build, and record them as in section 10.
- [ ] VoiceOver: buttons and the Board ID field read their names.
- [ ] Mobile usability pass: after a scan is accepted, the review panel scrolls into view (smooth, or instant with Reduce Motion on) and VoiceOver or the keyboard focus is on "Capsule found. Not imported yet".
- [ ] "Import scanned capsule" and "Discard scan" are both visible without scrolling after that automatic scroll, with the board name, the capsule size and the trust warning above them. Safari's toolbar does not cover them.
- [ ] "Details: app, created, checksum" is closed until you open it.
- [ ] First screen: "Open board" sits comfortably above the Safari toolbar with space below it, and "Preparing offline use" or the first-visit notice appears just below it.
