import { describe, expect, it } from "vitest";
import type { QrScanPanelState, QrShowPanelState } from "../src/transfer/qr/qr-errors.js";
import { TRANSFER_MODE_LABEL, transferMode } from "../src/transfer/qr/transfer-mode.js";

describe("U-QR-11 transfer mode", () => {
  it("labels", () => {
    expect(TRANSFER_MODE_LABEL.file).toBe("Transfer: file (.gscap)");
    expect(TRANSFER_MODE_LABEL["qr-scan"]).toBe("Transfer: QR scan (camera)");
    expect(TRANSFER_MODE_LABEL["qr-show"]).toBe("Transfer: QR show (screen)");
  });
  it.each<[QrScanPanelState, QrShowPanelState, string]>([
    ["idle", "idle", "file"],
    ["requesting", "idle", "qr-scan"],
    ["scanning", "idle", "qr-scan"],
    ["scanned", "idle", "qr-scan"],
    ["importing", "idle", "qr-scan"],
    ["imported", "idle", "file"],
    ["already-imported", "idle", "file"],
    ["rejected", "idle", "file"],
    ["denied", "idle", "file"],
    ["failed", "idle", "file"],
    ["idle", "ready", "qr-show"],
    ["idle", "too-large", "file"],
    ["idle", "too-narrow", "file"],
    ["scanning", "ready", "qr-scan"],
  ])("scan %s, show %s gives %s", (scan, show, mode) => {
    expect(transferMode(scan, show)).toBe(mode);
  });
});