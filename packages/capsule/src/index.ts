/**
 * GhostSync Capsule — public entry point.
 *
 * Versioned, integrity-checked file capsules around a GhostSync full-state
 * update. No CRDT logic and no storage live here: merge belongs to the Kit and
 * durability to Persist. A checksum detects corruption; it does NOT authenticate
 * the sender.
 */
export type { ApplyOutcome, State } from "@ghostsync/kit";
export {
  CAPSULE_EXTENSION,
  CAPSULE_FORMAT_VERSION,
  CAPSULE_MAGIC,
  CAPSULE_MEDIA_TYPE,
  DEFAULT_MAX_CAPSULE_BYTES,
  DEFAULT_MAX_UPDATE_BYTES,
} from "./format.js";
export type { CapsuleMetadata } from "./metadata.js";
export { CapsuleError, isCapsuleError } from "./errors.js";
export type { CapsuleErrorCode } from "./errors.js";
export { encodeCapsule } from "./encode.js";
export type { EncodeCapsuleInput } from "./encode.js";
export { decodeCapsule } from "./decode.js";
export type { DecodeCapsuleOptions, DecodedCapsule } from "./decode.js";
export { importCapsuleInto, importCapsuleIntoPersisted } from "./import.js";
export type {
  ImportExpectation,
  ImportResult,
  PersistImportResult,
  PersistLikeError,
  PersistTarget,
  ReplicaTarget,
} from "./types.js";
