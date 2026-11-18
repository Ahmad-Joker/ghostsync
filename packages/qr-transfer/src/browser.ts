/** GhostSync QR transfer, browser entry: canvas paint and the camera scan session. */
export { chooseScale, paintQr } from "./browser/paint.js";
export { createScanSession, SCAN_MAX_EDGE_PX, SCAN_TIMEOUT_MS } from "./browser/scan-session.js";
export type { FrameDecoder, FrameImage, ScanCallbacks, ScanDeps, ScanSession, ScanState } from "./browser/scan-session.js";
