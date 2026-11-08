/**
 * Public types for @ghostsync/persist. Re-exports the Kit's public value-shape
 * types a consumer needs to use the guarded session, plus the persistence
 * surface (open options, save state, the session, and the guarded collection).
 */
import type {
  ApplyOutcome,
  ChangeListener,
  Collection,
  EntityAdapter,
  ExportDiffResult,
  Fields,
  GetResult,
  Scalar,
  State,
  StateVector,
  TransportUpdate,
  Unsubscribe,
} from "@ghostsync/kit";

import type { PersistenceError } from "./errors.js";
import type { ReplicaIdentity, ResolvedIdentity } from "./identity.js";

export type {
  ApplyOutcome,
  ChangeListener,
  Collection,
  EntityAdapter,
  ExportDiffResult,
  Fields,
  GetResult,
  Scalar,
  State,
  StateVector,
  TransportUpdate,
  Unsubscribe,
};
export type { ReplicaIdentity, ResolvedIdentity } from "./identity.js";

/** The observable save state (REQ-BP-003). */
export type SaveState = "dirty" | "saving" | "saved" | "error";

/** Info delivered with every save-state transition. */
export interface SaveStateInfo {
  /** Last durably persisted generation (0 if nothing persisted yet). */
  readonly sequence: number;
  /** Present only when `state === "error"`. */
  readonly error?: PersistenceError;
}

/** Observer of save-state transitions. */
export type SaveStateListener = (state: SaveState, info: SaveStateInfo) => void;

/** Options for `openReplica`. */
export interface OpenOptions extends ReplicaIdentity {
  /** IndexedDB database name. Default: "ghostsync". */
  readonly dbName?: string;
  /** Reject/refuse a record whose bytes exceed this cap. Default: 8 MiB. */
  readonly maxBytes?: number;
  /** Optional initial save-state observer. */
  readonly onStateChange?: SaveStateListener;
}

/**
 * A guarded view over one entity type. It never exposes the raw Kit Collection:
 * reads pass through; `put`/`delete` mark the session dirty and are rejected
 * once the session is closing/closed/recovery-only (opening the collection
 * itself is a mutation because the Kit writes schema meta, so it is rejected in
 * those states too — enforced in `session.collection`).
 */
export interface GuardedCollection<T> {
  put(id: string, entity: T): void;
  get(id: string): T | undefined;
  getResult(id: string): GetResult<T>;
  list(): ReadonlyArray<readonly [string, T]>;
  listResults(): ReadonlyArray<readonly [string, GetResult<T>]>;
  delete(id: string): void;
  has(id: string): boolean;
}

/** The persistence session — the ONLY supported surface for a persisted replica. */
export interface PersistSession {
  readonly identity: ResolvedIdentity;
  readonly storageKey: string;
  readonly restored: boolean;
  readonly state: SaveState;

  // reads / exports (safe while open and in recovery-only; reject once closed)
  get(key: string): Scalar | undefined;
  has(key: string): boolean;
  getState(): State;
  collection<T>(adapter: EntityAdapter<T>): GuardedCollection<T>;
  exportState(): TransportUpdate;
  exportStateVector(): StateVector;
  exportDiff(remoteStateVector: unknown): ExportDiffResult;
  subscribe(listener: ChangeListener): Unsubscribe;

  // local edits (mark dirty, schedule a save)
  set(key: string, value: Scalar): void;
  delete(key: string): void;

  // the ONLY supported import path (persistence guarantee)
  applyUpdate(carrier: unknown): ApplyOutcome;

  // durability control
  flush(): Promise<void>;
  onStateChange(listener: SaveStateListener): Unsubscribe;
  close(): Promise<void>;
  dispose(): Promise<void>;

  /**
   * The current in-memory snapshot bytes. Always available while open AND in the
   * recovery-only state after a FAILED close(); only a successful close/dispose
   * makes this reject with ClosedError.
   */
  exportBytes(): Uint8Array;
}
