/**
 * Decorative-effect overlap audit (Kiroween UI polish): fog, glow, grain, pseudo-elements and the camera framing overlay
 * must not cover instructions, status text, forms, alerts or QR controls, and the QR canvas must carry no visual effect.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addCardUi, awaitSaved, btn, join, loadUntilOfflineReady, newProfile, press } from "./helpers.js";
import { capsuleFrame, qrOnlineProfile, setCameraFrame } from "./camera.js";
import { expectScanState, peerCapsule, qrBtn, scanFrame, showPanel } from "./qr-fixtures.js";
import { auditOverlap } from "./overlap.js";
import type { OverlapResult } from "./overlap.js";

const OUT = process.env["GS_SCREENSHOT_DIR"] ?? "";
const results: Record<string, OverlapResult> = {};
test.use({ trace: "off" });
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 320, height: 568 };

async function check(page: Page, key: string): Promise<void> {
  const r = await auditOverlap(page);
  results[key] = r;
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(joinPath(OUT, "overlap-audit-patchboard.json"), JSON.stringify(results, null, 2));
  }
  expect(r.checkedElements, `${key}: elements checked`).toBeGreaterThan(3);
  expect(r.hitFailures, `${key}: covered elements`).toEqual([]);
  expect(r.pseudoFailures, `${key}: decorative layers`).toEqual([]);
  expect(r.qrFailures, `${key}: QR effects`).toEqual([]);
}
async function failedEdit(page: Page): Promise<void> {
  await addCardUi(page, "Pump leak");
  await awaitSaved(page);
  await press(page, btn(page, "Edit card: Pump leak"));
  await page.getByTestId("card-edit-form").getByLabel("Title").evaluate((el, v) => {
    (el as HTMLInputElement).value = v;
  }, "y".repeat(121));
  await press(page, btn(page, "Save card: Pump leak"));
  await expect(page.getByTestId("edit-error-alert")).toBeVisible();
}

for (const [name, vp] of [
  ["desktop", DESKTOP],
  ["320", MOBILE],
] as const) {
  test(`E2E-PB-OVL-${name}: decorative effects never cover content (guidance, workspace, failed edit)`, async ({ browser }) => {
    const g = await newProfile(browser, { viewport: vp });
    await g.page.goto("/");
    await expect(g.page.locator("#guidance")).toBeVisible();
    await check(g.page, `guidance-${name}`);
    await g.context.close();
    const p = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(p.page);
    await join(p.page, "sprint-board");
    await addCardUi(p.page, "Draft spec v1", "Outline plus risks");
    await awaitSaved(p.page);
    await check(p.page, `workspace-${name}`);
    await p.context.close();
    const e = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(e.page);
    await join(e.page, "sprint-board");
    await failedEdit(e.page);
    await check(e.page, `failed-edit-${name}`);
    await e.context.close();
  });
  test(`E2E-PB-OVL-QR-${name}: decorative effects never cover QR display, scan in progress or scan review`, async ({ browser }) => {
    const d = await qrOnlineProfile(browser, "sprint-board", vp);
    await addCardUi(d.page, "Draft spec v1", "Outline plus risks");
    await awaitSaved(d.page);
    await press(d.page, qrBtn(d.page, "qr-show-btn"));
    await expect(showPanel(d.page)).toHaveAttribute("data-qr-state", name === "desktop" ? "ready" : "too-narrow");
    await check(d.page, `qr-display-${name}`);
    if (name === "desktop") expect(results[`qr-display-${name}`]?.qrCanvases, "QR canvas audited").toBeGreaterThan(0);
    await d.context.close();
    const s = await qrOnlineProfile(browser, "sprint-board", vp);
    await setCameraFrame(s.page, undefined);
    await press(s.page, qrBtn(s.page, "qr-scan-btn"));
    await expectScanState(s.page, "scanning");
    await expect(s.page.getByTestId("qr-video")).toBeVisible();
    await check(s.page, `scan-in-progress-${name}`);
    expect(results[`scan-in-progress-${name}`]?.scanOverlays, "framing overlay present").toBeGreaterThan(0);
    await s.context.close();
    const r = await qrOnlineProfile(browser, "sprint-board", vp);
    await scanFrame(r.page, capsuleFrame(await peerCapsule()));
    await expect(qrBtn(r.page, "qr-import-btn")).toBeVisible();
    await check(r.page, `scan-review-${name}`);
    await r.context.close();
  });
}
