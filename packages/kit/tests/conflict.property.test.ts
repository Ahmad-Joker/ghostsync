import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import type { Scalar } from "../src/index.js";
import { reportRun } from "./fc-report.js";

const DOC = "doc-conflict-prop";

const scalarArb: fc.Arbitrary<Scalar> = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

/** Two distinct scalars for the concurrent same-key write. */
const distinctPair = fc
  .tuple(scalarArb, scalarArb)
  .filter(([x, y]) => !Object.is(x, y));

describe("AC-002-2 / AC-003-1 conflict property", () => {
  it("concurrent same-key resolves to a submitted value on both replicas", () => {
    const result = fc.check(
      fc.property(distinctPair, ([x, y]) => {
        const kit = createKit();
        const a = kit.createReplica(DOC);
        const b = kit.createReplica(DOC);
        try {
          a.set("F", x);
          b.set("F", y);

          b.applyUpdate(a.exportState());
          a.applyUpdate(b.exportState());

          expect(a.getState()).toEqual(b.getState());
          const resolved = a.get("F");
          // membership in the submitted set (by SameValue to handle null/0/-0)
          return Object.is(resolved, x) || Object.is(resolved, y);
        } finally {
          a.destroy();
          b.destroy();
        }
      }),
      { verbose: true },
    );

    reportRun("AC-003-1 concurrent same-key resolves to a submitted value", result, (m) =>
      expect.fail(m),
    );
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });
});
