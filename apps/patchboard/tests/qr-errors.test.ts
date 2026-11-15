import { describe, expect, it } from "vitest";
import type { QrTransferErrorCode } from "@ghostsync/qr-transfer";
import {
  DUPLICATE_SCOPE_NOTE,
  IMPORT_DID_NOT_RUN,
  SCAN_COPY,
  SHOW_ERROR_COPY,
  TOO_NARROW_COPY,
  TRUST_NOTE,
  hintCopy,
  tooLargeCopy,
} from "../src/transfer/qr/qr-errors.js";

const CAMERA = ["denied", "no-camera", "in-use", "insecure", "unsupported", "failed", "timed-out"] as const;

describe("U-QR-12 copy", () => {
  it("every camera failure message names the problem and the file fallback", () => {
    for (const k of CAMERA) {
      expect(SCAN_COPY[k].length, k).toBeGreaterThan(30);
      expect(SCAN_COPY[k], k).toContain("Import capsule file (.gscap)");
    }
  });
  it("exact strings", () => {
    expect(SCAN_COPY.requesting).toBe("Waiting for camera permission. Choose Allow in the browser prompt.");
    expect(SCAN_COPY.scanned).toBe("QR code read. Nothing has been applied yet. Check the details below, then import.");
    expect(SCAN_COPY["already-imported"]).toBe("This QR code was already imported in this session. Nothing was changed.");
    expect(IMPORT_DID_NOT_RUN).toBe("The import did not run. Scan the code again.");
    expect(TRUST_NOTE).toBe(
      "A capsule checksum detects corruption. It does not authenticate the sender: anyone who can show a code can show a valid capsule.",
    );
  });
  it("show messages give a next step that names file export", () => {
    expect(tooLargeCopy(1500)).toBe("This capsule is 1500 bytes. A QR code holds at most 1232 bytes. Use Export capsule (.gscap) instead.");
    expect(TOO_NARROW_COPY).toContain("Export capsule (.gscap)");
    expect(SHOW_ERROR_COPY).toContain("Export capsule (.gscap)");
  });
  it("every hint has text, and the size and format hints mention file transfer", () => {
    const codes: QrTransferErrorCode[] = ["TooLarge", "Empty", "NotGhostSync", "UnsupportedVersion", "AnimatedNotSupported", "InvalidLength", "InvalidCharacter", "OutOfRange"];
    for (const c of codes) expect(hintCopy(c).length, c).toBeGreaterThan(20);
    for (const c of ["TooLarge", "AnimatedNotSupported", "UnsupportedVersion"] as const) expect(hintCopy(c), c).toContain("file transfer");
  });
  it("the duplicate scope note says QR only and that file imports are not recognized", () => {
    expect(DUPLICATE_SCOPE_NOTE).toContain("QR imports in this session only");
    expect(DUPLICATE_SCOPE_NOTE).toContain("imported from a file is not recognized");
  });
});