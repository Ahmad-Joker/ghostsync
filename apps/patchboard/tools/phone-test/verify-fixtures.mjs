/**
 * Automated fixture check for the phone-test fixtures. Evidence labels: EV-UNIT / EV-FIXTURE. NEVER EV-PHYS.
 *
 * A. Node, per fixture: decodeCapsule accepts the bytes (app patchboard, board sprint-board, checksum matches),
 *    encodeFrame(bytes) equals the stored frame, buildQrSymbol(frame) equals the stored modules, a raster at scale 5 and 6
 *    (4-module white quiet zone) decodes with the repo's jsqr engine to the exact frame, one alphanumeric chunk, the stored
 *    version, and decodeFrame gives back the exact capsule bytes.
 * B. Chromium (Playwright), unless --no-browser: opens fixture-display.html from file://, steps through every fixture with
 *    the keyboard, reads the DISPLAYED canvas pixels and decodes them the same way; the labels must match the data and the
 *    scale must be an integer >= 5 at 1366 x 768 and at 1920 x 1080.
 *
 *   node apps/patchboard/tools/phone-test/verify-fixtures.mjs [--no-browser]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeCapsule } from "@ghostsync/capsule";
import { buildQrSymbol, decodeFrame, encodeFrame } from "@ghostsync/qr-transfer";
import { decodeDetailed } from "../../../../packages/qr-transfer/dist/browser/jsqr-engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const { meta, fixtures } = JSON.parse(readFileSync(join(here, "generated", "fixtures.json"), "utf8"));
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

function raster(symbol, scale) {
  const total = (symbol.size + 8) * scale;
  const data = new Uint8ClampedArray(total * total * 4).fill(255);
  for (let y = 0; y < symbol.size; y += 1) for (let x = 0; x < symbol.size; x += 1) {
    if (symbol.modules[y * symbol.size + x] !== 1) continue;
    for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
      const o = (((y + 4) * scale + dy) * total + (x + 4) * scale + dx) * 4;
      data[o] = 0; data[o + 1] = 0; data[o + 2] = 0;
    }
  }
  return { data, width: total, height: total };
}
function unpack(b64, size) {
  const raw = Buffer.from(b64, "base64"), m = new Uint8Array(size * size);
  for (let i = 0; i < m.length; i += 1) m[i] = (raw[i >> 3] >> (7 - (i & 7))) & 1;
  return m;
}
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

let nodeChecked = 0;
for (const f of fixtures) {
  const bytes = new Uint8Array(Buffer.from(f.capsuleB64, "base64"));
  check(bytes.length === f.capsuleBytes, `${f.id}: byte length`);
  const cap = await decodeCapsule(bytes);
  check(cap.metadata.app === "patchboard" && cap.metadata.documentId === meta.board, `${f.id}: identity`);
  check(cap.metadata.sha256.slice(0, 12) === f.checksum12, `${f.id}: checksum label`);
  check(encodeFrame(bytes) === f.frame && f.frame.length === f.frameChars, `${f.id}: frame`);
  const sym = buildQrSymbol(f.frame);
  check(sym.version === f.version && sym.size === f.modules && same(sym.modules, unpack(f.bits, f.modules)), `${f.id}: stored modules equal a fresh uqr symbol`);
  for (const scale of [5, 6]) {
    const r = raster(sym, scale);
    const found = decodeDetailed(r.data, r.width, r.height);
    check(found !== undefined && found.text === f.frame, `${f.id}@${scale}: decoded text equals the frame`);
    check(found?.version === f.version, `${f.id}@${scale}: decoded version`);
    check(found?.chunkTypes.length === 1 && found.chunkTypes[0] === "alphanumeric", `${f.id}@${scale}: one alphanumeric chunk`);
    check(found !== undefined && same(decodeFrame(found.text), bytes), `${f.id}@${scale}: decodeFrame gives the exact capsule bytes`);
  }
  nodeChecked += 1;
}
const sizes = (cls) => [...new Set(fixtures.filter((f) => f.cls === cls).map((f) => f.capsuleBytes))].join(",");
const sumNode = `A. node: ${nodeChecked} fixtures (S bytes ${sizes("S")}, L bytes ${sizes("L")}); distinct checksums ${new Set(fixtures.map((f) => f.sha256)).size}`;

let sumBrowser = "B. browser: skipped (--no-browser)";
if (!process.argv.includes("--no-browser")) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  let shown = 0;
  const scales = {};
  try {
    for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(join(here, "fixture-display.html")).href);
      for (const cls of ["S", "L"]) {
        await page.keyboard.press(cls);
        for (let i = 1; i <= 10; i += 1) {
          const f = fixtures.find((x) => x.cls === cls && x.index === i);
          const info = await page.evaluate(() => {
            const c = document.getElementById("qr");
            const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let bin = "";
            for (let o = 0; o < px.length; o += 0x8000) bin += String.fromCharCode.apply(null, px.subarray(o, o + 0x8000));
            const t = (id) => document.getElementById(id).textContent;
            return { b64: btoa(bin), w: c.width, h: c.height, cssW: c.style.width, a: Object.assign({}, c.dataset), labels: { bytes: t("l-bytes"), frame: t("l-frame"), version: t("l-version"), scale: t("l-scale"), checksum: t("l-checksum"), board: t("l-board"), cls: t("l-class"), fixture: t("l-fixture") }, warnHidden: document.getElementById("warn").hidden };
          });
          const scale = Number(info.a.scale);
          scales[`${vp.width}x${vp.height}/${cls}`] = scale;
          check(Number.isInteger(scale) && scale >= 5, `${f.id} ${vp.width}: scale ${scale} must be an integer >= 5`);
          check(info.w === (f.modules + 8) * scale && info.h === info.w && info.cssW === `${info.w}px`, `${f.id}: canvas size is (modules + 8) x scale`);
          check(info.a.fixtureId === f.id && info.a.checksum === f.checksum12 && Number(info.a.bytes) === f.capsuleBytes, `${f.id}: data attributes`);
          check(info.labels.fixture.startsWith(f.id) && info.labels.bytes === String(f.capsuleBytes) && info.labels.frame === String(f.frameChars) && info.labels.version.startsWith(String(f.version)) && info.labels.scale === String(scale) && info.labels.checksum === f.checksum12 && info.labels.board === "patchboard / sprint-board" && info.labels.cls.startsWith(cls), `${f.id}: visible labels ${JSON.stringify(info.labels)}`);
          check(info.warnHidden, `${f.id} ${vp.width}: no warning banner`);
          const rgba = new Uint8ClampedArray(Buffer.from(info.b64, "base64"));
          // 4-module white quiet zone: the whole outer band of 4 x scale pixels is white.
          let quietOk = true;
          const band = 4 * scale;
          for (let y = 0; y < info.h && quietOk; y += 1) for (let x = 0; x < info.w; x += 1) {
            if (x >= band && x < info.w - band && y >= band && y < info.h - band) { x = info.w - band - 1; continue; }
            if (rgba[(y * info.w + x) * 4] !== 255 || rgba[(y * info.w + x) * 4 + 1] !== 255 || rgba[(y * info.w + x) * 4 + 2] !== 255) { quietOk = false; break; }
          }
          check(quietOk, `${f.id}: quiet zone is white`);
          const found = decodeDetailed(rgba, info.w, info.h);
          check(found !== undefined && found.text === f.frame, `${f.id} ${vp.width}: displayed pixels decode to the exact frame`);
          check(found?.version === f.version && found?.chunkTypes.length === 1 && found.chunkTypes[0] === "alphanumeric", `${f.id}: displayed version and alphanumeric chunk`);
          check(found !== undefined && same(decodeFrame(found.text), new Uint8Array(Buffer.from(f.capsuleB64, "base64"))), `${f.id}: displayed code gives the exact capsule bytes`);
          shown += 1;
          await page.keyboard.press("ArrowRight");
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  sumBrowser = `B. browser (Chromium, file://, keyboard stepping): ${shown} displayed fixtures decoded (20 per viewport x 2 viewports); scales ${JSON.stringify(scales)}`;
}

process.stdout.write(`${sumNode}\n${sumBrowser}\n`);
if (failures.length > 0) {
  process.stdout.write(`FAIL: ${failures.length} check(s) failed\n${failures.slice(0, 30).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("EV-FIXTURE: all fixture checks passed (this is not EV-PHYS)\n");
