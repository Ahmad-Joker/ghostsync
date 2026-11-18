/**
 * Version-1 container layout (all integers unsigned big-endian):
 *
 *   offset 0   6   magic "GSCAP\0"
 *   offset 6   1   formatVersion (uint8)
 *   offset 7   4   metaLength (uint32)
 *   offset 11  N   metadata (UTF-8 JSON)
 *   offset 11+N M  raw full-state update
 */
import { CapsuleError } from "./errors.js";

export const CAPSULE_FORMAT_VERSION = 1 as const;
export const CAPSULE_EXTENSION = ".gscap" as const;
export const CAPSULE_MEDIA_TYPE = "application/vnd.ghostsync.capsule" as const;
export const DEFAULT_MAX_CAPSULE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_UPDATE_BYTES = 8 * 1024 * 1024;

export const MAGIC_LENGTH = 6;
export const VERSION_OFFSET = 6;
/** Checksum coverage starts here (after magic + version byte). */
export const COVERED_OFFSET = 7;
export const HEADER_LENGTH = 11;
export const SHA256_HEX_LENGTH = 64;

const MAGIC = Uint8Array.of(0x47, 0x53, 0x43, 0x41, 0x50, 0x00);

/** Public copy of the magic bytes (the internal copy is never exported). */
export const CAPSULE_MAGIC: Uint8Array = MAGIC.slice();

export interface Header {
  readonly metaLength: number;
}

/**
 * Judge magic, version byte, and length framing of an owned snapshot.
 * Version byte: 1 supported, 0 Malformed, 2..255 UnsupportedVersion.
 */
export function readHeader(snap: Uint8Array): Header {
  if (snap.length < HEADER_LENGTH) {
    throw new CapsuleError("Malformed", "capsule is shorter than the fixed header");
  }
  for (let i = 0; i < MAGIC_LENGTH; i++) {
    if (snap[i] !== MAGIC[i]) {
      throw new CapsuleError("Malformed", "capsule magic bytes do not match");
    }
  }
  const version = snap[VERSION_OFFSET];
  if (version === 0) {
    throw new CapsuleError("Malformed", "capsule format version 0 is not a valid version");
  }
  if (version !== CAPSULE_FORMAT_VERSION) {
    throw new CapsuleError("UnsupportedVersion", "capsule format version is not supported");
  }
  const view = new DataView(snap.buffer, snap.byteOffset, snap.byteLength);
  const metaLength = view.getUint32(COVERED_OFFSET, false);
  if (HEADER_LENGTH + metaLength > snap.length) {
    throw new CapsuleError("Malformed", "capsule metadata length exceeds the capsule size");
  }
  return { metaLength };
}

export function writeHeader(out: Uint8Array, metaLength: number): void {
  out.set(MAGIC, 0);
  out[VERSION_OFFSET] = CAPSULE_FORMAT_VERSION;
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(COVERED_OFFSET, metaLength, false);
}
