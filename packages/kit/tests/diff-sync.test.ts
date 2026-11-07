import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-diff-sync";

const inc = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

describe("REQ-SDK-004 incremental sync (AC-SDK-004-1/3/4/5/6)", () => {
  it("initial sync via state vector + diff converges B to A", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);
    ca.put("E", inc("hello"));
    a.set("legacy", 5);

    const diff = a.exportDiff(b.exportStateVector());
    expect(diff.ok).toBe(true);
    if (!diff.ok) throw new Error("unreachable");
    expect(diff.update.kind).toBe("diff");
    expect(diff.update.bytes.length).toBeGreaterThan(0);

    expect(b.applyUpdate(diff.update).ok).toBe(true);
    expect(b.collection(incidentAdapter).get("E")).toEqual(inc("hello"));
    expect(b.get("legacy")).toBe(5);
    a.destroy();
    b.destroy();
  });

  it("already-synchronized peers produce a non-empty no-op diff that changes nothing and fires no notification", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.collection(incidentAdapter).put("E", inc("x"));
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    // Now a and b are synchronized. A diff against b's SV is a legitimate no-op.
    const diff = a.exportDiff(b.exportStateVector());
    expect(diff.ok).toBe(true);
    if (!diff.ok) throw new Error("unreachable");
    // Still valid non-empty Yjs bytes (not zero-length).
    expect(diff.update.bytes.length).toBeGreaterThan(0);

    let notifications = 0;
    b.subscribe(() => notifications++);
    const before = b.getState();
    expect(b.applyUpdate(diff.update).ok).toBe(true);
    expect(b.getState()).toEqual(before);
    expect(notifications).toBe(0);
    a.destroy();
    b.destroy();
  });

  it("duplicate diff delivery is idempotent", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.collection(incidentAdapter).put("E", inc("dup"));
    const diff = a.exportDiff(b.exportStateVector());
    if (!diff.ok) throw new Error("unreachable");
    expect(b.applyUpdate(diff.update).ok).toBe(true);
    const after1 = b.collection(incidentAdapter).list();
    expect(b.applyUpdate(diff.update).ok).toBe(true);
    expect(b.collection(incidentAdapter).list()).toEqual(after1);
    a.destroy();
    b.destroy();
  });

  it("restore-then-sync converges with a peer's disjoint edits", () => {
    const kit = createKit();
    const seed = kit.createReplica(DOC);
    seed.collection(incidentAdapter).put("E0", inc("seed"));
    const saved = seed.exportState();
    seed.destroy();

    const a = kit.createReplica(saved.documentId, saved.bytes);
    const b = kit.createReplica(DOC);
    b.applyUpdate(saved);

    a.collection(incidentAdapter).put("EA", inc("a"));
    b.collection(incidentAdapter).put("EB", inc("b"));

    const dA = a.exportDiff(b.exportStateVector());
    const dB = b.exportDiff(a.exportStateVector());
    if (!dA.ok || !dB.ok) throw new Error("unreachable");
    expect(b.applyUpdate(dA.update).ok).toBe(true);
    expect(a.applyUpdate(dB.update).ok).toBe(true);

    const la = [...a.collection(incidentAdapter).list()].sort((x, y) => x[0].localeCompare(y[0]));
    const lb = [...b.collection(incidentAdapter).list()].sort((x, y) => x[0].localeCompare(y[0]));
    expect(la).toEqual(lb);
    expect(la.map(([id]) => id)).toEqual(["E0", "EA", "EB"]);
    a.destroy();
    b.destroy();
  });

  it("full-state export (kind:full) still works alongside diff", () => {
    const r = createKit().createReplica(DOC);
    r.set("k", 1);
    const full = r.exportState();
    expect(full.kind).toBe("full");
    expect(full.bytes.length).toBeGreaterThan(0);
    r.destroy();
  });
});
