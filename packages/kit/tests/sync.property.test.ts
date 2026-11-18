import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import type { Scalar } from "../src/index.js";
import { reportRun } from "./fc-report.js";

const DOC = "doc-sync-prop";

const scalarArb: fc.Arbitrary<Scalar> = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

describe("REQ-002 convergence property", () => {
  it("two-way exchange converges for disjoint distinct-key edits", () => {
    // Correction 1: A writes ONLY "A::"-prefixed keys and B writes ONLY
    // "B::"-prefixed keys, so the two key sets are guaranteed disjoint. The
    // generators produce distinct raw keys; the namespace prefix is applied
    // consistently for both writes and assertions. Every array is bounded.
    const edits = fc.uniqueArray(
      fc.record({ key: fc.string({ minLength: 1 }), value: scalarArb }),
      { minLength: 1, maxLength: 16, selector: (e) => e.key },
    );

    const result = fc.check(
      fc.property(edits, edits, (editsA, editsB) => {
        const kit = createKit();
        const a = kit.createReplica(DOC);
        const b = kit.createReplica(DOC);
        try {
          // nonempty guard — a vacuous pass is impossible
          if (editsA.length === 0 || editsB.length === 0) return false;

          // Consistent separate namespaces: A -> "A::", B -> "B::".
          // These sets cannot overlap even if the raw keys collide.
          for (const { key, value } of editsA) a.set(`A::${key}`, value);
          for (const { key, value } of editsB) b.set(`B::${key}`, value);

          b.applyUpdate(a.exportState());
          a.applyUpdate(b.exportState());

          // converge
          expect(a.getState()).toEqual(b.getState());
          // every edit preserved under its own namespace, on both replicas
          for (const { key, value } of editsA) {
            if (a.get(`A::${key}`) !== value) return false;
            if (b.get(`A::${key}`) !== value) return false;
          }
          for (const { key, value } of editsB) {
            if (a.get(`B::${key}`) !== value) return false;
            if (b.get(`B::${key}`) !== value) return false;
          }
          return true;
        } finally {
          a.destroy();
          b.destroy();
        }
      }),
      { verbose: true },
    );

    reportRun("REQ-002 two-way convergence (disjoint A::/B:: namespaces)", result, (m) =>
      expect.fail(m),
    );
    expect(result.failed).toBe(false);
    expect(result.numRuns).toBe(200);
  });

  it("deterministic: raw keys 'B::x' (A) and 'x' (B) both survive unambiguously", () => {
    // Correction 1 deterministic coverage: A writes a raw key that LOOKS like
    // B's namespace ("B::x") and B writes a raw key "x". With the corrected
    // consistent namespacing (A -> "A::", B -> "B::") these map to distinct
    // keys ("A::B::x" and "B::x") that cannot collide, so BOTH edits are
    // preserved after a two-way exchange.
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    try {
      a.set("A::B::x", "from-A");
      b.set("B::x", "from-B");

      b.applyUpdate(a.exportState());
      a.applyUpdate(b.exportState());

      expect(a.getState()).toEqual(b.getState());
      expect(a.get("A::B::x")).toBe("from-A");
      expect(a.get("B::x")).toBe("from-B");
      expect(b.get("A::B::x")).toBe("from-A");
      expect(b.get("B::x")).toBe("from-B");
      // Exactly the two distinct keys exist — nothing collided.
      expect(a.getState()).toEqual({ "A::B::x": "from-A", "B::x": "from-B" });
    } finally {
      a.destroy();
      b.destroy();
    }
  });
});
