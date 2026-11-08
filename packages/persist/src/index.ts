/**
 * @ghostsync/persist — public ESM entry.
 *
 * IndexedDB full-state persistence around a GhostSync Kit replica. Consumers do
 * `import { openReplica } from "@ghostsync/persist"`. All browser-storage code
 * lives here; the Kit stays a pure in-memory CRDT engine.
 */
export { openReplica } from "./session.js";
export { PersistenceError, isPersistenceError } from "./errors.js";
export type { PersistenceErrorCode } from "./errors.js";
export { storageKey, resolveIdentity, lockName, esc, SEP } from "./identity.js";
export {
  RECORD_VERSION,
  DEFAULT_MAX_BYTES,
  sha256Hex,
  validateRecord,
  buildRecord,
  isValidSequence,
} from "./record.js";
export type { StoredRecord, RecordIdentity } from "./record.js";
export type {
  ApplyOutcome,
  ChangeListener,
  Collection,
  EntityAdapter,
  ExportDiffResult,
  Fields,
  GetResult,
  GuardedCollection,
  OpenOptions,
  PersistSession,
  ReplicaIdentity,
  ResolvedIdentity,
  SaveState,
  SaveStateInfo,
  SaveStateListener,
  Scalar,
  State,
  StateVector,
  TransportUpdate,
  Unsubscribe,
} from "./types.js";
