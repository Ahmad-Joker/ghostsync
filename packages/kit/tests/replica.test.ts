import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-1";

describe("REQ-001 independent offline replicas", () => {
  it("AC-001-1: offline edit isolated on A, invisible on B", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("title", "incident-7");

    expect(a.getState()).toEqual({ title: "incident-7" });
    expect(b.getState()).toEqual({});
    expect(b.has("title")).toBe(false);

    a.destroy();
    b.destroy();
  });

  it("AC-001-2: disjoint offline edits both apply without network or throw", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    expect(() => a.set("alpha", 1)).not.toThrow();
    expect(() => b.set("beta", true)).not.toThrow();

    expect(a.getState()).toEqual({ alpha: 1 });
    expect(b.getState()).toEqual({ beta: true });

    a.destroy();
    b.destroy();
  });

  it("AC-001-3: pre-exchange states diverge (deeply unequal)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("alpha", "x");
    b.set("beta", "y");

    expect(a.getState()).not.toEqual(b.getState());

    a.destroy();
    b.destroy();
  });
});
