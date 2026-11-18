import { assertPlainBytes, snapshot } from "./bytes.js";
import { coveredRegion, hexEqual, sha256Hex } from "./checksum.js";
import { CapsuleError } from "./errors.js";
import {
  DEFAULT_MAX_CAPSULE_BYTES,
  DEFAULT_MAX_UPDATE_BYTES,
  HEADER_LENGTH,
  readHeader,
} from "./format.js";
import { parseMetadata, type CapsuleMetadata } from "./metadata.js";

export interface DecodedCapsule {
  readonly metadata: CapsuleMetadata;
  /** Caller-owned copy of the update region (own ArrayBuffer). */
  readonly update: Uint8Array;
}

export interface DecodeCapsuleOptions {
  readonly maxCapsuleBytes?: number;
  readonly maxUpdateBytes?: number;
}

interface Limits {
  readonly maxCapsuleBytes: number;
  readonly maxUpdateBytes: number;
}

function limit(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

export function resolveLimits(opts: unknown): Limits {
  if (opts !== undefined && (opts === null || typeof opts !== "object")) {
    throw new TypeError("opts must be an object");
  }
  const o = (opts ?? {}) as Record<string, unknown>;
  return {
    maxCapsuleBytes: limit(o["maxCapsuleBytes"], DEFAULT_MAX_CAPSULE_BYTES, "maxCapsuleBytes"),
    maxUpdateBytes: limit(o["maxUpdateBytes"], DEFAULT_MAX_UPDATE_BYTES, "maxUpdateBytes"),
  };
}

/**
 * Validate a capsule and return its decoded parts. Applies nothing.
 *
 * Order: argument types -> raw size -> (owned snapshot, before the first await)
 * -> magic + version -> framing -> metadata scan/fields -> decoded size ->
 * checksum. Everything after the snapshot reads only the snapshot.
 */
export async function decodeCapsule(
  bytes: Uint8Array,
  opts?: DecodeCapsuleOptions,
): Promise<DecodedCapsule> {
  assertPlainBytes(bytes, "bytes");
  const limits = resolveLimits(opts);
  if (bytes.length > limits.maxCapsuleBytes) {
    throw new CapsuleError("OversizedRaw", "capsule exceeds the maximum raw size");
  }
  const snap = snapshot(bytes);
  return verifySnapshot(snap, limits);
}

async function verifySnapshot(snap: Uint8Array, limits: Limits): Promise<DecodedCapsule> {
  const { metaLength } = readHeader(snap);
  const updateStart = HEADER_LENGTH + metaLength;
  const updateLength = snap.length - updateStart;

  const parsed = parseMetadata(snap.subarray(HEADER_LENGTH, updateStart));
  if (parsed.metadata.updateByteLength !== updateLength) {
    throw new CapsuleError("Malformed", "updateByteLength does not match the update region");
  }
  if (updateLength > limits.maxUpdateBytes) {
    throw new CapsuleError("OversizedDecoded", "capsule update exceeds the maximum decoded size");
  }

  const hashOffset = HEADER_LENGTH + parsed.hashStart;
  // The span is 64 validated ASCII hex bytes taken from the received bytes.
  const claimed = new TextDecoder().decode(snap.subarray(hashOffset, HEADER_LENGTH + parsed.hashEnd));
  const actual = await sha256Hex(coveredRegion(snap, hashOffset));
  if (!hexEqual(actual, claimed)) {
    throw new CapsuleError("ChecksumMismatch", "capsule checksum does not match its contents");
  }

  return {
    metadata: { ...parsed.metadata },
    update: snapshot(snap.subarray(updateStart)),
  };
}
