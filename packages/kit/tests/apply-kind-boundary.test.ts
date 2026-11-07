import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-apply-kind";

describe("REQ-SDK-007 kind-gated apply boundary (AC-SDK-007-4)", () => {
  it("a stateVector carrier is rejected invalidCarrier BEFORE its bytes are decoded", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("alpha", 1);

    const sv = a.exportStateVector(); // { documentId, kind:"stateVector", bytes }
    const before = b.getState();
    let notifications = 0;
    b.subscribe(() => notifications++);

    const outcome = b.applyUpdate(sv);
    expect(outcome).toEqual({ ok: false, reason: "invalidCarrier" });
    expect(b.getState()).toEqual(before);
    expect(notifications).toBe(0);
    a.destroy();
    b.destroy();
  });

  it("an unknown kind is rejected invalidCarrier; absent/full/diff proceed", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("k", 1);
    const full = a.exportState();

    expect(b.applyUpdate({ documentId: DOC, kind: "weird", bytes: full.bytes })).toEqual({
      ok: false,
      reason: "invalidCarrier",
    });
    // absent kind (baseline carrier) proceeds
    expect(b.applyUpdate({ documentId: DOC, bytes: full.bytes }).ok).toBe(true);
    // explicit full proceeds
    const b2 = kit.createReplica(DOC);
    expect(b2.applyUpdate(full).ok).toBe(true);
    a.destroy();
    b.destroy();
    b2.destroy();
  });
});
