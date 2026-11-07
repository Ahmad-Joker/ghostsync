import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-sync";

describe("REQ-002 two-way binary update exchange converges", () => {
  it("AC-002-1: two-way exchange converges", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("alpha", 1);
    b.set("beta", 2);

    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);

    expect(a.getState()).toEqual(b.getState());
    expect(a.getState()).toEqual({ alpha: 1, beta: 2 });

    a.destroy();
    b.destroy();
  });

  it("AC-002-2: nonconflicting edits preserved; same-key resolves to one submitted value", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("onlyA", "a");
    a.set("shared", "fromA");
    b.set("onlyB", "b");
    b.set("shared", "fromB");

    b.applyUpdate(a.exportState());
    a.applyUpdate(b.exportState());

    expect(a.getState()).toEqual(b.getState());
    // disjoint edits survive
    expect(a.get("onlyA")).toBe("a");
    expect(a.get("onlyB")).toBe("b");
    // concurrent same-key -> exactly one submitted value on both
    expect(a.get("shared")).toBe(b.get("shared"));
    expect(["fromA", "fromB"]).toContain(a.get("shared"));

    a.destroy();
    b.destroy();
  });

  it("AC-002-3: exported bytes apply via the public apply path", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("k", "v");
    const carrier = a.exportState();
    const outcome = b.applyUpdate(carrier);

    expect(outcome).toEqual({ ok: true });
    expect(b.get("k")).toBe("v");

    a.destroy();
    b.destroy();
  });

  it("AC-002-5: set-then-delete survives sync", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    a.set("F", "x");
    a.delete("F");

    b.applyUpdate(a.exportState());

    expect(a.has("F")).toBe(false);
    expect(b.has("F")).toBe(false);
    expect(a.getState()).toEqual(b.getState());
    expect(a.getState()).toEqual({});

    a.destroy();
    b.destroy();
  });
});
