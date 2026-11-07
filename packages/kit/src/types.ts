/**
 * Public types for GhostSync Kit's core-sync-proof surface.
 *
 * This module is browser-compatible: it has no Node-only imports. Deep-equality
 * is a test concern, so no runtime equality helper is exported here.
 */

import type { EntityAdapter } from "./adapter.js";
import type { Collection } from "./collection.js";

/** A scalar map value. Numbers must be finite (not NaN, not ±Infinity). */
export type Scalar = string | number | boolean | null;

/** Observable state: a plain snapshot of the top-level Y.Map. */
export type State = Record<string, Scalar>;

/** A raw Yjs update carried alongside a caller-supplied logical document ID. */
export interface UpdateCarrier {
  readonly documentId: string;
  readonly bytes: Uint8Array;
}

/**
 * Distinguishable apply result — never thrown for recoverable cases.
 *
 * NOTE (REQ-SDK-007-5, U7): the `"malformedUpdate"` reason is ADDITIVE for a
 * consumer that reads the `reason` field, but it is a potential MINOR breaking
 * change for an exhaustive consumer `switch (outcome.reason)` with no `default`
 * branch, which would need a new case to stay exhaustive under `strict`.
 */
export type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidCarrier" }
  | { readonly ok: false; readonly reason: "malformedUpdate" };

/** Opaque state-vector carrier for incremental sync (REQ-SDK-004-2). */
export interface StateVector {
  readonly documentId: string;
  readonly kind: "stateVector";
  readonly bytes: Uint8Array;
}

/** Transport-neutral update the future file/QR tiers consume (REQ-SDK-006). */
export interface TransportUpdate {
  readonly documentId: string;
  readonly kind: "full" | "diff";
  readonly bytes: Uint8Array;
}

/** Union a transport layer may move. Each is a plain serializable value. */
export type TransportEnvelope = TransportUpdate | StateVector;

/**
 * Result of `exportDiff` — a diff on success, or a distinguishable rejection of
 * a bad peer state-vector carrier (REQ-SDK-007-8).
 */
export type ExportDiffResult =
  | { readonly ok: true; readonly update: TransportUpdate }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidStateVector" };

/** Change-notification event (REQ-SDK-005). */
export interface ChangeEvent {
  readonly documentId: string;
  /** "local" for local writes, "remote" for applied updates. */
  readonly origin: "local" | "remote";
}

/** A change-notification listener. */
export type ChangeListener = (event: ChangeEvent) => void;

/** Unsubscribe handle returned by `subscribe`. */
export type Unsubscribe = () => void;

/** A handle to one independent in-memory replica. */
export interface Replica {
  /** The caller-supplied logical document ID this replica belongs to. */
  readonly documentId: string;
  /** Local edit: set a scalar value for a key. Throws TypeError on a non-scalar. */
  set(key: string, value: Scalar): void;
  /** Local edit: delete a key. No-op if the key is absent. */
  delete(key: string): void;
  /** Read a scalar value for a key, or undefined if absent. */
  get(key: string): Scalar | undefined;
  /** Whether the key exists in the map. */
  has(key: string): boolean;
  /**
   * Full-state export: Y.encodeStateAsUpdate(doc) with no state vector.
   * Narrowed from the baseline `UpdateCarrier` to `TransportUpdate`
   * (`kind: "full"`); `TransportUpdate` still structurally satisfies
   * `UpdateCarrier` consumers reading `documentId`/`bytes` (REQ-SDK-006-4).
   */
  exportState(): TransportUpdate;
  /** State vector for incremental sync (REQ-SDK-004-2). */
  exportStateVector(): StateVector;
  /**
   * Differential update vs a peer's state vector (REQ-SDK-004-1/3). The peer
   * carrier is untrusted (a future transport message): a bad carrier yields a
   * distinguishable rejection (REQ-SDK-007-8). A valid diff is always non-empty
   * Yjs bytes, even for a no-op. Never mutates the doc, never notifies.
   */
  exportDiff(remoteStateVector: unknown): ExportDiffResult;
  /** Typed structured view for one entity type (REQ-SDK-001/002). */
  collection<T>(adapter: EntityAdapter<T>): Collection<T>;
  /** Subscribe to local/remote OBSERVABLE changes; returns an unsubscribe fn (REQ-SDK-005). */
  subscribe(listener: ChangeListener): Unsubscribe;
  /**
   * Validate the carrier and document ID, then apply. Never throws for
   * recoverable cases. Accepts `unknown`: the carrier shape is checked
   * before any field is read or any bytes are decoded.
   */
  applyUpdate(carrier: unknown): ApplyOutcome;
  /** Fresh plain snapshot of the map (the observable state). */
  getState(): State;
  /** Release the underlying Y.Doc. Idempotent; the handle is unusable after this. */
  destroy(): void;
}

/** Factory for replicas. */
export interface Kit {
  /**
   * Create a fresh Y.Doc (fresh session clientID) for the given logical
   * document ID. If seedBytes is provided, apply them as a full-state restore
   * before returning.
   */
  createReplica(documentId: string, seedBytes?: Uint8Array): Replica;
}
