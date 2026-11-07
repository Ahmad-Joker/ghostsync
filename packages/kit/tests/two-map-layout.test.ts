import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit } from "../src/index.js";
import { incidentAdapter } from "./fixtures/adapters.js";

const DOC = "doc-two-map";

describe("REQ-SDK-002 two-map layout (AC-SDK-002-8, AC-SDK-004-1/6)", () => {
  it("getState includes all legacy root keys and no structured records (collision test 4)", () => {
    const r = createKit().createReplica(DOC);
    const incidents = r.collection(incidentAdapter);

    r.set("alpha", 1);
    r.set("beta", "two");
    incidents.put("inc-1", {
      title: "x",
      severity: "low",
      reportedAt: 0,
      resolved: false,
      notes: null,
    });

    // getState is the flat projection of root ONLY — no structured keys leak in.
    expect(r.getState()).toEqual({ alpha: 1, beta: "two" });
    // The structured entity is still readable via the collection.
    expect(incidents.get("inc-1")?.title).toBe("x");
    r.destroy();
  });

  it("a full-state export transfers BOTH maps so legacy and structured converge (collision test 5)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);

    a.set("legacyKey", "legacyVal");
    ca.put("inc-1", { title: "t", severity: "high", reportedAt: 1, resolved: false, notes: null });

    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    const cb = b.collection(incidentAdapter);

    expect(b.get("legacyKey")).toBe("legacyVal");
    expect(cb.get("inc-1")?.title).toBe("t");
    a.destroy();
    b.destroy();
  });

  it("a differential export also transfers BOTH maps (collision test 5, diff path)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);

    a.set("legacyKey", "L");
    ca.put("inc-9", { title: "diff", severity: "medium", reportedAt: 2, resolved: true, notes: null });

    const diff = a.exportDiff(b.exportStateVector());
    expect(diff.ok).toBe(true);
    if (!diff.ok) throw new Error("unreachable");
    expect(b.applyUpdate(diff.update).ok).toBe(true);

    const cb = b.collection(incidentAdapter);
    expect(b.get("legacyKey")).toBe("L");
    expect(cb.get("inc-9")?.title).toBe("diff");
    a.destroy();
    b.destroy();
  });

  it("the two maps are distinct top-level types in one Y.Doc; no nested per-entity map", () => {
    const r = createKit().createReplica(DOC);
    const incidents = r.collection(incidentAdapter);
    r.set("alpha", 1);
    incidents.put("inc-1", { title: "x", severity: "low", reportedAt: 0, resolved: false, notes: null });

    // Decode the exported bytes into a raw reference doc and inspect structure.
    const ref = new Y.Doc();
    Y.applyUpdate(ref, r.exportState().bytes);
    const root = ref.getMap<unknown>("root");
    const rec = ref.getMap<unknown>("ghostsync:records:v1");
    expect(root).not.toBe(rec);
    expect([...root.keys()]).toEqual(["alpha"]);
    // All records-map values are scalars (no nested Y.Map), proving defect-A avoidance.
    for (const value of rec.values()) {
      expect(value instanceof Y.Map).toBe(false);
      expect(value instanceof Y.AbstractType).toBe(false);
    }
    ref.destroy();
    r.destroy();
  });
});
