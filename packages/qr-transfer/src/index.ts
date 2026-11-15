/**
 * GhostSync QR transfer, pure entry. Bytes are opaque: this package never parses a capsule.
 * A capsule checksum detects corruption; it does NOT authenticate the sender.
 */
export {
  QR_ECC_LEVEL,
  QR_FRAME_PREFIX,
  QR_FRAME_VERSION,
  QR_MAX_CAPSULE_BYTES,
  QR_MAX_FRAME_CHARS,
  QR_MAX_VERSION,
} from "./constants.js";
export { QrTransferError, isQrTransferError } from "./errors.js";
export type { QrTransferErrorCode } from "./errors.js";
export { decodeFrame, encodeFrame } from "./frame.js";
export { buildQrSymbol } from "./symbol.js";
export type { QrSymbol } from "./symbol.js";
