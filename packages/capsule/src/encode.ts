import type { TransportUpdate } from "@ghostsync/kit";

import { assertPlainBytes, snapshot } from "./bytes.js";
import { coveredRegion, sha256Hex } from "./checksum.js";
import { CAPSULE_FORMAT_VERSION, HEADER_LENGTH, SHA256_HEX_LENGTH, writeHeader } from "./format.js";
import { isCanonicalIsoUtc } from "./metadata.js";
import { scanMetadata } from "./token-scan.js";

export interface EncodeCapsuleInput {
  readonly app: string;
  /**
   * A FULL-STATE update: `Replica.exportState()` (preferred, so the document id
   * is cross-checked) or its raw `bytes`. A raw `Uint8Array` carries no
   * checkable identity; `documentId` is then the caller's responsibility.
   */
  readonly update: Uint8Array | TransportUpdate;
  readonly documentId: string;
  readonly createdAt?: string;
}

function isTransportUpdate(v: unknown): v is TransportUpdate {
  if (v === null || typeof v !== "object" || v instanceof Uint8Array) return false;
  const o = v as Record<string, unknown>;
  return typeof o["documentId"] === "string" && typeof o["kind"] === "string" && o["bytes"] instanceof Uint8Array;
}

/**
 * Encode a full-state update into a version-1 capsule.
 *
 * Programmer errors reject with TypeError (before any hashing). The only
 * CapsuleError is "CryptoUnavailable". All inputs are copied/captured before
 * the first await; the caller's buffers are never read again.
 */
export async function encodeCapsule(input: EncodeCapsuleInput): Promise<Uint8Array> {
  if (input === null || typeof input !== "object") {
    throw new TypeError("input must be an object");
  }
  const app: unknown = input.app;
  const documentId: unknown = input.documentId;
  if (typeof app !== "string" || app.length === 0) throw new TypeError("app must be a non-empty string");
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new TypeError("documentId must be a non-empty string");
  }
  const createdAtInput: unknown = input.createdAt;
  const createdAt = createdAtInput === undefined ? new Date().toISOString() : createdAtInput;
  if (typeof createdAt !== "string" || !isCanonicalIsoUtc(createdAt)) {
    throw new TypeError("createdAt must be canonical ISO-8601 UTC with milliseconds");
  }

  const updateInput: unknown = input.update;
  let source: Uint8Array;
  if (updateInput instanceof Uint8Array) {
    source = updateInput;
  } else if (isTransportUpdate(updateInput)) {
    if (updateInput.kind !== "full") {
      throw new TypeError("encodeCapsule requires a full-state update");
    }
    if (updateInput.documentId !== documentId) {
      throw new TypeError("update.documentId does not match input.documentId");
    }
    source = updateInput.bytes;
  } else {
    throw new TypeError("update must be a Uint8Array or a TransportUpdate");
  }
  assertPlainBytes(source, "update");
  if (source.length === 0) throw new TypeError("update must not be empty");

  // Owned snapshot: everything below reads only this copy.
  const update = snapshot(source);

  const placeholder = "0".repeat(SHA256_HEX_LENGTH);
  const metaText = JSON.stringify({
    formatVersion: CAPSULE_FORMAT_VERSION,
    app,
    documentId,
    updateByteLength: update.length,
    sha256: placeholder,
    createdAt,
  });
  const meta = new TextEncoder().encode(metaText);

  const out = new Uint8Array(HEADER_LENGTH + meta.length + update.length);
  writeHeader(out, meta.length);
  out.set(meta, HEADER_LENGTH);
  out.set(update, HEADER_LENGTH + meta.length);

  // Locate the placeholder with the same token scan the decoder uses.
  const sha = scanMetadata(meta).members.find((m) => m.name === "sha256");
  if (sha === undefined) throw new Error("internal error: sha256 member not found");
  const hashOffset = HEADER_LENGTH + sha.start + 1;

  const digest = await sha256Hex(coveredRegion(out, hashOffset));
  const digestBytes = new TextEncoder().encode(digest);
  out.set(digestBytes, hashOffset);
  return out;
}
