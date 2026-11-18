import { describe, expect, it } from "vitest";

import { createKit, type EntityAdapter } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-deletion-structured";

const base: Incident = {
  title: "base",
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
};

describe("REQ-SDK-002 structured deletion (AC-SDK-002-5/6/7)", () => {
  it("entity deletion converges to absent on both replicas", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);
    const cb = b.collection(incidentAdapter);

    ca.put("E", base);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(cb.has("E")).toBe(true);

    ca.delete("E");
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    expect(ca.has("E")).toBe(false);
    expect(cb.has("E")).toBe(false);
    a.destroy();
    b.destroy();
  });

  it("edit concurrent with deletion converges; a concurrent different-field write survives (AC-SDK-002-6)", () => {
    // Use a partial adapter so a single surviving field reconstructs validly.
    interface P {
      title?: string | undefined;
      note?: string | undefined;
    }
    const adapter: EntityAdapter<P> = {
      schema: { app: "fieldledger", schemaVersion: 1, entityType: "p-del" },
      validate() {},
      toFields: (p) => {
        const f: Record<string, string> = {};
        if (p.title !== undefined) f["title"] = p.title;
        if (p.note !== undefined) f["note"] = p.note;
        return f;
      },
      fromFields: (f) => ({ title: f["title"] as string | undefined, note: f["note"] as string | undefined }),
    };

    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(adapter);
    const cb = b.collection(adapter);

    ca.put("E", { title: "t" });
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    // A deletes E entirely; B concurrently writes a NEW field `note`.
    ca.delete("E");
    cb.put("E", { title: "t", note: "survivor" });

    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);

    // Native field-level outcome: A's deleted keys stay deleted, B's new key survives.
    expect(ca.get("E")).toEqual(cb.get("E"));
    expect(ca.get("E")).toEqual({ title: undefined, note: "survivor" });
    a.destroy();
    b.destroy();
  });

  it("a deleted id can be reused — writing fields again recreates the entity (AC-SDK-002-7)", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("E", base);
    col.delete("E");
    expect(col.has("E")).toBe(false);
    col.put("E", { ...base, title: "reborn" });
    expect(col.get("E")?.title).toBe("reborn");
    r.destroy();
  });
});
