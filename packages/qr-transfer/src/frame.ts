import { base45Encode, base45FillValidated, base45ValidatedLength } from "./base45.js";
import { QR_FRAME_PREFIX, QR_MAX_CAPSULE_BYTES, QR_MAX_FRAME_CHARS } from "./constants.js";
import { QrTransferError } from "./errors.js";

export function encodeFrame(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be a Uint8Array");
  if (bytes.length === 0) throw new QrTransferError("Empty", "there are no bytes to encode");
  if (bytes.length > QR_MAX_CAPSULE_BYTES) throw new QrTransferError("TooLarge", "the capsule is larger than a QR code can carry");
  return QR_FRAME_PREFIX + base45Encode(bytes);
}

/**
 * Internal seam: `allocate` is called exactly once, with the exact length, and only after every
 * check has passed. Tests count its calls.
 */
export function decodeFrameWith(text: string, allocate: (length: number) => Uint8Array): Uint8Array {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (text.length > QR_MAX_FRAME_CHARS) throw new QrTransferError("TooLarge", "the scanned text is longer than a frame can be");
  if (!text.startsWith(QR_FRAME_PREFIX)) {
    if (/^GSQ[0-9]:/.test(text)) throw new QrTransferError("UnsupportedVersion", "the frame version is not supported");
    if (text.startsWith("GSA1:")) throw new QrTransferError("AnimatedNotSupported", "multi-frame codes are not supported");
    throw new QrTransferError("NotGhostSync", "the text is not a GhostSync frame");
  }
  const body = text.slice(QR_FRAME_PREFIX.length);
  if (body.length === 0) throw new QrTransferError("InvalidLength", "the frame has no payload");
  const byteLength = base45ValidatedLength(body);
  if (byteLength < 1 || byteLength > QR_MAX_CAPSULE_BYTES) throw new QrTransferError("TooLarge", "the frame payload is out of bounds");
  const out = allocate(byteLength);
  base45FillValidated(body, out);
  return out;
}

export function decodeFrame(text: string): Uint8Array {
  return decodeFrameWith(text, (n) => new Uint8Array(n));
}
