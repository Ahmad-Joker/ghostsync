import { statSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BASE, BOARD, btn, exportCapsule, importFile, importResult, join, loadUntilOfflineReady, newProfile, press, readUiBoard, saveSequence, storedState } from "./helpers.js";
import {
  addFakeCamera,
  cameraCalls,
  capsuleFrame,
  cspViolations,
  qrOnlineProfile,
  setCameraFrame,
  setCameraMode,
  trackStates,
  videoSource,
  type CameraMode,
} from "./camera.js";
import { SCAN_COPY } from "../src/transfer/qr/qr-errors.js";
import { expectScanState, modeEl, peerCapsule, qrBtn, scanFrame, showPanel, writeCapsule } from "./qr-fixtures.js";

const lastStreamStates = async (page: Page): Promise<string[]> => {
  const all = await trackStates(page);
  return all[all.length - 1] ?? [];
};

test("E2E-QR-02: camera failures end in a named state with a next step; file controls stay enabled and a real file import works", async ({ browser }, testInfo) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  const matrix: Array<[CameraMode, "denied" | "no-camera" | "in-use" | "insecure" | "failed" | "unsupported"]> = [
    ["NotAllowedError", "denied"],
    ["NotFoundError", "no-camera"],
    ["NotReadableError", "in-use"],
    ["SecurityError", "insecure"],
    ["OtherError", "failed"],
    ["none", "unsupported"],
  ];
  let calls = 0;
  for (const [mode, state] of matrix) {
    await setCameraMode(page, mode);
    await expect(qrBtn(page, "qr-scan-btn")).toBeEnabled();
    await press(page, qrBtn(page, "qr-scan-btn"));
    await expectScanState(page, state);
    await expect(page.getByTestId("qr-scan-message"), mode).toHaveText(SCAN_COPY[state]);
    await expect(page.getByTestId("qr-scan-message"), mode).toContainText("Import capsule file (.gscap)");
    if (mode !== "none") calls += 1;
    expect(await cameraCalls(page).catch(() => calls), mode).toBe(calls);
    // File controls are present and enabled in every state, and the mode returns to file.
    await expect(btn(page, "Export capsule (.gscap)"), mode).toBeEnabled();
    await expect(page.getByTestId("import-input"), mode).toBeEnabled();
    await expect(qrBtn(page, "qr-scan-btn"), mode).toBeEnabled();
    await expect(qrBtn(page, "qr-scan-btn"), mode).toBeFocused();
    await expect(modeEl(page), mode).toHaveAttribute("data-transfer-mode", "file");
    await expect(modeEl(page), mode).toHaveText("Transfer: file (.gscap)");
    await expect(page.getByTestId("qr-video"), mode).toBeHidden();
    // No camera was left running.
    expect((await trackStates(page).catch(() => [])).flat().every((s) => s === "ended")).toBe(true);
  }
  // After the failures, a real .gscap file import through the file input succeeds.
  const path = await writeCapsule(testInfo, "peer.gscap", await peerCapsule());
  await importFile(page, path);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(importResult(page)).toHaveAttribute("data-import-source", "file");
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "file");
  expect((await readUiBoard(page)).todo.map((c) => c.title)).toEqual(["Draft spec v1"]);
  await p.context.close();
});

test("E2E-QR-03: every cleanup trigger ends with ended tracks, an empty video source, the file mode and the right focus", async ({ browser }) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  const start = async (): Promise<void> => {
    await setCameraFrame(page, undefined);
    await press(page, qrBtn(page, "qr-scan-btn"));
    await expectScanState(page, "scanning");
    await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "qr-scan");
    expect(await lastStreamStates(page)).toEqual(["live"]);
    await expect(page.getByTestId("qr-video")).toBeVisible();
  };
  const ended = async (): Promise<void> => {
    await expect.poll(() => lastStreamStates(page)).toEqual(["ended"]);
    expect(await videoSource(page)).toBe("none");
    await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "file");
  };

  // Cancel: focus returns to the scan button.
  await start();
  await press(page, qrBtn(page, "qr-scan-cancel"));
  await expectScanState(page, "idle");
  await ended();
  await expect(qrBtn(page, "qr-scan-btn")).toBeFocused();

  // Escape cancels an active scan (SHOULD).
  await start();
  await qrBtn(page, "qr-scan-btn").focus();
  await page.keyboard.press("Escape");
  await expectScanState(page, "idle");
  await ended();

  // pagehide.
  await start();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expectScanState(page, "idle");
  await ended();

  // The page becomes hidden.
  await start();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectScanState(page, "idle");
  await ended();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  // Accepted code: tracks end at once, focus moves to Import, Discard returns focus to Scan.
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  expect(await lastStreamStates(page)).toEqual(["ended"]);
  expect(await videoSource(page)).toBe("none");
  await expect(page.getByTestId("qr-review-heading")).toBeFocused();
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "qr-scan");
  await press(page, qrBtn(page, "qr-discard-btn"));
  await expectScanState(page, "idle");
  await expect(qrBtn(page, "qr-scan-btn")).toBeFocused();
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "file");

  // Hide removes the drawn code and focuses Show.
  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "ready");
  await expect(page.getByTestId("qr-canvas")).toBeVisible();
  await press(page, qrBtn(page, "qr-hide-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "idle");
  await expect(page.getByTestId("qr-canvas")).toBeHidden();
  await expect(qrBtn(page, "qr-show-btn")).toBeFocused();
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "file");

  // Change board during a scan.
  await start();
  await press(page, page.getByTestId("change-board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  await ended();
  await p.context.close();
});

test("E2E-QR-07: offline startup and assets: no camera or decoder request before activation, scanning works offline, no CSP violation, nothing stored", async ({ browser }) => {
  const p = await newProfile(browser);
  await addFakeCamera(p.context);
  const page = p.page;
  const pageRequests: string[] = [];
  page.on("request", (r) => pageRequests.push(r.url()));
  await loadUntilOfflineReady(page);
  await join(page, BOARD);
  expect(pageRequests.some((u) => /jsqr-engine/.test(u)), "the first online load must not fetch the decoder chunk").toBe(false);
  expect(await cameraCalls(page)).toBe(0);
  // Offline from here on; reload from the worker.
  await p.context.setOffline(true);
  pageRequests.length = 0;
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.getByTestId("network-chip")).toHaveText("Network: offline");
  expect(pageRequests.some((u) => /jsqr-engine/.test(u)), "no decoder request before activation").toBe(false);
  expect(await cameraCalls(page)).toBe(0);
  const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort());
  const seq = await saveSequence(page);

  await scanFrame(page, capsuleFrame(await peerCapsule()));
  expect(await cameraCalls(page)).toBe(1);
  expect(pageRequests.some((u) => /jsqr-engine-.*\.js$/.test(u)), "the decoder chunk loads when a scan starts").toBe(true);
  for (const u of pageRequests) expect(new URL(u).origin, u).toBe(BASE);
  expect(await cspViolations(page)).toBe(0);
  expect(await saveSequence(page)).toBe(seq);
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(keysBefore);
  await expect(page.getByTestId("network-chip")).toHaveText("Network: offline");
  await p.context.close();
});

test("E2E-QR-11: a decoder chunk that cannot load ends in failed with the file fallback", async ({ browser }, testInfo) => {
  // No service worker: the route sees the page's own request for the lazy chunk.
  const context = await browser.newContext({ baseURL: BASE, serviceWorkers: "block" });
  await addFakeCamera(context);
  await context.route(/jsqr-engine-.*\.js$/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto("/");
  await join(page, BOARD);
  await setCameraFrame(page, capsuleFrame(await peerCapsule()));
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "failed");
  await expect(page.getByTestId("qr-scan-message")).toHaveText(SCAN_COPY.failed);
  expect(await lastStreamStates(page)).toEqual(["ended"]);
  expect(await videoSource(page)).toBe("none");
  const path = await writeCapsule(testInfo, "peer.gscap", await peerCapsule());
  await importFile(page, path);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  expect((await storedState(page)).cards).toHaveLength(1);
  await context.close();
});

test("E2E-QR-09: a capsule above 1232 bytes draws no code, names the size, and file export still works", async ({ browser }, testInfo) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  const { addCardUi, awaitSaved } = await import("./helpers.js");
  await addCardUi(page, "Draft spec v1", "n".repeat(2000));
  await awaitSaved(page);
  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "too-large");
  await expect(page.getByTestId("qr-canvas")).toBeHidden();
  const message = (await page.getByTestId("qr-show-message").textContent()) ?? "";
  const size = Number(/This capsule is (\d+) bytes\. A QR code holds at most 1232 bytes\. Use Export capsule \(\.gscap\) instead\./.exec(message)?.[1]);
  expect(size).toBeGreaterThan(1232);
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "file");
  // File export is enabled and carries exactly the bytes the QR path measured.
  await expect(btn(page, "Export capsule (.gscap)")).toBeEnabled();
  const file = await exportCapsule(page, testInfo, "big.gscap");
  expect(statSync(file).size).toBe(size);
  await p.context.close();
});
