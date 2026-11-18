/**
 * Durable replica identity + collision-safe IndexedDB storage key (REQ-BP-001).
 *
 * The storage key is `esc(app) + SEP + esc(documentId) + SEP + esc(replicaId)`.
 * The `esc`/`SEP` NUL-introducer codec is COPIED (not imported) from the Kit's
 * module-private `keys.ts`: the Kit's `esc` is not exported, so copying is the
 * only option without a Kit change.
 *
 * OWNERSHIP (NIT-5): this codec is an INDEPENDENT persistence-package concern,
 * used ONLY for the IndexedDB keyPath. It is deliberately decoupled from the
 * Kit's records-map codec and never interoperates with Kit records-map keys. If
 * the Kit's escape ever changes, the two may diverge with NO correctness impact
 * (only the key string would differ); `storage-key.test.ts` pins the expected
 * strings so any drift is caught.
 */

/** Unit-Separator: the segment separator inside the storage key. */
export const SEP = "\u001f";
/** Start-of-Heading: a reserved byte escaped so it cannot forge a separator. */
const SENTINEL = "\u0001";
/** NUL: the escape introducer. */
const NUL = "\u0000";

/** Escape a single key segment so reserved bytes cannot forge another address. */
export function esc(segment: string): string {
  let out = "";
  for (const ch of segment) {
    if (ch === NUL) {
      out += NUL + NUL;
    } else if (ch === SENTINEL) {
      out += NUL + SENTINEL;
    } else if (ch === SEP) {
      out += NUL + SEP;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Durable identity + app namespace for one persisted replica. */
export interface ReplicaIdentity {
  /** Application namespace, e.g. "fieldledger" | "patchboard". */
  readonly app: string;
  /** Logical document id (the same value passed to the Kit). */
  readonly documentId: string;
  /**
   * Stable LOCAL replica identity. Distinct from the Yjs session clientID
   * (which changes per Y.Doc). If omitted, generated via crypto.randomUUID()
   * and returned on the ready session so the caller can persist + reuse it.
   */
  readonly replicaId?: string;
}

/** Fully-resolved identity (replicaId present). */
export interface ResolvedIdentity {
  readonly app: string;
  readonly documentId: string;
  readonly replicaId: string;
}

/**
 * Compute the collision-safe storage key for a resolved identity triple. No two
 * distinct `(app, documentId, replicaId)` triples can collide into one key.
 */
export function storageKey(app: string, documentId: string, replicaId: string): string {
  return esc(app) + SEP + esc(documentId) + SEP + esc(replicaId);
}

/**
 * Resolve the identity: validate `app`/`documentId`, and generate a durable
 * `replicaId` via `crypto.randomUUID()` when the caller omits one. A generated
 * id is NEVER derived from the Yjs clientID (REQ-BP-001-4).
 */
export function resolveIdentity(identity: ReplicaIdentity): ResolvedIdentity {
  const { app, documentId } = identity;
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("GhostSync Persist: app must be a non-empty string");
  }
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new TypeError("GhostSync Persist: documentId must be a non-empty string");
  }
  let replicaId = identity.replicaId;
  if (replicaId !== undefined) {
    if (typeof replicaId !== "string" || replicaId.length === 0) {
      throw new TypeError(
        "GhostSync Persist: replicaId must be a non-empty string when provided",
      );
    }
  } else {
    replicaId = crypto.randomUUID();
  }
  return { app, documentId, replicaId };
}

/**
 * The Web Lock name for a storage key. Unambiguously includes BOTH the dbName
 * and the storageKey (REQ-BP-005 clarification 3) so two sessions in different
 * databases but the same key never share a lock, and vice versa.
 */
export function lockName(dbName: string, key: string): string {
  return "ghostsync:lock:" + esc(dbName) + SEP + key;
}
