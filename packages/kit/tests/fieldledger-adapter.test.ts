import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-fieldledger";

describe("REQ-SDK-001 FieldLedger incident adapter (AC-SDK-001-3)", () => {
  it("create/get/update/delete/list via Collection<Incident>", () => {
    const r = createKit().createReplica(DOC);
    const incidents = r.collection(incidentAdapter);

    const one: Incident = {
      title: "Pump offline",
      severity: "high",
      reportedAt: 1700000000000,
      resolved: false,
      notes: null,
    };
    const two: Incident = {
      title: "Valve stuck",
      severity: "medium",
      reportedAt: 1700000100000,
      resolved: false,
      notes: "intermittent",
    };

    incidents.put("inc-1", one);
    incidents.put("inc-2", two);
    expect(incidents.has("inc-1")).toBe(true);
    expect(incidents.get("inc-1")).toEqual(one);

    // changed-fields update
    incidents.put("inc-1", { ...one, resolved: true });
    expect(incidents.get("inc-1")).toEqual({ ...one, resolved: true });

    const list = [...incidents.list()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(list.map(([id]) => id)).toEqual(["inc-1", "inc-2"]);

    incidents.delete("inc-1");
    expect(incidents.has("inc-1")).toBe(false);
    expect(incidents.get("inc-1")).toBeUndefined();
    expect([...incidents.list()].map(([id]) => id)).toEqual(["inc-2"]);

    r.destroy();
  });
});
