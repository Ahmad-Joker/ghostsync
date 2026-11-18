import type { ApplyOutcome } from "@ghostsync/kit";

import { decodeCapsule, type DecodeCapsuleOptions, type DecodedCapsule } from "./decode.js";
import { CapsuleError } from "./errors.js";
import type {
  ImportExpectation,
  ImportResult,
  PersistImportResult,
  PersistLikeError,
  PersistTarget,
  ReplicaTarget,
} from "./types.js";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Apply the decoded (snapshot-derived) update through the target's own
 * applyUpdate. A throw means the target could not accept anything (e.g. a
 * closed session): TargetUnavailable, never reported as applied.
 */
function applyDecoded(
  applyUpdate: (carrier: unknown) => ApplyOutcome,
  decoded: DecodedCapsule,
): void {
  let outcome: unknown;
  try {
    outcome = applyUpdate({
      documentId: decoded.metadata.documentId,
      kind: "full",
      bytes: decoded.update,
    });
  } catch (cause) {
    throw new CapsuleError("TargetUnavailable", "the import target could not accept the update", cause);
  }
  const o = outcome as { ok?: unknown; reason?: unknown } | null;
  if (o === null || typeof o !== "object" || o.ok !== true) {
    const reason = o !== null && typeof o === "object" ? o.reason : undefined;
    throw new CapsuleError("SdkRejection", "the Kit rejected the update", { reason });
  }
}

function checkIdentity(decoded: DecodedCapsule, app: string, documentId: string): void {
  if (decoded.metadata.app !== app) {
    throw new CapsuleError("AppIdentityMismatch", "capsule app does not match the target app");
  }
  if (decoded.metadata.documentId !== documentId) {
    throw new CapsuleError("DocumentIdentityMismatch", "capsule document does not match the target document");
  }
}

/** Import into an in-memory replica. Resolves `{ applied: true }` only after a real apply. */
export async function importCapsuleInto(
  target: ReplicaTarget,
  bytes: Uint8Array,
  expected: ImportExpectation,
  opts?: DecodeCapsuleOptions,
): Promise<ImportResult> {
  if (
    target === null ||
    typeof target !== "object" ||
    !isNonEmptyString(target.documentId) ||
    typeof target.applyUpdate !== "function"
  ) {
    throw new TypeError("target must expose a documentId and applyUpdate");
  }
  if (expected === null || typeof expected !== "object" || !isNonEmptyString(expected.app)) {
    throw new TypeError("expected.app must be a non-empty string");
  }
  const documentId = target.documentId;
  const app = expected.app;
  // decodeCapsule snapshots `bytes` synchronously, before its first await.
  const decoded = await decodeCapsule(bytes, opts);
  checkIdentity(decoded, app, documentId);
  applyDecoded((carrier) => target.applyUpdate(carrier), decoded);
  return { applied: true, metadata: decoded.metadata };
}

function toPersistLike(err: unknown): PersistLikeError {
  if (err !== null && typeof err === "object") {
    const e = err as { name?: unknown; message?: unknown };
    if (typeof e.name === "string" && typeof e.message === "string") {
      return err as PersistLikeError;
    }
  }
  return new Error(String(err));
}

/**
 * Import into a persisted session. App and document identity both come from
 * `target.identity`. Resolves only after a successful apply; a failed flush is
 * `persisted: false` with the real error, not a rejection.
 */
export async function importCapsuleIntoPersisted(
  target: PersistTarget,
  bytes: Uint8Array,
  opts?: DecodeCapsuleOptions,
): Promise<PersistImportResult> {
  if (
    target === null ||
    typeof target !== "object" ||
    target.identity === null ||
    typeof target.identity !== "object" ||
    !isNonEmptyString(target.identity.app) ||
    !isNonEmptyString(target.identity.documentId) ||
    typeof target.applyUpdate !== "function" ||
    typeof target.flush !== "function"
  ) {
    throw new TypeError("target must expose identity.app, identity.documentId, applyUpdate and flush");
  }
  const { app, documentId } = target.identity;
  const decoded = await decodeCapsule(bytes, opts);
  checkIdentity(decoded, app, documentId);
  applyDecoded((carrier) => target.applyUpdate(carrier), decoded);

  // Only after a successful apply is flush attempted.
  try {
    await target.flush();
  } catch (err) {
    return { applied: true, persisted: false, metadata: decoded.metadata, saveError: toPersistLike(err) };
  }
  return { applied: true, persisted: true, metadata: decoded.metadata };
}
