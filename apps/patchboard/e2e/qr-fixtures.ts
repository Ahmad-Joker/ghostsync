import { writeFileSync } from "node:fs";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { encodeFrame } from "@ghostsync/qr-transfer";
import { cardAdapter } from "../src/model/adapters.js";
import { BOARD, buildCapsule, importFile, press, saveSequence } from "./helpers.js";
import { framePixels, setCameraFrame, type FrameSource } from "./camera.js";

/** Synthetic fixtures only: board `sprint-board`, titles like "Draft spec v1", notes like "Outline plus risks". */
export const peerCapsule = (opts: { app?: string; documentId?: string; cards?: number; notes?: string } = {}): Promise<Uint8Array> =>
  buildCapsule(opts.documentId ?? BOARD, opts.app ?? "patchboard", (r) => {
    const cards = r.collection(cardAdapter);
    const n = opts.cards ?? 1;
    for (let i = 0; i < n; i += 1) {
      cards.put(`card-peer-${i}`, { title: `Draft spec v${i + 1}`, notes: opts.notes ?? "Outline plus risks", placement: `todo|0000${1024 + i}` });
    }
  });

export const framePixelsOf = (bytes: Uint8Array): FrameSource => framePixels(encodeFrame(bytes));

/** A valid capsule of EXACTLY `target` bytes, padded only through the card notes (public API). */
export async function capsuleOfSize(target: number): Promise<Uint8Array> {
  let notes = Math.max(0, target - 330);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const bytes = await peerCapsule({ cards: 1, notes: "n".repeat(notes) });
    if (bytes.length === target) return bytes;
    notes = Math.max(0, notes + (target - bytes.length));
  }
  throw new Error(`no capsule of exactly ${target} bytes was reached`);
}

export function flipUpdateByte(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  out[out.length - 5] = (out[out.length - 5] as number) ^ 0xff;
  return out;
}

export const scanPanel = (page: Page): Locator => page.getByTestId("qr-scan-panel");
export const showPanel = (page: Page): Locator => page.getByTestId("qr-show-panel");
export const modeEl = (page: Page): Locator => page.getByTestId("transfer-mode");
export const qrBtn = (page: Page, id: "qr-show-btn" | "qr-hide-btn" | "qr-scan-btn" | "qr-scan-cancel" | "qr-import-btn" | "qr-discard-btn" | "qr-rescan-btn"): Locator =>
  page.getByTestId(id);

export async function expectScanState(page: Page, state: string): Promise<void> {
  await expect(scanPanel(page)).toHaveAttribute("data-qr-state", state);
}

/** Start a scan by keyboard with `frame` showing, wait for the preview. */
export async function scanFrame(page: Page, frame: FrameSource, expected = "scanned"): Promise<void> {
  await setCameraFrame(page, frame);
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectScanState(page, expected);
}

export async function writeCapsule(testInfo: TestInfo, name: string, bytes: Uint8Array): Promise<string> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, bytes);
  return path;
}

export { importFile, saveSequence, BOARD };
