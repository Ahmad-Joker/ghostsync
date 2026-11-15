import type { QrTransferErrorCode } from "@ghostsync/qr-transfer";

/** Scan panel states owned by the app (the package's ScanState plus the import states). */
export type QrScanPanelState =
  | "idle"
  | "requesting"
  | "scanning"
  | "scanned"
  | "rejected"
  | "importing"
  | "imported"
  | "already-imported"
  | "denied"
  | "no-camera"
  | "in-use"
  | "insecure"
  | "unsupported"
  | "failed"
  | "timed-out";

export type QrShowPanelState = "idle" | "ready" | "too-large" | "too-narrow" | "error";

/** Fixed copy per scan state. `rejected` uses the file flow's mapCapsuleError text instead. */
export const SCAN_COPY: Readonly<Record<Exclude<QrScanPanelState, "idle" | "rejected" | "importing" | "imported">, string>> = {
  requesting: "Waiting for camera permission. Choose Allow in the browser prompt.",
  scanning: "Point the camera at the QR code. Keep it steady and let it fill most of the preview.",
  scanned: "QR code read. Nothing has been applied yet. Check the details below, then import.",
  "already-imported": "This QR code was already imported in this session. Nothing was changed.",
  denied:
    "Camera access was blocked. Allow the camera for this site in the browser settings and try again, or use Import capsule file (.gscap) instead.",
  "no-camera": "No usable camera was found on this device. Use Import capsule file (.gscap) instead.",
  "in-use":
    "The camera could not be started. Close other apps that use the camera and try again, or use Import capsule file (.gscap) instead.",
  insecure:
    "The camera needs a secure page (HTTPS or localhost). Open the app from its secure address, or use Import capsule file (.gscap) instead.",
  unsupported: "This browser cannot use the camera for scanning. Use Import capsule file (.gscap) instead.",
  failed: "Scanning could not start or the camera stopped. Try again, or use Import capsule file (.gscap) instead.",
  "timed-out":
    "Scanning stopped after 2 minutes to turn the camera off. Select Scan QR code (camera) to try again, or use Import capsule file (.gscap).",
};

export const IMPORT_DID_NOT_RUN = "The import did not run. Scan the code again.";
export const IMPORTING_COPY = "Importing the scanned capsule...";
export const IMPORTED_COPY = "Import finished. The result is shown under the file transfer controls. Select Scan again to read another code.";
export const IMPORT_WAITING_COPY = "Another import is still running. Wait for it to finish, then select Import scanned capsule.";

const DAMAGED = "This code looks damaged or incomplete. Hold steady and keep scanning.";

export function hintCopy(code: QrTransferErrorCode): string {
  switch (code) {
    case "NotGhostSync":
      return "That is not a GhostSync QR code. Keep scanning or cancel.";
    case "UnsupportedVersion":
      return "This QR code uses a newer GhostSync format. Update PatchBoard, or use file transfer.";
    case "AnimatedNotSupported":
      return "This is a multi-frame code, which this version cannot read. Use file transfer.";
    case "TooLarge":
      return "This QR code is larger than the 1232-byte limit. Use file transfer.";
    case "InvalidLength":
    case "InvalidCharacter":
    case "OutOfRange":
    case "Empty":
      return DAMAGED;
  }
}

export function tooLargeCopy(bytes: number): string {
  return `This capsule is ${bytes} bytes. A QR code holds at most 1232 bytes. Use Export capsule (.gscap) instead.`;
}

export const TOO_NARROW_COPY = "This screen is too narrow to show a code a phone can read. Use a wider screen, or use Export capsule (.gscap).";
export const SHOW_ERROR_COPY = "The QR code could not be drawn. Use Export capsule (.gscap) instead.";
export const TRUST_NOTE =
  "A capsule checksum detects corruption. It does not authenticate the sender: anyone who can show a code can show a valid capsule.";
export const SHOW_TIP = "Raise the screen brightness and keep the code large and still.";
/** R4: the duplicate check covers QR imports only. */
export const DUPLICATE_SCOPE_NOTE =
  "Repeat detection covers QR imports in this session only. A capsule you imported from a file is not recognized here; importing it again changes nothing.";
