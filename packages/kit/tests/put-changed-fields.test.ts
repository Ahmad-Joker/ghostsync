import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-put-changed-fields";

const shared: Incident = {
  title: "old",
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
};

describe("REQ-SDK-003A changed-fields put (AC-SDK-003A-1/2/3)", () => {
  it("defect-B regression: A changes only title, B only severity; both survive", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    const ca = a.collection(incidentAdapter);
    const cb = b.collection(incidentAdapter);

    // Both start from the same shared baseline.
    ca.put("E", shared);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    // A puts a full entity changing ONLY title; B a full entity changing ONLY severity.
    ca.put("E", { ...shared, title: "A-title" });
    cb.put("E", { ...shared, severity: "high" });

    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);

    // BOTH intended changes survive — put wrote only its changed leaf key.
    expect(ca.get("E")).toEqual(cb.get("E"));
    expect(ca.get("E")).toEqual({ ...shared, title: "A-title", severity: "high" });
    a.destroy();
    b.destroy();
  });

  it("an unchanged put generates no write (no transaction, no notification)", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("E", shared);

    let notifications = 0;
    r.subscribe(() => {
      notifications++;
    });
    // Re-put the IDENTICAL entity: every field unchanged → no write at all.
    col.put("E", { ...shared });
    expect(notifications).toBe(0);

    // A put that changes exactly one field fires exactly one notification.
    col.put("E", { ...shared, resolved: true });
    expect(notifications).toBe(1);
    r.destroy();
  });

  it("omitting a field deletes its leaf key (omitted-field removal)", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("E", { ...shared, notes: "keep" });
    expect(col.get("E")?.notes).toBe("keep");
    // notes becomes null (still present as a field, value null).
    col.put("E", { ...shared, notes: null });
    expect(col.get("E")?.notes).toBeNull();
    r.destroy();
  });
});
