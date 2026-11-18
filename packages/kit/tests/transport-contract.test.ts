import { describe, expect, it } from "vitest";

import { createKit, type UpdateCarrier } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-transport-contract";

const inc = (): Incident => ({
  title: "t",
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

describe("REQ-SDK-006 transport-neutral contract (AC-SDK-006-1/2/4)", () => {
  it("exportState/exportStateVector/exportDiff return the right kind and non-empty bytes", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.collection(incidentAdapter).put("E", inc());

    const full = a.exportState();
    expect(full.kind).toBe("full");
    expect(full.documentId).toBe(DOC);
    expect(full.bytes.length).toBeGreaterThan(0);

    const sv = a.exportStateVector();
    expect(sv.kind).toBe("stateVector");
    expect(sv.bytes.length).toBeGreaterThan(0);

    const diff = a.exportDiff(b.exportStateVector());
    expect(diff.ok).toBe(true);
    if (!diff.ok) throw new Error("unreachable");
    expect(diff.update.kind).toBe("diff");
    expect(diff.update.bytes.length).toBeGreaterThan(0);
    a.destroy();
    b.destroy();
  });

  it("a TransportUpdate structurally satisfies the baseline UpdateCarrier at applyUpdate", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("k", "v");
    const update = a.exportState();
    // Assign to the baseline carrier type — structural compatibility check.
    const asCarrier: UpdateCarrier = update;
    expect(b.applyUpdate(asCarrier).ok).toBe(true);
    expect(b.get("k")).toBe("v");
    a.destroy();
    b.destroy();
  });
});
