import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit } from "../src/index.js";
import type { Scalar } from "../src/index.js";
import { reportRun } from "./fc-report.js";

const DOC = "doc-inv-prop";

const scalarArb: fc.Arbitrary<Scalar> = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

/** Nonempty bounded list of distinct-key edits => a nonempty list of full-state updates. */
const editsArb = fc.uniqueArray(
  fc.record({ key: fc.string({ minLength: 1 }), value: scalarArb }),
  { minLength: 1, maxLength: 16, selector: (e) => e.key },
);

function buildUpdates(edits: ReadonlyArray<{ key: string; value: Scalar }>): Uint8Array[] {
  const kit = createKit();
  return edits.map(({ key, value }) => {
    const r = kit.createReplica(DOC);
    r.set(key, value);
    const bytes = r.exportState().bytes;
    r.destroy();
    return bytes;
  });
}

describe("REQ-004 merge-invariant properties", () => {
  it("AC-004-1: re-apply is a no-op (idempotency)", () => {
    const result = fc.check(
      fc.property(editsArb, (edits) => {
        if (edits.length === 0) return false;
        const updates = buildUpdates(edits);
        const kit = createKit();
        const r = kit.createReplica(DOC);
        try {
          for (const bytes of updates) r.applyUpdate({ documentId: DOC, bytes });
          const s0 = r.getState();
          for (const bytes of updates) r.applyUpdate({ documentId: DOC, bytes });
          expect(r.getState()).toEqual(s0);
          return true;
        } finally {
          r.destroy();
        }
      }),
      { verbose: true },
    );
    reportRun("AC-004-1 idempotency (re-apply is a no-op)", result, (m) => expect.fail(m));
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });

  it("AC-004-2: order independence (commutativity)", () => {
    const result = fc.check(
      fc.property(editsArb, (edits) => {
        if (edits.length === 0) return false;
        const updates = buildUpdates(edits);
        const reversed = [...updates].reverse();
        const kit = createKit();
        const forward = kit.createReplica(DOC);
        const backward = kit.createReplica(DOC);
        try {
          for (const bytes of updates) forward.applyUpdate({ documentId: DOC, bytes });
          for (const bytes of reversed) backward.applyUpdate({ documentId: DOC, bytes });
          expect(forward.getState()).toEqual(backward.getState());
          return true;
        } finally {
          forward.destroy();
          backward.destroy();
        }
      }),
      { verbose: true },
    );
    reportRun("AC-004-2 commutativity (order independence)", result, (m) => expect.fail(m));
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });

  it("AC-004-3: grouping invariance (mergeUpdates equals sequential)", () => {
    const result = fc.check(
      fc.property(editsArb, (edits) => {
        if (edits.length === 0) return false;
        const updates = buildUpdates(edits);
        const kit = createKit();
        const seq = kit.createReplica(DOC);
        const merged = kit.createReplica(DOC);
        try {
          for (const bytes of updates) seq.applyUpdate({ documentId: DOC, bytes });
          const batch = Y.mergeUpdates(updates);
          merged.applyUpdate({ documentId: DOC, bytes: batch });
          expect(seq.getState()).toEqual(merged.getState());
          return true;
        } finally {
          seq.destroy();
          merged.destroy();
        }
      }),
      { verbose: true },
    );
    reportRun("AC-004-3 grouping (mergeUpdates equals sequential)", result, (m) =>
      expect.fail(m),
    );
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });
});
