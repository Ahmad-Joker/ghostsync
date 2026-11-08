/**
 * Stored record shape + SHA-256 checksum + the fixed read-validation order
 * (REQ-BP-002-5, REQ-BP-003-2a, REQ-BP-006-5, NFR-BP-006).
 *
 * Validation order on read (each failure a typed InvalidRecordError naming the
 * check; NEVER an auto-wipe/replace/delete):
 *   (1) SHAPE   — a plain object whose fields exist and have the right types,
 *                 validated BEFORE touching `bytes.length`;
 *   (2) SIZE    — reject `bytes.length > maxBytes` BEFORE hashing/decoding;
 *   (3) VERSION — `version === 1`; unknown/greater → reject (no auto-wipe);
 *   (4) IDENTITY— `app`/`documentId`/`replicaId`/`storageKey` match the open key;
 *   (5) CHECKSUM— recomputed SHA-256 over `bytes` equals `checksum`;
 *   (6) SEQUENCE— a non-negative safe integer.
 * The SEED check (createReplica) happens in the session after these pass.
 */
import { PersistenceError } from "./errors.js";

/** Record FORMAT version (independent of the IndexedDB database version). */
export const RECORD_VERSION = 1 as const;

/** Default pre-decode size cap: 8 MiB. */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** The persisted value shape (in-line keyPath `storageKey`). */
export interface StoredRecord {
  readonly storageKey: string;
  readonly version: typeof RECORD_VERSION;
  readonly app: string;
  readonly documentId: string;
  readonly replicaId: string;
  readonly bytes: Uint8Array;
  readonly sequence: number;
  readonly checksum: string;
  readonly savedAt: number;
}

/** Identity the stored record must match on read. */
export interface RecordIdentity {
  readonly storageKey: string;
  readonly app: string;
  readonly documentId: string;
  readonly replicaId: string;
}

/** A sequence is a stored generation: a non-negative SAFE integer. */
export function isValidSequence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

/**
 * SHA-256 over `bytes` as lowercase hex (REQ-BP-003-2a / NFR-BP-006). Awaited to
 * completion by the caller BEFORE any readwrite transaction opens. A checksum
 * detects corruption; it does NOT authenticate the sender.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `crypto.subtle.digest` wants an ArrayBuffer view; copy into a fresh buffer
  // so a shared/offset view never leaks neighbouring bytes into the digest.
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy);
  const view = new Uint8Array(digest);
  let hex = "";
  for (const b of view) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Shape guard: a plain object carrying every expected field with the right type. */
function hasRecordShape(value: unknown): value is StoredRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r["storageKey"] === "string" &&
    typeof r["version"] === "number" &&
    typeof r["app"] === "string" &&
    typeof r["documentId"] === "string" &&
    typeof r["replicaId"] === "string" &&
    r["bytes"] instanceof Uint8Array &&
    typeof r["sequence"] === "number" &&
    typeof r["checksum"] === "string" &&
    typeof r["savedAt"] === "number"
  );
}

/**
 * Validate a stored record in the fixed order and return the validated record.
 * The record's `bytes` are the untrusted seed the caller then hands to
 * createReplica. Throws InvalidRecordError naming the failing check; leaves the
 * stored record untouched (callers never delete/overwrite on failure).
 */
export async function validateRecord(
  raw: unknown,
  identity: RecordIdentity,
  maxBytes: number,
): Promise<StoredRecord> {
  // (1) SHAPE — before accessing bytes.length.
  if (!hasRecordShape(raw)) {
    throw new PersistenceError(
      "InvalidRecordError",
      "GhostSync Persist: stored record has an invalid shape",
    );
  }
  // (2) SIZE — bound BEFORE hashing/decoding.
  if (raw.bytes.length > maxBytes) {
    throw new PersistenceError(
      "InvalidRecordError",
      `GhostSync Persist: stored record exceeds maxBytes (${raw.bytes.length} > ${maxBytes})`,
    );
  }
  // (3) VERSION — unknown/greater version rejected (never auto-wipe).
  if (raw.version !== RECORD_VERSION) {
    throw new PersistenceError(
      "InvalidRecordError",
      `GhostSync Persist: unsupported record version ${String(raw.version)}`,
    );
  }
  // (4) IDENTITY.
  if (
    raw.storageKey !== identity.storageKey ||
    raw.app !== identity.app ||
    raw.documentId !== identity.documentId ||
    raw.replicaId !== identity.replicaId
  ) {
    throw new PersistenceError(
      "InvalidRecordError",
      "GhostSync Persist: stored record identity does not match the open key",
    );
  }
  // (5) CHECKSUM — recompute SHA-256 and compare.
  const recomputed = await sha256Hex(raw.bytes);
  if (recomputed !== raw.checksum) {
    throw new PersistenceError(
      "InvalidRecordError",
      "GhostSync Persist: stored record checksum mismatch (corruption detected)",
    );
  }
  // (6) SEQUENCE — non-negative safe integer.
  if (!isValidSequence(raw.sequence)) {
    throw new PersistenceError(
      "InvalidRecordError",
      "GhostSync Persist: stored record sequence is not a non-negative safe integer",
    );
  }
  return raw;
}

/** Build a stored record for a save (bytes + checksum are precomputed). */
export function buildRecord(
  identity: RecordIdentity,
  bytes: Uint8Array,
  sequence: number,
  checksum: string,
): StoredRecord {
  return {
    storageKey: identity.storageKey,
    version: RECORD_VERSION,
    app: identity.app,
    documentId: identity.documentId,
    replicaId: identity.replicaId,
    bytes,
    sequence,
    checksum,
    savedAt: Date.now(),
  };
}
