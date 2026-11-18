import type * as Y from "yjs";
import type { Scalar, State } from "./types.js";

/**
 * Pure projection of a scalar-valued Y.Map to a fresh plain snapshot
 * (correction 4). Browser-compatible: no `node:util`, no runtime deep-equality
 * helper — equality is a test concern.
 *
 * The snapshot is built on a null-prototype object and each key is assigned as
 * an OWN data property via `Object.defineProperty`. This preserves reserved-
 * looking keys — `__proto__`, `constructor`, `toString` — as ordinary own
 * properties instead of triggering `Object.prototype` accessors/setters. A
 * fresh object is returned each call, so mutating a returned snapshot can never
 * reach the replica's state.
 */
export function project(map: Y.Map<unknown>): State {
  const out = Object.create(null) as Record<string, Scalar>;
  for (const [key, value] of map.entries()) {
    Object.defineProperty(out, key, {
      value: value as Scalar,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out as State;
}
