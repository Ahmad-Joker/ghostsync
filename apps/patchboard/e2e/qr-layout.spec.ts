import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { press } from "./helpers.js";
import { capsuleFrame, qrOnlineProfile, setCameraFrame } from "./camera.js";
import { expectScanState, peerCapsule, qrBtn, scanFrame, showPanel } from "./qr-fixtures.js";

async function noHorizontalOverflow(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    canvasRight: document.querySelector<HTMLCanvasElement>('[data-testid="qr-canvas"]:not([hidden])')?.getBoundingClientRect().right ?? 0,
  }));
  expect(r.scroll, `${label}: scrollWidth ${r.scroll} vs clientWidth ${r.client}`).toBeLessThanOrEqual(r.client);
  expect(r.canvasRight, `${label}: canvas right edge`).toBeLessThanOrEqual(r.client);
}

const TRUST = "A capsule checksum detects corruption. It does not authenticate the sender: anyone who can show a code can show a valid capsule.";

test("E2E-QR-08 (1280 x 800): no overflow in any QR state, a wide block, scale 5 or more, trust note, tab order", async ({ browser }, testInfo) => {
  const p = await qrOnlineProfile(browser, "sprint-board", { width: 1280, height: 800 });
  const page = p.page;
  const { addCardUi, awaitSaved } = await import("./helpers.js");
  await addCardUi(page, "Draft spec v1", "Outline plus risks");
  await addCardUi(page, "Draft spec v2", "Review notes");
  await awaitSaved(page);
  await noHorizontalOverflow(page, "idle");
  const block = page.getByTestId("qr-transfer");
  await expect(block).toContainText(TRUST);
  const width = (await block.boundingBox())?.width ?? 0;
  expect(width).toBeGreaterThanOrEqual(760);

  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "ready");
  const scale = Number(await page.getByTestId("qr-canvas").getAttribute("data-qr-scale"));
  expect(scale, "SHOULD: data-qr-scale is 5 or more at 1280 x 800").toBeGreaterThanOrEqual(5);
  await noHorizontalOverflow(page, "show ready");

  // Tab order inside the block: Show, Hide, Scan.
  await qrBtn(page, "qr-show-btn").focus();
  await page.keyboard.press("Tab");
  await expect(qrBtn(page, "qr-hide-btn")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(qrBtn(page, "qr-scan-btn")).toBeFocused();

  await setCameraFrame(page, undefined);
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "scanning");
  await noHorizontalOverflow(page, "scanning");
  await press(page, qrBtn(page, "qr-scan-cancel"));
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await noHorizontalOverflow(page, "scanned");
  // Screenshots after the assertions, under the test output directory.
  await page.screenshot({ path: testInfo.outputPath("qr-1280x800.png"), fullPage: true });
  await p.context.close();
});

test("E2E-QR-08 (320 x 640): no overflow, the show panel gives way to a too-narrow message, scan states fit", async ({ browser }, testInfo) => {
  const p = await qrOnlineProfile(browser, "sprint-board", { width: 320, height: 640 });
  const page = p.page;
  await noHorizontalOverflow(page, "idle 320");
  await expect(page.getByTestId("qr-transfer")).toContainText(TRUST);
  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "too-narrow");
  await expect(page.getByTestId("qr-show-message")).toHaveText(
    "This screen is too narrow to show a code a phone can read. Use a wider screen, or use Export capsule (.gscap).",
  );
  await expect(page.getByTestId("qr-canvas")).toBeHidden();
  await noHorizontalOverflow(page, "too-narrow");
  await setCameraFrame(page, undefined);
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "scanning");
  await noHorizontalOverflow(page, "scanning 320");
  await press(page, qrBtn(page, "qr-scan-cancel"));
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await noHorizontalOverflow(page, "scanned 320");
  await page.screenshot({ path: testInfo.outputPath("qr-320x640.png"), fullPage: true });
  await p.context.close();
});
