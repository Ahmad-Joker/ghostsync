/**
 * GhostSync Kit — public entry point (core-sync-proof).
 *
 * Exposes the replica factory and the public types only. All sync logic lives
 * in the Kit; apps consume this surface and never reimplement merge, export, or
 * apply.
 */
export { createKit } from "./replica.js";
export type {
  ApplyOutcome,
  Kit,
  Replica,
  Scalar,
  State,
  UpdateCarrier,
} from "./types.js";
