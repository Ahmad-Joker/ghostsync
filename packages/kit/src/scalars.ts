import type { Scalar } from "./types.js";

/**
 * Runtime scalar guard (correction 5). Rejects every non-scalar before a write
 * reaches the Y.Map: `undefined`, arrays, non-null objects, functions, symbols,
 * `bigint`, and non-finite numbers (`NaN`, `+Infinity`, `-Infinity`).
 *
 * Allowed values: `string`, finite `number`, `boolean`, `null`.
 *
 * No Node-only imports — this module is browser-compatible.
 */
export function assertScalar(value: unknown): asserts value is Scalar {
  if (value === null) {
    return;
  }
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") {
    return;
  }
  if (kind === "number" && Number.isFinite(value)) {
    return;
  }
  const described =
    kind === "number"
      ? String(value) // NaN / Infinity / -Infinity
      : kind === "object"
        ? Array.isArray(value)
          ? "array"
          : "object"
        : kind;
  throw new TypeError(
    `GhostSync Kit: value must be a scalar (string, finite number, boolean, or null); received ${described}`,
  );
}
