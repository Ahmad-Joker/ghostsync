import { CapsuleError } from "./errors.js";
import { COVERED_OFFSET, SHA256_HEX_LENGTH } from "./format.js";

/** Minimal structural view of Web Crypto so `src` needs no DOM lib. */
interface SubtleLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

const HEX: readonly string[] = [..."0123456789abcdef"];
const ASCII_ZERO = 0x30;

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += (HEX[b >> 4] as string) + (HEX[b & 15] as string);
  }
  return out;
}

/**
 * SHA-256 as lowercase hex via `globalThis.crypto.subtle`. A missing or failing
 * digest is a missing platform capability: `CryptoUnavailable` with the
 * original error as `cause` (never Malformed / ChecksumMismatch).
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  try {
    const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
    if (subtle === undefined || typeof subtle.digest !== "function") {
      throw new Error("crypto.subtle.digest is not available");
    }
    const digest = await subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
  } catch (cause) {
    throw new CapsuleError("CryptoUnavailable", "SHA-256 is unavailable on this platform", cause);
  }
}

/**
 * Digest over the received bytes from offset 7 to the end, with ONLY the 64-byte
 * sha256 value span (located by the token scan, `hashOffset` = capsule offset of
 * its first byte) replaced by ASCII "0". `region` is always a fresh copy.
 */
export function coveredRegion(snap: Uint8Array, hashOffset: number): Uint8Array {
  const region = new Uint8Array(snap.length - COVERED_OFFSET);
  region.set(snap.subarray(COVERED_OFFSET));
  region.fill(ASCII_ZERO, hashOffset - COVERED_OFFSET, hashOffset - COVERED_OFFSET + SHA256_HEX_LENGTH);
  return region;
}

/** Constant-shape comparison of two equal-length hex strings. */
export function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
