/**
 * Baseline full-state fixture — REAL provenance (NFR-SDK-005, task 9.22).
 *
 * These bytes are a genuine `exportState().bytes` produced by the BASELINE
 * build at commit `ab37419` (before the `ghostsync:records:v1` records map
 * existed), NOT fabricated by the current implementation. They are the
 * full-state export of a baseline replica holding the known flat scalar keys
 * in `KNOWN_BASELINE_STATE` below.
 *
 * Provenance (how/when generated):
 * - Source commit: ab3741949a5565196b6c8405dce9d1720810eade ("feat: add
 *   verified core synchronization proof and Kiro specs").
 * - Method: `git worktree add --detach <temp> ab37419` into an isolated
 *   temporary directory OUTSIDE the working tree, `pnpm install --frozen-lockfile`
 *   + `pnpm -F @ghostsync/kit build` there, then a one-off Node script imported
 *   the BASELINE `dist/index.js`, wrote the known scalar keys via `replica.set`,
 *   and printed `Buffer.from(exportState().bytes).toString("base64")`.
 * - Generated: 2026-11-08 (Node v24.14.0, pnpm 10.34.9).
 * - The temporary worktree was removed afterward (`git worktree remove`), so the
 *   main working tree was never switched or reset.
 *
 * The baseline-fixture test restores these bytes into a fresh current-build
 * replica and asserts `getState()` deep-equals `KNOWN_BASELINE_STATE`,
 * proving the `root` map's encoded structure is unchanged by adding the
 * separate records map.
 */
import type { Scalar } from "../../src/index.js";

/** The logical documentId the baseline replica used when exporting. */
export const BASELINE_DOCUMENT_ID = "baseline-fixture-doc";

/** The known flat scalar state the baseline replica held at export time. */
export const KNOWN_BASELINE_STATE: Record<string, Scalar> = {
  alpha: 1,
  beta: "two",
  gamma: true,
  delta: null,
  epsilon: 3.5,
};

/** Base64 of the genuine baseline `exportState().bytes` from commit ab37419. */
export const BASELINE_FULL_STATE_BASE64 =
  "AQW0su/QDwAoAQRyb290BWFscGhhAX0BKAEEcm9vdARiZXRhAXcDdHdvKAEEcm9vdAVnYW1tYQF4KAEEcm9vdAVkZWx0YQF+KAEEcm9vdAdlcHNpbG9uAXxAYAAAAA==";

/** Decode the fixture base64 into the raw Yjs update bytes. */
export function baselineFullStateBytes(): Uint8Array {
  const binary =
    typeof atob === "function"
      ? atob(BASELINE_FULL_STATE_BASE64)
      : Buffer.from(BASELINE_FULL_STATE_BASE64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
