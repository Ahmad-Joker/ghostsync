import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit } from "../src/index.js";
import type { Scalar, UpdateCarrier } from "../src/index.js";
import { reportRun } from "./fc-report.js";

const DOC = "doc-merge-inv";
const ROOT_MAP = "root";

const scalarArb: fc.Arbitrary<Scalar> = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

/** A single local operation history item: set or delete a key. */
type Op =
  | { readonly kind: "set"; readonly key: string; readonly value: Scalar }
  | { readonly kind: "delete"; readonly key: string };

/**
 * A bounded nonempty history of ops over a SMALL key space, so repeated writes
 * to the SAME key and set-then-delete sequences occur naturally.
 */
const historyArb: fc.Arbitrary<ReadonlyArray<Op>> = fc.array(
  fc.oneof(
    fc.record({
      kind: fc.constant("set" as const),
      key: fc.constantFrom("k0", "k1", "k2"),
      value: scalarArb,
    }),
    fc.record({
      kind: fc.constant("delete" as const),
      key: fc.constantFrom("k0", "k1", "k2"),
    }),
  ),
  { minLength: 1, maxLength: 12 },
);

/** Plain projection of a raw reference Y.Doc's root map (test-side mirror). */
function projectRef(doc: Y.Doc): Record<string, Scalar> {
  const map = doc.getMap<unknown>(ROOT_MAP);
  const out: Record<string, Scalar> = {};
  for (const [key, value] of map.entries()) {
    out[key] = value as Scalar;
  }
  return out;
}

/**
 * Deliver one history on a dedicated source replica, capturing a FULL-STATE
 * export carrier after every op. The carriers are what receivers will merge.
 */
function captureUpdates(history: ReadonlyArray<Op>): UpdateCarrier[] {
  const kit = createKit();
  const src = kit.createReplica(DOC);
  const carriers: UpdateCarrier[] = [];
  try {
    for (const op of history) {
      if (op.kind === "set") src.set(op.key, op.value);
      else src.delete(op.key);
      carriers.push(src.exportState());
    }
    return carriers;
  } finally {
    src.destroy();
  }
}

/** Fisher–Yates permutation driven by a generated index list. */
function permute<T>(items: ReadonlyArray<T>, swaps: ReadonlyArray<number>): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = swaps.length > 0 ? (swaps[(out.length - 1 - i) % swaps.length] ?? 0) % (i + 1) : 0;
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

describe("REQ-004 strengthened merge invariants (convergence vs a Yjs reference)", () => {
  it("fresh receivers converge for original / permuted / duplicated / merged delivery", () => {
    // Two independent source histories (two independent replicas), a bounded
    // permutation driver, all generators bounded nonempty.
    const result = fc.check(
      fc.property(
        historyArb,
        historyArb,
        fc.array(fc.nat({ max: 1_000 }), { minLength: 0, maxLength: 24 }),
        (historyA, historyB, swaps) => {
          if (historyA.length === 0 || historyB.length === 0) return false;

          const carriersA = captureUpdates(historyA);
          const carriersB = captureUpdates(historyB);
          const allBytes = [...carriersA, ...carriersB].map((c) => c.bytes);
          const carriers = [...carriersA, ...carriersB];

          // Direct Yjs reference doc: receives those EXACT bytes, in order.
          const refDoc = new Y.Doc();

          const kit = createKit();
          const original = kit.createReplica(DOC);
          const permuted = kit.createReplica(DOC);
          const duplicated = kit.createReplica(DOC);
          const merged = kit.createReplica(DOC);

          try {
            for (const bytes of allBytes) Y.applyUpdate(refDoc, bytes);
            const reference = projectRef(refDoc);

            // (a) original order — every valid apply must succeed.
            for (const carrier of carriers) {
              const outcome = original.applyUpdate(carrier);
              if (outcome.ok !== true) return false;
            }

            // (b) a generated permutation.
            for (const carrier of permute(carriers, swaps)) {
              const outcome = permuted.applyUpdate(carrier);
              if (outcome.ok !== true) return false;
            }

            // (c) duplicate deliveries — each carrier applied twice.
            for (const carrier of carriers) {
              const first = duplicated.applyUpdate(carrier);
              const second = duplicated.applyUpdate(carrier);
              if (first.ok !== true || second.ok !== true) return false;
            }

            // (d) a single Y.mergeUpdates batch.
            const batch = Y.mergeUpdates(allBytes);
            const mergedOutcome = merged.applyUpdate({ documentId: DOC, bytes: batch });
            if (mergedOutcome.ok !== true) return false;

            // Convergence against the DIRECT Yjs reference projection, not
            // only wrapper-to-wrapper.
            expect(original.getState()).toEqual(reference);
            expect(permuted.getState()).toEqual(reference);
            expect(duplicated.getState()).toEqual(reference);
            expect(merged.getState()).toEqual(reference);
            return true;
          } finally {
            original.destroy();
            permuted.destroy();
            duplicated.destroy();
            merged.destroy();
            refDoc.destroy();
          }
        },
      ),
      { verbose: true },
    );

    reportRun(
      "REQ-004 fresh receivers converge vs Yjs reference (orig/perm/dup/merged)",
      result,
      (m) => expect.fail(m),
    );
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });

  it("deterministic deletion regression: an older update cannot resurrect a deletion", () => {
    const kit = createKit();
    const src = kit.createReplica(DOC);

    // Set-then-delete history on an independent source replica.
    src.set("F", "x");
    const older = src.exportState(); // pre-deletion full state
    src.delete("F");
    const newer = src.exportState(); // post-deletion full state

    // A fresh receiver gets the NEWER (deletion) update, then the OLDER one.
    const receiver = kit.createReplica(DOC);
    // A direct Yjs reference gets the same exact bytes in the same order.
    const refDoc = new Y.Doc();

    try {
      expect(receiver.applyUpdate(newer)).toEqual({ ok: true });
      Y.applyUpdate(refDoc, newer.bytes);
      expect(receiver.has("F")).toBe(false);

      // Deliver the older pre-deletion update AFTER the deletion.
      expect(receiver.applyUpdate(older)).toEqual({ ok: true });
      Y.applyUpdate(refDoc, older.bytes);

      // The deletion must win; F must NOT be resurrected.
      expect(receiver.has("F")).toBe(false);
      expect(receiver.getState()).toEqual({});
      expect(receiver.getState()).toEqual(projectRef(refDoc));
    } finally {
      src.destroy();
      receiver.destroy();
      refDoc.destroy();
    }
  });
});
