import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createKit, type EntityAdapter } from "../src/index.js";
import { reportRun } from "./fc-report.js";

const DOC = "doc-diff-sync-property";

interface Rec {
  v: number;
}
const adapter: EntityAdapter<Rec> = {
  schema: { app: "patchboard", schemaVersion: 1, entityType: "num" },
  validate(r) {
    if (!Number.isFinite(r.v)) throw new TypeError("v");
  },
  toFields: (r) => ({ v: r.v }),
  fromFields: (f) => ({ v: f["v"] as number }),
};

/**
 * Disjoint id spaces per replica (A:: vs B::) so there is NO same-id conflict —
 * the two convergence paths are then deterministically identical regardless of
 * merge order (a same-field LWW conflict could otherwise pick different winners
 * for the diff path vs the full-state path, which is expected and not a bug).
 */
const editsAArb = fc.array(
  fc.record({ id: fc.constantFrom("A::e0", "A::e1", "A::e2"), v: fc.integer({ min: 0, max: 20 }) }),
  { minLength: 1, maxLength: 12 },
);
const editsBArb = fc.array(
  fc.record({ id: fc.constantFrom("B::e0", "B::e1", "B::e2"), v: fc.integer({ min: 0, max: 20 }) }),
  { minLength: 1, maxLength: 12 },
);

describe("REQ-SDK-004 diff convergence equals full-state convergence (AC-SDK-004-1, NFR-SDK-003)", () => {
  it("for arbitrary disjoint edit sets, diff-based convergence matches full-state", () => {
    const result = fc.check(
      fc.property(editsAArb, editsBArb, (editsA, editsB) => {
        const kit = createKit();
        // Diff-synced pair.
        const a = kit.createReplica(DOC);
        const b = kit.createReplica(DOC);
        // Full-state-synced pair (reference) with identical inputs.
        const fa = kit.createReplica(DOC);
        const fb = kit.createReplica(DOC);
        const ca = a.collection(adapter);
        const cb = b.collection(adapter);
        const cfa = fa.collection(adapter);
        const cfb = fb.collection(adapter);
        try {
          for (const e of editsA) {
            ca.put(e.id, { v: e.v });
            cfa.put(e.id, { v: e.v });
          }
          for (const e of editsB) {
            cb.put(e.id, { v: e.v });
            cfb.put(e.id, { v: e.v });
          }

          // diff path
          const dA = a.exportDiff(b.exportStateVector());
          const dB = b.exportDiff(a.exportStateVector());
          if (!dA.ok || !dB.ok) return false;
          if (!b.applyUpdate(dA.update).ok) return false;
          if (!a.applyUpdate(dB.update).ok) return false;

          // full-state path
          if (!fb.applyUpdate(fa.exportState()).ok) return false;
          if (!fa.applyUpdate(fb.exportState()).ok) return false;

          const sortL = (
            c: ReturnType<typeof a.collection<Rec>>,
          ): Array<readonly [string, Rec]> => [...c.list()].sort((x, y) => x[0].localeCompare(y[0]));

          expect(sortL(ca)).toEqual(sortL(cb));
          expect(sortL(ca)).toEqual(sortL(cfa));
          expect(sortL(cfa)).toEqual(sortL(cfb));
          return true;
        } finally {
          a.destroy();
          b.destroy();
          fa.destroy();
          fb.destroy();
        }
      }),
      { verbose: true },
    );
    reportRun("REQ-SDK-004 diff convergence equals full-state", result, (m) => expect.fail(m));
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });
});
