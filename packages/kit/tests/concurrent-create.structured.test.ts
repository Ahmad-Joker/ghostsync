import { describe, expect, it } from "vitest";

import { createKit, type EntityAdapter } from "../src/index.js";

const DOC = "doc-concurrent-create";

/** A permissive partial-record adapter so each side can write disjoint fields. */
interface Partial {
  title?: string | undefined;
  severity?: string | undefined;
  notes?: string | undefined;
}
const partialAdapter: EntityAdapter<Partial> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "partial" },
  validate() {
    /* any subset of scalar fields is valid for this regression */
  },
  toFields: (p) => {
    const f: Record<string, string> = {};
    if (p.title !== undefined) f["title"] = p.title;
    if (p.severity !== undefined) f["severity"] = p.severity;
    if (p.notes !== undefined) f["notes"] = p.notes;
    return f;
  },
  fromFields: (f) => ({
    title: f["title"] as string | undefined,
    severity: f["severity"] as string | undefined,
    notes: f["notes"] as string | undefined,
  }),
};

describe("REQ-SDK-002 defect-A regression: concurrent same-id create (AC-SDK-002-4)", () => {
  it("two offline replicas create the SAME id with disjoint fields; both survive after exchange", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(partialAdapter);
    const cb = b.collection(partialAdapter);

    // No server, no pre-sync: each independently creates entity "E".
    ca.put("E", { title: "A-title", severity: "high" });
    cb.put("E", { notes: "B-notes", severity: "low" });

    // Two-way exchange.
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);

    const fa = ca.get("E");
    const fb = cb.get("E");
    expect(fa).toEqual(fb);
    // Field union: A's title and B's notes both survive; no side's fields lost.
    expect(fa?.title).toBe("A-title");
    expect(fa?.notes).toBe("B-notes");
    // The shared field resolves to ONE submitted value (LWW), identical on both.
    expect(["high", "low"]).toContain(fa?.severity);
    expect(fa?.severity).toBe(fb?.severity);

    a.destroy();
    b.destroy();
  });
});
