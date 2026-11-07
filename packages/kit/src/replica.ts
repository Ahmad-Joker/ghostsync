import * as Y from "yjs";

import { assertScalar } from "./scalars.js";
import { project } from "./state.js";
import type { ApplyOutcome, Kit, Replica, Scalar, State, UpdateCarrier } from "./types.js";

/** Name of the single top-level scalar map inside every replica's Y.Doc. */
const ROOT_MAP = "root";

function assertNonEmptyDocumentId(documentId: unknown): asserts documentId is string {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new TypeError(
      "GhostSync Kit: documentId must be a non-empty string",
    );
  }
}

/**
 * Carrier-shape check used by the public `applyUpdate` boundary (corrections 3
 * and 5). Accepts `unknown` and proves the shape — non-null object, non-empty
 * string `documentId`, `Uint8Array` `bytes`, and nonzero length — before any
 * field is read or any bytes are decoded.
 *
 * Zero-length bytes are rejected here: `new Uint8Array(0)` is NOT assumed to be
 * a valid Yjs no-op update. A full-state export of an empty Y.Doc is non-empty
 * Yjs bytes and still passes this check.
 */
function isValidCarrier(carrier: unknown): carrier is UpdateCarrier {
  if (typeof carrier !== "object" || carrier === null) {
    return false;
  }
  const candidate = carrier as { documentId?: unknown; bytes?: unknown };
  if (typeof candidate.documentId !== "string" || candidate.documentId.length === 0) {
    return false;
  }
  if (!(candidate.bytes instanceof Uint8Array)) {
    return false;
  }
  return candidate.bytes.length > 0;
}

class ReplicaImpl implements Replica {
  readonly documentId: string;
  #doc: Y.Doc | undefined;

  constructor(documentId: string, seedBytes?: Uint8Array) {
    assertNonEmptyDocumentId(documentId);
    if (seedBytes !== undefined && !(seedBytes instanceof Uint8Array)) {
      throw new TypeError(
        "GhostSync Kit: seedBytes must be a Uint8Array when provided",
      );
    }
    this.documentId = documentId;
    // Fresh Y.Doc => fresh session clientID. The logical documentId is stored
    // separately above and is never derived from Yjs internals.
    const doc = new Y.Doc();
    if (seedBytes !== undefined) {
      Y.applyUpdate(doc, seedBytes);
    }
    this.#doc = doc;
  }

  #assertAlive(): Y.Doc {
    if (this.#doc === undefined) {
      throw new Error("GhostSync Kit: replica has been destroyed");
    }
    return this.#doc;
  }

  #map(): Y.Map<unknown> {
    return this.#assertAlive().getMap<unknown>(ROOT_MAP);
  }

  set(key: string, value: Scalar): void {
    const map = this.#map();
    assertScalar(value); // throws before mutating on a non-scalar
    map.set(key, value);
  }

  delete(key: string): void {
    this.#map().delete(key);
  }

  get(key: string): Scalar | undefined {
    const map = this.#map();
    return map.has(key) ? (map.get(key) as Scalar) : undefined;
  }

  has(key: string): boolean {
    return this.#map().has(key);
  }

  exportState(): UpdateCarrier {
    const doc = this.#assertAlive();
    // Full-state export: no state vector argument (resolved decision 4).
    return { documentId: this.documentId, bytes: Y.encodeStateAsUpdate(doc) };
  }

  /**
   * Validate the carrier and document ID, then apply the raw Yjs bytes.
   *
   * Integrity-vs-authentication invariant (AC-006-3): raw Yjs update bytes do
   * NOT prove document identity and do NOT authenticate the sender. The
   * documentId check here is a minimal integrity/identity guard, not
   * authentication. Hostile-byte handling, payload size limits, capsule
   * versioning, and checksums are future work and are not implemented here.
   */
  applyUpdate(carrier: unknown): ApplyOutcome {
    const doc = this.#assertAlive();
    if (!isValidCarrier(carrier)) {
      return { ok: false, reason: "invalidCarrier" };
    }
    if (carrier.documentId !== this.documentId) {
      return { ok: false, reason: "documentIdMismatch" };
    }
    Y.applyUpdate(doc, carrier.bytes);
    return { ok: true };
  }

  getState(): State {
    return project(this.#map());
  }

  destroy(): void {
    if (this.#doc === undefined) {
      return; // idempotent: repeated destroy is a safe no-op
    }
    this.#doc.destroy();
    this.#doc = undefined;
  }
}

/** Create the GhostSync Kit replica factory. */
export function createKit(): Kit {
  return {
    createReplica(documentId: string, seedBytes?: Uint8Array): Replica {
      return new ReplicaImpl(documentId, seedBytes);
    },
  };
}
