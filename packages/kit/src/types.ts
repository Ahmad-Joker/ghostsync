/**
 * Public types for GhostSync Kit's core-sync-proof surface.
 *
 * This module is browser-compatible: it has no Node-only imports. Deep-equality
 * is a test concern, so no runtime equality helper is exported here.
 */

/** A scalar map value. Numbers must be finite (not NaN, not ±Infinity). */
export type Scalar = string | number | boolean | null;

/** Observable state: a plain snapshot of the top-level Y.Map. */
export type State = Record<string, Scalar>;

/** A raw Yjs update carried alongside a caller-supplied logical document ID. */
export interface UpdateCarrier {
  readonly documentId: string;
  readonly bytes: Uint8Array;
}

/** Distinguishable apply result — never thrown for recoverable cases. */
export type ApplyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "documentIdMismatch" }
  | { readonly ok: false; readonly reason: "invalidCarrier" };

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
  /** Full-state export: Y.encodeStateAsUpdate(doc) with no state vector. */
  exportState(): UpdateCarrier;
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
