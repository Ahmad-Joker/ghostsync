import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-entities";

function exchange(a: ReturnType<ReturnType<typeof createKit>["createReplica"]>, b: typeof a): void {
  expect(b.applyUpdate(a.exportState()).ok).toBe(true);
  expect(a.applyUpdate(b.exportState()).ok).toBe(true);
}

describe("REQ-SDK-002 structured convergence (AC-SDK-002-1/8)", () => {
  it("two replicas create/edit entities, exchange, and converge via list()", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);
    const cb = b.collection(incidentAdapter);

    const i1: Incident = { title: "A1", severity: "high", reportedAt: 1, resolved: false, notes: null };
    const i2: Incident = { title: "B1", severity: "low", reportedAt: 2, resolved: true, notes: "n" };
    ca.put("e1", i1);
    cb.put("e2", i2);

    exchange(a, b);

    const sortList = (c: typeof ca): Array<readonly [string, Incident]> =>
      [...c.list()].sort((x, y) => x[0].localeCompare(y[0]));
    expect(sortList(ca)).toEqual(sortList(cb));
    expect(sortList(ca)).toEqual([
      ["e1", i1],
      ["e2", i2],
    ]);

    a.destroy();
    b.destroy();
  });

  it("entities are scalar-field sets, read on a null-prototype object", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("e1", { title: "t", severity: "low", reportedAt: 0, resolved: false, notes: null });
    const got = col.get("e1");
    expect(got).toBeDefined();
    // Each field is a scalar, not a nested object / JSON string.
    for (const v of Object.values(got as unknown as Record<string, unknown>)) {
      expect(["string", "number", "boolean", "object"]).toContain(typeof v);
      if (typeof v === "object") expect(v).toBeNull();
    }
    r.destroy();
  });
});
