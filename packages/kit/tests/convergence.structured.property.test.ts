import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createKit, type EntityAdapter } from "../src/index.js";
import { reportRun } from "./fc-report.js";

const DOC = "doc-convergence-structured";

/** A permissive record of a few optional scalar fields over a small id space. */
interface Rec {
  a?: string | undefined;
  b?: number | undefined;
  c?: boolean | undefined;
}
const adapter: EntityAdapter<Rec> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "rec" },
  validate() {},
  toFields: (r) => {
    const f: Record<string, string | number | boolean> = {};
    if (r.a !== undefined) f["a"] = r.a;
    if (r.b !== undefined) f["b"] = r.b;
    if (r.c !== undefined) f["c"] = r.c;
    return f;
  },
  fromFields: (f) => ({
    a: f["a"] as string | undefined,
    b: f["b"] as number | undefined,
    c: f["c"] as boolean | undefined,
  }),
};

type Edit = { readonly id: string; readonly rec: Rec };

const recArb: fc.Arbitrary<Rec> = fc.record(
  {
    a: fc.option(fc.string({ maxLength: 4 }), { nil: undefined }),
    b: fc.option(fc.integer({ min: -5, max: 5 }), { nil: undefined }),
    c: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: [] },
);

const editsArb: fc.Arbitrary<ReadonlyArray<Edit>> = fc.array(
  fc.record({ id: fc.constantFrom("e0", "e1", "e2"), rec: recArb }),
  { minLength: 1, maxLength: 10 },
);

function applyEdits(
  col: ReturnType<ReturnType<ReturnType<typeof createKit>["createReplica"]>["collection"]>,
  edits: ReadonlyArray<Edit>,
): void {
  for (const e of edits) {
    (col as unknown as { put(id: string, r: Rec): void }).put(e.id, e.rec);
  }
}

describe("REQ-SDK-002 structured convergence property (AC-SDK-002-1/4, NFR-SDK-003)", () => {
  it("arbitrary edit sets incl. concurrent same-id creation converge both ways", () => {
    const result = fc.check(
      fc.property(editsArb, editsArb, (editsA, editsB) => {
        const kit = createKit();
        const a = kit.createReplica(DOC);
        const b = kit.createReplica(DOC);
        const ca = a.collection(adapter);
        const cb = b.collection(adapter);
        try {
          applyEdits(ca, editsA);
          applyEdits(cb, editsB);

          // Two-way exchange, repeated to a fixpoint.
          expect(b.applyUpdate(a.exportState()).ok).toBe(true);
          expect(a.applyUpdate(b.exportState()).ok).toBe(true);
          expect(b.applyUpdate(a.exportState()).ok).toBe(true);

          const la = [...ca.list()].sort((x, y) => x[0].localeCompare(y[0]));
          const lb = [...cb.list()].sort((x, y) => x[0].localeCompare(y[0]));
          expect(la).toEqual(lb);

          // Idempotency: re-applying converged state changes nothing.
          expect(a.applyUpdate(b.exportState()).ok).toBe(true);
          expect([...ca.list()].sort((x, y) => x[0].localeCompare(y[0]))).toEqual(la);
          return true;
        } finally {
          a.destroy();
          b.destroy();
        }
      }),
      { verbose: true },
    );
    reportRun("REQ-SDK-002 structured convergence (concurrent same-id)", result, (m) => expect.fail(m));
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });
});
