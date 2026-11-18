/**
 * GhostSync Kit — public entry point.
 *
 * Exposes the replica factory and the public types/values only. All sync logic
 * lives in the Kit; apps consume this surface and never reimplement merge,
 * export, or apply.
 */
export { createKit } from "./replica.js";
export {
  assertSchemaIdentity,
  schemaIdentityEqual,
} from "./adapter.js";
export type {
  EntityAdapter,
  Fields,
  SchemaIdentity,
} from "./adapter.js";
export {
  CollectionImpl,
  IncompleteRecordError,
} from "./collection.js";
export type {
  Collection,
  CollectionHost,
  GetResult,
} from "./collection.js";
export type {
  ApplyOutcome,
  ChangeEvent,
  ChangeListener,
  ExportDiffResult,
  Kit,
  Replica,
  Scalar,
  State,
  StateVector,
  TransportEnvelope,
  TransportUpdate,
  Unsubscribe,
  UpdateCarrier,
} from "./types.js";
