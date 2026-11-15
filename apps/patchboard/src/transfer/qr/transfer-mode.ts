import type { QrScanPanelState, QrShowPanelState } from "./qr-errors.js";

export type TransferMode = "file" | "qr-scan" | "qr-show";

export const TRANSFER_MODE_LABEL: Readonly<Record<TransferMode, string>> = {
  file: "Transfer: file (.gscap)",
  "qr-scan": "Transfer: QR scan (camera)",
  "qr-show": "Transfer: QR show (screen)",
};

const SCAN_ACTIVE: ReadonlySet<QrScanPanelState> = new Set(["requesting", "scanning", "scanned", "importing"]);

/** A scan session, a held result or a QR import is `qr-scan`; a drawn code is `qr-show`; otherwise `file`. */
export function transferMode(scan: QrScanPanelState, show: QrShowPanelState): TransferMode {
  if (SCAN_ACTIVE.has(scan)) return "qr-scan";
  if (show === "ready") return "qr-show";
  return "file";
}
