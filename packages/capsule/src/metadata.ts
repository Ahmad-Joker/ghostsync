import { CapsuleError } from "./errors.js";
import { CAPSULE_FORMAT_VERSION, SHA256_HEX_LENGTH } from "./format.js";
import { scanMetadata } from "./token-scan.js";

export interface CapsuleMetadata {
  readonly formatVersion: 1;
  readonly app: string;
  readonly documentId: string;
  readonly updateByteLength: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface ParsedMetadata {
  readonly metadata: CapsuleMetadata;
  /** Start of the 64 hex bytes (excluding quotes) within the metadata region. */
  readonly hashStart: number;
  /** Exclusive end of the 64 hex bytes within the metadata region. */
  readonly hashEnd: number;
}

const REQUIRED_KEYS = [
  "formatVersion",
  "app",
  "documentId",
  "updateByteLength",
  "sha256",
  "createdAt",
] as const;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function malformed(reason: string): CapsuleError {
  return new CapsuleError("Malformed", `capsule metadata is malformed: ${reason}`);
}

/** Strict canonical ISO-8601 UTC with millisecond precision. */
export function isCanonicalIsoUtc(value: string): boolean {
  if (!ISO_UTC.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Decode, token-scan and validate the metadata region of an owned snapshot.
 * The header version byte is already known to be 1 when this runs.
 */
export function parseMetadata(meta: Uint8Array): ParsedMetadata {
  const { text, members } = scanMetadata(meta);

  const sha = members.find((m) => m.name === "sha256");
  if (sha === undefined) throw malformed("missing sha256");
  // sha256 token: opening quote, 64 literal lowercase hex bytes, closing quote,
  // and therefore no backslash escape anywhere inside.
  if (sha.end - sha.start !== SHA256_HEX_LENGTH + 2 || meta[sha.start] !== 0x22 || meta[sha.end - 1] !== 0x22) {
    throw malformed("sha256 token must be a plain 64-character string");
  }
  for (let i = sha.start + 1; i < sha.end - 1; i++) {
    const b = meta[i] as number;
    const isHex = (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66);
    if (!isHex) throw malformed("sha256 must be 64 lowercase hex characters");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformed("not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw malformed("not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== REQUIRED_KEYS.length || !REQUIRED_KEYS.every((k) => keys.includes(k))) {
    throw malformed("unexpected or missing fields");
  }

  if (obj["formatVersion"] !== CAPSULE_FORMAT_VERSION) {
    // The header byte (1) and the metadata disagree: an inconsistent file.
    throw malformed("formatVersion disagrees with the header");
  }
  const app = obj["app"];
  const documentId = obj["documentId"];
  const updateByteLength = obj["updateByteLength"];
  const sha256 = obj["sha256"];
  const createdAt = obj["createdAt"];
  if (!isNonEmptyString(app)) throw malformed("app must be a non-empty string");
  if (!isNonEmptyString(documentId)) throw malformed("documentId must be a non-empty string");
  if (typeof updateByteLength !== "number" || !Number.isSafeInteger(updateByteLength) || updateByteLength < 0) {
    throw malformed("updateByteLength must be a non-negative safe integer");
  }
  if (typeof sha256 !== "string") throw malformed("sha256 must be a string");
  if (typeof createdAt !== "string" || !isCanonicalIsoUtc(createdAt)) {
    throw malformed("createdAt must be canonical ISO-8601 UTC");
  }

  return {
    metadata: {
      formatVersion: CAPSULE_FORMAT_VERSION,
      app,
      documentId,
      updateByteLength,
      sha256,
      createdAt,
    },
    hashStart: sha.start + 1,
    hashEnd: sha.end - 1,
  };
}
