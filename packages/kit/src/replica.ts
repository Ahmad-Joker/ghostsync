import * as Y from "yjs";

import { type EntityAdapter } from "./adapter.js";
import { CollectionImpl, type Collection, type CollectionHost } from "./collection.js";
import { RECORDS_MAP } from "./keys.js";
import { assertScalar } from "./scalars.js";
import { project } from "./state.js";
import type {
  ApplyOutcome,
  ChangeEvent,
  ChangeListener,
  ExportDiffResult,
  Kit,
  Replica,
  Scalar,
  State,
  StateVector,
  TransportUpdate,
  Unsubscribe,
  UpdateCarrier,
} from "./types.js";

/** Name of the legacy top-level scalar map (baseline, unchanged). */
const ROOT_MAP = "root";

/** Module-private transaction origins (REQ-SDK-005). */
const LOCAL_ORIGIN: unique symbol = Symbol("ghostsync:local");
const REMOTE_ORIGIN: unique symbol = Symbol("ghostsync:remote");

function assertNonEmptyDocumentId(documentId: unknown): asserts documentId is string {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new TypeError("GhostSync Kit: documentId must be a non-empty string");
  }
}

/**
 * Carrier-shape check for the `applyUpdate` boundary. Proves a non-null object,
 * non-empty string `documentId`, `Uint8Array` `bytes`, and nonzero length
 * before any bytes are decoded. Zero-length bytes are rejected: an empty-doc
 * full-state export is non-empty Yjs bytes and still passes.
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

/** Whether a carrier's `kind` is an applicable update kind (gate before decode). */
function hasApplicableKind(carrier: unknown): boolean {
  const kind = (carrier as { kind?: unknown }).kind;
  return kind === undefined || kind === "full" || kind === "diff";
}

/** State-vector carrier shape check for `exportDiff`. */
function isStateVectorCarrier(value: unknown): value is StateVector {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { documentId?: unknown; kind?: unknown; bytes?: unknown };
  return (
    typeof candidate.documentId === "string" &&
    candidate.documentId.length > 0 &&
    candidate.kind === "stateVector" &&
    candidate.bytes instanceof Uint8Array
  );
}

/**
 * Whether a transaction's combined key delta across BOTH top-level maps is
 * non-empty (defect-C correction). Derived from `transaction.changed.get(map)`
 * — a `Set<string|null>` of changed keys (undefined/empty = no change there) —
 * never from the fact that `afterTransaction` fired.
 */
function hasObservableChange(doc: Y.Doc, tx: Y.Transaction): boolean {
  // `transaction.changed` is keyed by the abstract shared type; a Y.Map is a
  // valid key but TS generic variance needs the widened key type.
  const changed = tx.changed as Map<Y.AbstractType<unknown>, Set<string | null>>;
  const rootDelta = changed.get(doc.getMap(ROOT_MAP) as unknown as Y.AbstractType<unknown>);
  if (rootDelta !== undefined && rootDelta.size > 0) {
    return true;
  }
  const recDelta = changed.get(doc.getMap(RECORDS_MAP) as unknown as Y.AbstractType<unknown>);
  return recDelta !== undefined && recDelta.size > 0;
}

class ReplicaImpl implements Replica {
  readonly documentId: string;
  #doc: Y.Doc | undefined;
  readonly #listeners = new Set<ChangeListener>();
  #observer: ((tx: Y.Transaction) => void) | undefined;

  constructor(documentId: string, seedBytes?: Uint8Array) {
    assertNonEmptyDocumentId(documentId);
    if (seedBytes !== undefined && !(seedBytes instanceof Uint8Array)) {
      throw new TypeError("GhostSync Kit: seedBytes must be a Uint8Array when provided");
    }
    this.documentId = documentId;
    // Fresh Y.Doc => fresh session clientID (never copied across docs).
    const doc = new Y.Doc();
    if (seedBytes !== undefined) {
      Y.applyUpdate(doc, seedBytes);
    }
    this.#doc = doc;
    this.#attachObserver(doc);
  }

  /** Attach the single afterTransaction observer to a committed doc. */
  #attachObserver(doc: Y.Doc): void {
    // Materialize both top-level maps so their key deltas appear in
    // `tx.changed` for every transaction observed on this doc.
    doc.getMap(ROOT_MAP);
    doc.getMap(RECORDS_MAP);
    const observer = (tx: Y.Transaction): void => {
      if (!hasObservableChange(doc, tx)) {
        return; // no-op (empty combined key delta) notifies zero subscribers
      }
      const origin: ChangeEvent["origin"] = tx.origin === REMOTE_ORIGIN ? "remote" : "local";
      const event: ChangeEvent = { documentId: this.documentId, origin };
      // Snapshot listeners so a listener that (un)subscribes mid-dispatch does
      // not disturb this pass; isolate each dispatch so one throw cannot stop
      // others or change the triggering write/apply outcome (AC-SDK-005-7).
      for (const listener of [...this.#listeners]) {
        try {
          listener(event);
        } catch {
          // swallowed: a listener error is never a malformedUpdate and never
          // propagates into the local write / applyUpdate caller.
        }
      }
    };
    doc.on("afterTransaction", observer);
    this.#observer = observer;
  }

  #assertAlive(): Y.Doc {
    if (this.#doc === undefined) {
      throw new Error("GhostSync Kit: replica has been destroyed");
    }
    return this.#doc;
  }

  #rootMap(): Y.Map<unknown> {
    return this.#assertAlive().getMap<unknown>(ROOT_MAP);
  }

  /** Local-origin transaction on the committed doc. */
  #transactLocal(fn: () => void): void {
    const doc = this.#assertAlive();
    doc.transact(fn, LOCAL_ORIGIN);
  }

  set(key: string, value: Scalar): void {
    assertScalar(value); // throws before mutating on a non-scalar
    this.#transactLocal(() => {
      this.#rootMap().set(key, value);
    });
  }

  delete(key: string): void {
    const map = this.#rootMap();
    if (!map.has(key)) {
      return; // no-op: no transaction, no notification
    }
    this.#transactLocal(() => {
      this.#rootMap().delete(key);
    });
  }

  get(key: string): Scalar | undefined {
    const map = this.#rootMap();
    return map.has(key) ? (map.get(key) as Scalar) : undefined;
  }

  has(key: string): boolean {
    return this.#rootMap().has(key);
  }

  exportState(): TransportUpdate {
    const doc = this.#assertAlive();
    return { documentId: this.documentId, kind: "full", bytes: Y.encodeStateAsUpdate(doc) };
  }

  exportStateVector(): StateVector {
    const doc = this.#assertAlive();
    return { documentId: this.documentId, kind: "stateVector", bytes: Y.encodeStateVector(doc) };
  }

  exportDiff(remoteStateVector: unknown): ExportDiffResult {
    const doc = this.#assertAlive();
    // The peer state vector is an untrusted transport carrier: validate the
    // shape, kind, and documentId, then that the SV bytes decode, with NO
    // mutation and NO notification on any failure (REQ-SDK-007-8).
    if (!isStateVectorCarrier(remoteStateVector)) {
      return { ok: false, reason: "invalidStateVector" };
    }
    if (remoteStateVector.documentId !== this.documentId) {
      return { ok: false, reason: "documentIdMismatch" };
    }
    let bytes: Uint8Array;
    try {
      bytes = Y.encodeStateAsUpdate(doc, remoteStateVector.bytes);
    } catch {
      return { ok: false, reason: "invalidStateVector" };
    }
    return { ok: true, update: { documentId: this.documentId, kind: "diff", bytes } };
  }

  collection<T>(adapter: EntityAdapter<T>): Collection<T> {
    this.#assertAlive();
    const host: CollectionHost = {
      recordsMap: () => this.#assertAlive().getMap<unknown>(RECORDS_MAP),
      transactLocal: (fn: () => void) => this.#transactLocal(fn),
    };
    const collection = new CollectionImpl<T>(host, adapter);
    collection.open(); // record/verify schema identity before returning
    return collection;
  }

  /**
   * Kind-gated, scratch-staged, snapshot-and-swap apply (REQ-SDK-007-3/4/5/6/7).
   */
  applyUpdate(carrier: unknown): ApplyOutcome {
    const doc = this.#assertAlive();

    // 1. shape
    if (!isValidCarrier(carrier)) {
      return { ok: false, reason: "invalidCarrier" };
    }
    // 2. kind gate — reject stateVector / unknown BEFORE decoding the bytes
    if (!hasApplicableKind(carrier)) {
      return { ok: false, reason: "invalidCarrier" };
    }
    // 3. document id
    if (carrier.documentId !== this.documentId) {
      return { ok: false, reason: "documentIdMismatch" };
    }

    // 4. Guarded live merge with snapshot-rollback (AC-SDK-007-5/6). The foreign
    //    bytes are untrusted and we must NOT assume Y.applyUpdate rolls back on
    //    throw. Strategy:
    //      - capture a committed pre-apply snapshot (serializes BOTH maps AND
    //        any pending out-of-order updates — clarification 2);
    //      - DETACH the live observer so a partially-mutated mid-throw state can
    //        never be dispatched to subscribers (the engine computes the delta
    //        itself via a one-shot observer);
    //      - apply directly to the live doc under try/catch;
    //      - on throw, REBUILD the live doc from the snapshot (restoring the
    //        committed projection, including pending updates) and return
    //        malformedUpdate with no notification;
    //      - on success, fire exactly one remote notification iff a key changed.
    //    Applying to the live doc (rather than a staging copy that is swapped
    //    in) keeps pending out-of-order updates and is markedly faster; the
    //    observer detach removes the only hazard of direct apply.
    const snapshot = Y.encodeStateAsUpdate(doc);
    if (this.#observer !== undefined) {
      doc.off("afterTransaction", this.#observer);
    }
    let changed = false;
    const probe = (tx: Y.Transaction): void => {
      if (hasObservableChange(doc, tx)) {
        changed = true;
      }
    };
    doc.on("afterTransaction", probe);
    try {
      Y.applyUpdate(doc, carrier.bytes, REMOTE_ORIGIN);
    } catch {
      doc.off("afterTransaction", probe);
      // Rebuild the committed doc from the pre-apply snapshot. The old (possibly
      // partially-mutated) doc is destroyed; subscribers never saw it because
      // the probe swallowed any mid-throw transaction and we re-attach below.
      doc.destroy();
      const rebuilt = new Y.Doc();
      Y.applyUpdate(rebuilt, snapshot);
      this.#doc = rebuilt;
      this.#attachObserver(rebuilt);
      return { ok: false, reason: "malformedUpdate" };
    }
    doc.off("afterTransaction", probe);
    // Re-attach the durable observer for subsequent local writes.
    if (this.#observer !== undefined) {
      doc.on("afterTransaction", this.#observer);
    }

    // Notify once iff the merge actually changed a key. Fire directly as a
    // remote event so a throwing listener cannot affect this ok:true outcome.
    if (changed) {
      const event: ChangeEvent = { documentId: this.documentId, origin: "remote" };
      for (const listener of [...this.#listeners]) {
        try {
          listener(event);
        } catch {
          // isolated: never turns a successful apply into a rejection
        }
      }
    }

    return { ok: true };
  }

  subscribe(listener: ChangeListener): Unsubscribe {
    this.#assertAlive();
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.#listeners.delete(listener);
    };
  }

  getState(): State {
    return project(this.#rootMap());
  }

  destroy(): void {
    if (this.#doc === undefined) {
      return; // idempotent
    }
    this.#listeners.clear();
    if (this.#observer !== undefined) {
      this.#doc.off("afterTransaction", this.#observer);
      this.#observer = undefined;
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
