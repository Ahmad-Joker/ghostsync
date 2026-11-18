import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-conflict-structured";

const base: Incident = {
  title: "base",
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
};

describe("REQ-SDK-002 structured conflict (AC-SDK-002-2/3)", () => {
  it("concurrent different-field edits both survive", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);
    const cb = b.collection(incidentAdapter);

    // Seed identical state on both.
    ca.put("E", base);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    // A edits only title, B edits only severity (different fields).
    ca.put("E", { ...base, title: "A-title" });
    cb.put("E", { ...base, severity: "high" });

    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);

    expect(ca.get("E")).toEqual(cb.get("E"));
    expect(ca.get("E")?.title).toBe("A-title");
    expect(ca.get("E")?.severity).toBe("high");
    a.destroy();
    b.destroy();
  });

  it("same-field conflict resolves to exactly one submitted value on both", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);
    const cb = b.collection(incidentAdapter);

    ca.put("E", base);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    ca.put("E", { ...base, title: "X" });
    cb.put("E", { ...base, title: "Y" });

    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);

    expect(ca.get("E")).toEqual(cb.get("E"));
    expect(["X", "Y"]).toContain(ca.get("E")?.title);
    a.destroy();
    b.destroy();
  });
});
