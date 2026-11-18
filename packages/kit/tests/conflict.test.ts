import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-conflict";

describe("REQ-003 concurrent same-field edits", () => {
  it("AC-003-1: same-key agrees and the winner is a submitted value", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("F", "alpha");
    b.set("F", "beta");

    b.applyUpdate(a.exportState());
    a.applyUpdate(b.exportState());

    expect(a.getState()).toEqual(b.getState());
    expect(a.get("F")).toBe(b.get("F"));
    expect(["alpha", "beta"]).toContain(a.get("F"));

    a.destroy();
    b.destroy();
  });

  it("AC-003-2: no wall-clock guarantee (agreement + membership only)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    // A edits first in wall-clock time, but Yjs does not promise A wins.
    a.set("F", "alpha");
    b.set("F", "beta");

    b.applyUpdate(a.exportState());
    a.applyUpdate(b.exportState());

    const resolved = a.get("F");
    // Observed winner recorded as output only; not asserted to be wall-clock-later.
    expect(a.get("F")).toBe(b.get("F"));
    expect(["alpha", "beta"]).toContain(resolved);

    a.destroy();
    b.destroy();
  });
});
