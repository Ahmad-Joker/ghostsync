import { decodeCapsule } from "@ghostsync/capsule";
import { expect, test } from "@playwright/test";
import {
  addCardUi,
  armAbort,
  awaitSaved,
  btn,
  importFile,
  importResult,
  press,
  readUiBoard,
  saveIndicator,
  saveSequence,
  storedState,
} from "./helpers.js";
import {
  cameraCalls,
  capsuleFrame,
  framePixels,
  holdNextCamera,
  qrOfflineProfile,
  qrOnlineProfile,
  releaseHeldCamera,
  setCameraFrame,
  trackStates,
  videoAttachedTo,
  videoSource,
} from "./camera.js";
import { capsuleOfSize, expectScanState, flipUpdateByte, modeEl, peerCapsule, qrBtn, scanFrame, scanPanel, showPanel, writeCapsule } from "./qr-fixtures.js";

const hex12 = (s: string): string => s.slice(0, 12);

test("E2E-QR-01: two offline profiles, a real canvas to the other profile's fixture camera, preview, explicit import, offline reload", async ({ browser }) => {
  const a = await qrOfflineProfile(browser);
  const b = await qrOfflineProfile(browser);
  await addCardUi(a.page, "Draft spec v1", "Outline plus risks");
  await addCardUi(a.page, "Draft spec v2", "Review notes");
  await awaitSaved(a.page);

  await press(a.page, qrBtn(a.page, "qr-show-btn"));
  await expect(showPanel(a.page)).toHaveAttribute("data-qr-state", "ready");
  await expect(modeEl(a.page)).toHaveAttribute("data-transfer-mode", "qr-show");
  await expect(modeEl(a.page)).toHaveText("Transfer: QR show (screen)");
  const canvas = a.page.getByTestId("qr-canvas");
  const bytes = Number(await canvas.getAttribute("data-qr-bytes"));
  const version = Number(await canvas.getAttribute("data-qr-version"));
  const scale = Number(await canvas.getAttribute("data-qr-scale"));
  expect(bytes).toBeGreaterThan(600);
  expect(bytes).toBeLessThanOrEqual(1232);
  expect(version).toBeGreaterThanOrEqual(17);
  expect(version).toBeLessThanOrEqual(25);
  expect(scale).toBeGreaterThanOrEqual(5);
  await expect(canvas).toHaveAttribute("data-qr-modules", String(4 * version + 17));
  // The canvas is drawn at an integer scale with a 4-module quiet zone, black on white.
  const box = await canvas.evaluate((c) => ({ w: (c as HTMLCanvasElement).width, h: (c as HTMLCanvasElement).height }));
  expect(box.w).toBe((4 * version + 17 + 8) * scale);
  expect(box.h).toBe(box.w);
  const px = await canvas.evaluate((c, s) => {
    const ctx = (c as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D;
    const quiet = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    const finder = Array.from(ctx.getImageData(4 * s + 1, 4 * s + 1, 1, 1).data);
    return { quiet, finder };
  }, scale);
  expect(px.quiet).toEqual([255, 255, 255, 255]);
  expect(px.finder).toEqual([0, 0, 0, 255]);
  await expect(a.page.getByTestId("qr-show-bytes")).toHaveText(String(bytes));
  await expect(a.page.getByTestId("qr-show-version")).toHaveText(String(version));
  const shownChecksum = (await a.page.getByTestId("qr-show-checksum").textContent()) ?? "";
  expect(shownChecksum).toMatch(/^[0-9a-f]{12}$/);
  await expect(a.page.getByTestId("qr-transfer")).toContainText("does not authenticate the sender");

  const dataUrl = await canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL("image/png"));
  const beforeSeq = await saveSequence(b.page);
  await setCameraFrame(b.page, { kind: "image", dataUrl });
  expect(await cameraCalls(b.page)).toBe(0);
  await press(b.page, qrBtn(b.page, "qr-scan-btn"));
  await expectScanState(b.page, "scanned");
  await expect(b.page.getByTestId("network-chip")).toHaveText("Network: offline");
  await expect(modeEl(b.page)).toHaveAttribute("data-transfer-mode", "qr-scan");
  await expect(b.page.getByTestId("qr-preview-bytes")).toHaveText(String(bytes));
  await expect(b.page.getByTestId("qr-meta-checksum")).toHaveText(shownChecksum);
  await expect(b.page.getByTestId("qr-meta-app")).toHaveText("patchboard");
  await expect(b.page.getByTestId("qr-meta-document-id")).toHaveText("sprint-board");
  await expect(qrBtn(b.page, "qr-import-btn")).toBeFocused();
  expect(await trackStates(b.page)).toEqual([["ended"]]);
  expect(await videoSource(b.page)).toBe("none");
  // Nothing has been applied or stored by the scan.
  expect(await saveSequence(b.page)).toBe(beforeSeq);
  expect((await readUiBoard(b.page)).todo).toEqual([]);

  await press(b.page, qrBtn(b.page, "qr-import-btn"));
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(importResult(b.page)).toHaveAttribute("data-import-source", "qr");
  await expect.poll(async () => (await readUiBoard(b.page)).todo.map((c) => c.title).sort()).toEqual(["Draft spec v1", "Draft spec v2"]);
  const stored = await storedState(b.page);
  expect(stored.cards.flatMap(([, r]) => (r.ok ? [r.entity.title] : [])).sort()).toEqual(["Draft spec v1", "Draft spec v2"]);
  const aStored = await storedState(a.page);
  expect(stored.cards.map(([id]) => id).sort()).toEqual(aStored.cards.map(([id]) => id).sort());
  await b.page.reload();
  await expect(b.page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect.poll(async () => (await readUiBoard(b.page)).todo.map((c) => c.title).sort()).toEqual(["Draft spec v1", "Draft spec v2"]);
  await a.context.close();
  await b.context.close();
});

test("E2E-QR-04: explicit import: a scan writes nothing, the preview is built by decodeCapsule, the button applies", async ({ browser }) => {
  const p = await qrOnlineProfile(browser);
  const bytes = await peerCapsule({ cards: 1 });
  const meta = (await decodeCapsule(bytes)).metadata;
  const before = await storedState(p.page).catch(() => undefined);
  const seq = await saveSequence(p.page);
  await scanFrame(p.page, capsuleFrame(bytes));
  await expect(p.page.getByTestId("qr-meta-app")).toHaveText(meta.app);
  await expect(p.page.getByTestId("qr-meta-document-id")).toHaveText(meta.documentId);
  await expect(p.page.getByTestId("qr-meta-created-at")).toHaveText(meta.createdAt);
  await expect(p.page.getByTestId("qr-preview-bytes")).toHaveText(String(bytes.length));
  await expect(p.page.getByTestId("qr-meta-checksum")).toHaveText(hex12(meta.sha256));
  await expect(p.page.getByTestId("qr-scan-message")).toContainText("Nothing has been applied yet");
  await p.page.waitForTimeout(1000);
  expect(await saveSequence(p.page)).toBe(seq);
  expect(before === undefined ? undefined : (await storedState(p.page)).record.bytes).toEqual(before?.record.bytes);
  expect((await readUiBoard(p.page)).todo).toEqual([]);
  await expect(importResult(p.page)).not.toHaveAttribute("data-import-state", /.+/);
  await press(p.page, qrBtn(p.page, "qr-import-btn"));
  await expect(importResult(p.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect.poll(async () => (await readUiBoard(p.page)).todo.map((c) => c.title)).toEqual(["Draft spec v1"]);
  expect(await saveSequence(p.page)).toBeGreaterThan(seq);
  await p.context.close();
});

/** Hold the next SubtleCrypto.digest (the capsule checksum) so a QR import stays pending. */
async function holdNextDigest(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __releaseDigest: () => void };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    w.__releaseDigest = release;
    const original = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = async function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto["digest"]>): Promise<ArrayBuffer> {
      SubtleCrypto.prototype.digest = original;
      await gate;
      return original.apply(this, args);
    };
  });
}
const releaseDigest = (page: import("@playwright/test").Page): Promise<void> =>
  page.evaluate(() => (window as unknown as { __releaseDigest: () => void }).__releaseDigest());

test("E2E-QR-05: at most once: two clicks in one task, rescan, a held import disables Change board, Update now, scan and file input", async ({ browser }, testInfo) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  // A waiting worker makes the Update now button appear (same pattern as E2E-PB-20).
  expect((await page.request.post("/__test/sw-bump")).status()).toBe(204);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "waiting");
  const bytes = await peerCapsule({ cards: 1 });
  const frame = capsuleFrame(bytes);
  // A warm-up save first: the first save after a restored session advances Persist's sequence by its own step.
  await addCardUi(page, "Warm-up card");
  await awaitSaved(page);
  const seq0 = await saveSequence(page);

  // Part 1: two activations in ONE task (the deliberate pointer-click exception) start exactly one import.
  await scanFrame(page, frame);
  await qrBtn(page, "qr-import-btn").evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expectScanState(page, "imported");
  const seq1 = await saveSequence(page);
  // Two activations in one task are one import: exactly one save step.
  const delta = 1;
  expect(seq1).toBe(seq0 + delta);
  // Rescan of the same code: already-imported, no import button, nothing applied.
  await press(page, qrBtn(page, "qr-rescan-btn"));
  await expectScanState(page, "already-imported");
  await expect(qrBtn(page, "qr-import-btn")).toBeHidden();
  await expect(page.getByTestId("qr-scan-message")).toHaveText("This QR code was already imported in this session. Nothing was changed.");
  await page.waitForTimeout(500);
  expect(await saveSequence(page)).toBe(seq1);
  expect((await readUiBoard(page)).todo.map((c) => c.title).sort()).toEqual(["Draft spec v1", "Warm-up card"]);

  // Part 2: a pending QR import (held checksum digest) disables everything that must not run meanwhile.
  const other = await distinctCapsule("card-held", "Held import");
  await scanFrame(page, capsuleFrame(other));
  await holdNextDigest(page);
  const change = page.getByTestId("change-board");
  const update = page.getByTestId("update-banner").getByRole("button", { name: "Update now", exact: true });
  await expect(change).toBeEnabled();
  await expect(update).toBeEnabled();
  await press(page, qrBtn(page, "qr-import-btn"));
  await expectScanState(page, "importing");
  await expect(importResult(page)).toHaveAttribute("data-import-state", "importing");
  await expect(importResult(page)).toHaveAttribute("data-import-source", "qr");
  await expect(change).toBeDisabled();
  await expect(update).toBeDisabled();
  await expect(qrBtn(page, "qr-scan-btn")).toBeDisabled();
  await expect(page.getByTestId("import-input")).toBeDisabled();
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "qr-scan");
  // Forced activations do nothing: no camera request, no navigation, the session stays.
  const calls = await cameraCalls(page);
  await qrBtn(page, "qr-scan-btn").evaluate((el) => (el as HTMLButtonElement).click());
  await change.evaluate((el) => (el as HTMLButtonElement).click());
  await update.evaluate((el) => (el as HTMLButtonElement).click());
  expect(await cameraCalls(page)).toBe(calls);
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await releaseDigest(page);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(change).toBeEnabled();
  await expect(update).toBeEnabled();
  await expect(qrBtn(page, "qr-scan-btn")).toBeEnabled();
  await expect(page.getByTestId("import-input")).toBeEnabled();
  expect(await saveSequence(page)).toBe(seq1 + delta);
  // Rescan after the import settled: already-imported, sequence unchanged.
  await press(page, qrBtn(page, "qr-rescan-btn"));
  await expectScanState(page, "already-imported");
  await page.waitForTimeout(300);
  expect(await saveSequence(page)).toBe(seq1 + delta);
  expect((await readUiBoard(page)).todo.map((c) => c.title).sort()).toEqual(["Draft spec v1", "Held import", "Warm-up card"]);
  void testInfo;
  await p.context.close();
});

async function distinctCapsule(id: string, title: string): Promise<Uint8Array> {
  const { buildCapsule } = await import("./helpers.js");
  const { cardAdapter } = await import("../src/model/adapters.js");
  return buildCapsule("sprint-board", "patchboard", (r) => {
    r.collection(cardAdapter).put(id, { title, notes: "Outline plus risks", placement: "todo|00002048" });
  });
}

test("E2E-QR-05b: a pending FILE import disables QR scanning; a pending QR import blocks file import (both directions)", async ({ browser }, testInfo) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  const fileCapsule = await distinctCapsule("card-file", "From file");
  const path = await writeCapsule(testInfo, "file.gscap", fileCapsule);
  // Direction 1: hold the FILE read open.
  await page.evaluate(() => {
    const w = window as unknown as { __releaseRead: () => void };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    w.__releaseRead = release;
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function (this: Blob): Promise<ArrayBuffer> {
      await gate;
      return original.call(this);
    };
  });
  await setCameraFrame(page, capsuleFrame(await peerCapsule()));
  await importFile(page, path);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "importing");
  await expect(importResult(page)).toHaveAttribute("data-import-source", "file");
  await expect(qrBtn(page, "qr-scan-btn")).toBeDisabled();
  const calls = await cameraCalls(page);
  await qrBtn(page, "qr-scan-btn").evaluate((el) => (el as HTMLButtonElement).click());
  expect(await cameraCalls(page)).toBe(calls);
  await expectScanState(page, "idle");
  await page.evaluate(() => (window as unknown as { __releaseRead: () => void }).__releaseRead());
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(qrBtn(page, "qr-scan-btn")).toBeEnabled();

  // Direction 2: hold a QR import open; the file input is disabled and a forced change is refused by the controller.
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await holdNextDigest(page);
  await press(page, qrBtn(page, "qr-import-btn"));
  await expect(importResult(page)).toHaveAttribute("data-import-source", "qr");
  await expect(importResult(page)).toHaveAttribute("data-import-state", "importing");
  await expect(page.getByTestId("import-input")).toBeDisabled();
  await releaseDigest(page);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(page.getByTestId("import-input")).toBeEnabled();
  await p.context.close();
});

test("E2E-QR-06: rejection matrix by scanning: non-terminal frames only hint; bad capsules reject; wrong app and board reject at import; the board never changes", async ({ browser }) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  await addCardUi(page, "Draft spec v0", "Outline plus risks");
  await awaitSaved(page);
  const before = await storedState(page);
  const seq = await saveSequence(page);
  const unchanged = async (): Promise<void> => {
    expect(await saveSequence(page)).toBe(seq);
    expect((await storedState(page)).record.bytes).toEqual(before.record.bytes);
    expect((await readUiBoard(page)).todo.map((c) => c.title)).toEqual(["Draft spec v0"]);
  };

  // Non-terminal frames: stay in scanning and show a hint naming the cause.
  await setCameraFrame(page, framePixels("HTTPS://EXAMPLE.INVALID/"));
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "scanning");
  const hints: Array<[string, string]> = [
    ["HTTPS://EXAMPLE.INVALID/", "That is not a GhostSync QR code. Keep scanning or cancel."],
    ["GSQ2:BB8", "This QR code uses a newer GhostSync format. Update PatchBoard, or use file transfer."],
    ["GSA1:BB8", "This is a multi-frame code, which this version cannot read. Use file transfer."],
    ["GSQ1:bb8", "This code looks damaged or incomplete. Hold steady and keep scanning."],
    ["GSQ1:BB8A", "This code looks damaged or incomplete. Hold steady and keep scanning."],
    ["GSQ1:GGW", "This code looks damaged or incomplete. Hold steady and keep scanning."],
  ];
  for (const [text, copy] of hints) {
    await setCameraFrame(page, framePixels(text));
    await expect(page.getByTestId("qr-scan-hint")).toHaveText(copy);
    await expectScanState(page, "scanning");
    // Clear the hint between frames by showing an unreadable (blank) frame, then wait out the 1 s rate limit.
    await setCameraFrame(page, undefined);
    await page.waitForTimeout(1100);
  }
  await unchanged();
  await press(page, qrBtn(page, "qr-scan-cancel"));
  await expectScanState(page, "idle");

  // Terminal capsule rejections at the preview.
  const good = await peerCapsule();
  const bad: Array<[string, Uint8Array, RegExp]> = [
    ["bad checksum", flipUpdateByte(good), /checksum does not match/],
    ["truncated", good.slice(0, good.length - 25), /not a valid PatchBoard capsule|damaged/],
    ["version 2", Uint8Array.from(good, (b, i) => (i === 6 ? 2 : b)), /newer or unknown capsule format version|not a valid PatchBoard capsule|damaged/],
  ];
  for (const [name, bytes, message] of bad) {
    await scanFrame(page, capsuleFrame(bytes), "rejected");
    await expect(page.getByTestId("qr-scan-message"), name).toHaveText(message);
    await expect(page.getByTestId("qr-scan-message"), name).toContainText("Nothing was changed.");
    await expect(qrBtn(page, "qr-import-btn"), name).toBeHidden();
    await unchanged();
  }

  // Wrong app and wrong board decode fine and are rejected by the import, with the mapped message.
  await scanFrame(page, capsuleFrame(await peerCapsule({ app: "fieldledger" })));
  await press(page, qrBtn(page, "qr-import-btn"));
  await expect(importResult(page)).toHaveAttribute("data-import-code", "AppIdentityMismatch");
  await expect(importResult(page)).toHaveAttribute("data-import-source", "qr");
  await expectScanState(page, "rejected");
  await unchanged();
  await scanFrame(page, capsuleFrame(await peerCapsule({ documentId: "other-board" })));
  await press(page, qrBtn(page, "qr-import-btn"));
  await expect(importResult(page)).toHaveAttribute("data-import-code", "DocumentIdentityMismatch");
  await expect(importResult(page)).toContainText("other-board");
  await unchanged();
  await p.context.close();
});

test("E2E-QR-10: a held scan is dropped when the session changes; the other board is untouched", async ({ browser }) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await expect(qrBtn(page, "qr-import-btn")).toBeVisible();
  await press(page, page.getByTestId("change-board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  await expect(modeEl(page)).toHaveAttribute("data-transfer-mode", "file");
  await page.getByLabel("Board ID").fill("other-board");
  await press(page, btn(page, "Open board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator("main")).toHaveAttribute("data-board-id", "other-board");
  await expectScanState(page, "idle");
  await expect(qrBtn(page, "qr-import-btn")).toBeHidden();
  await expect(page.getByTestId("qr-preview")).toBeHidden();
  expect((await readUiBoard(page)).todo).toEqual([]);
  expect(await trackStates(page)).toEqual([["ended"]]);
  await p.context.close();
});

test("E2E-QR-12: applied but not saved by QR: alert, rescan is already-imported, Retry save by keyboard", async ({ browser }) => {
  const p = await qrOfflineProfile(browser);
  const page = p.page;
  await addCardUi(page, "Draft spec v0", "Outline plus risks");
  await awaitSaved(page);
  // Flush and assert the setup write succeeded BEFORE arming the one-shot abort.
  const pre = await storedState(page);
  expect(pre.record.sequence).toBe(await saveSequence(page));
  const frame = capsuleFrame(await peerCapsule());
  await scanFrame(page, frame);
  await armAbort(page);
  await press(page, qrBtn(page, "qr-import-btn"));
  const result = importResult(page);
  await expect(result).toHaveAttribute("data-import-state", "applied-unsaved");
  await expect(result).toHaveAttribute("data-import-source", "qr");
  await expect(result).toHaveAttribute("data-import-code", "TransactionAbortError");
  const alert = page.locator('[data-testid="save-error-alert"]');
  await expect(alert).toHaveAttribute("data-save-error-kind", "import");
  await expect(alert).toContainText("Capsule applied, but NOT saved to this device");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "error");
  expect((await storedState(page)).record.bytes).toEqual(pre.record.bytes);
  // Rescan of the same code: already-imported, nothing applied a second time.
  await press(page, qrBtn(page, "qr-rescan-btn"));
  await expectScanState(page, "already-imported");
  await expect(qrBtn(page, "qr-import-btn")).toBeHidden();
  // Retry save by keyboard.
  await press(page, alert.getByRole("button", { name: "Retry save", exact: true }));
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect(result).toHaveAttribute("data-import-state", "applied-saved");
  await expect(alert).toHaveCount(0);
  expect((await storedState(page)).cards.flatMap(([, r]) => (r.ok ? [r.entity.title] : [])).sort()).toEqual(["Draft spec v0", "Draft spec v1"]);
  await p.context.close();
});

test("E2E-QR-14: Cancel then immediate re-Scan with the OLD camera request resolving late: the newer stream stays attached and live", async ({ browser }) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  const bytes = await peerCapsule();
  await setCameraFrame(page, undefined);
  await holdNextCamera(page);
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "requesting");
  expect(await cameraCalls(page)).toBe(1);
  await press(page, qrBtn(page, "qr-scan-cancel"));
  await expectScanState(page, "idle");
  // Immediate re-Scan: this request resolves at once and becomes stream 0.
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "scanning");
  expect(await cameraCalls(page)).toBe(2);
  expect(await trackStates(page)).toEqual([["live"]]);
  expect(await videoAttachedTo(page, 0)).toBe(true);
  // Now the OLD request resolves: its stream is created late as stream 1 and must be stopped, and only that one.
  await releaseHeldCamera(page);
  await expect.poll(() => trackStates(page)).toEqual([["live"], ["ended"]]);
  await expectScanState(page, "scanning");
  expect(await videoAttachedTo(page, 0)).toBe(true);
  expect(await videoAttachedTo(page, 1)).toBe(false);
  await expect(page.getByTestId("qr-video")).toBeVisible();
  // The new scan loop still delivers a result, and then closes only the new stream.
  await setCameraFrame(page, capsuleFrame(bytes));
  await expectScanState(page, "scanned");
  expect(await trackStates(page)).toEqual([["ended"], ["ended"]]);
  expect(await videoSource(page)).toBe("none");
  await p.context.close();
});

test("E2E-QR-15: a 1232-byte capsule scans through the video path at version 25 and imports; interior and trailing spaces survive the scan path", async ({ browser }) => {
  const p = await qrOnlineProfile(browser);
  const page = p.page;
  const bytes = await capsuleOfSize(1232);
  expect(bytes.length).toBe(1232);
  const frame = capsuleFrame(bytes);
  expect(frame.kind === "modules" ? frame.size : 0).toBe(117);
  await scanFrame(page, frame);
  await expect(page.getByTestId("qr-preview-bytes")).toHaveText("1232");
  await expect(page.getByTestId("qr-meta-checksum")).toHaveText(hex12((await decodeCapsule(bytes)).metadata.sha256));
  await press(page, qrBtn(page, "qr-import-btn"));
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(importResult(page)).toHaveAttribute("data-import-source", "qr");
  await expect.poll(async () => (await readUiBoard(page)).todo.map((c) => c.title)).toEqual(["Draft spec v1"]);

  // The frame GSQ1: 0 (byte 0x24) keeps its interior space through the video, canvas and decoder: it decodes to one byte, which is not a capsule.
  await scanFrame(page, framePixels("GSQ1: 0"), "rejected");
  await expect(page.getByTestId("qr-scan-message")).toContainText("not a valid PatchBoard capsule");
  // The synthetic trailing-space frame keeps its space too, and decodeFrame rejects it: a hint, still scanning.
  await setCameraFrame(page, framePixels("GSQ1: 0 "));
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, "scanning");
  await expect(page.getByTestId("qr-scan-hint")).toHaveText("This code looks damaged or incomplete. Hold steady and keep scanning.");
  await p.context.close();
});