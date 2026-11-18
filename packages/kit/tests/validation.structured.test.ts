import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-validation-structured";

describe("REQ-SDK-007 structured validation (AC-SDK-007-1/2)", () => {
  it("put rejects an invalid T before mutation, leaving state unchanged", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    const bad = { title: "", severity: "nope", reportedAt: NaN, resolved: 1, notes: 5 } as unknown as Incident;
    expect(() => col.put("E", bad)).toThrow(TypeError);
    expect(col.has("E")).toBe(false);
    r.destroy();
  });

  it("put validation runs before any field is written on a partially-bad entity", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("E", { title: "ok", severity: "low", reportedAt: 1, resolved: false, notes: null });
    const before = col.get("E");
    // A later invalid put must not partially mutate.
    expect(() =>
      col.put("E", { title: "ok2", severity: "bad" as Incident["severity"], reportedAt: 2, resolved: false, notes: null }),
    ).toThrow();
    expect(col.get("E")).toEqual(before);
    r.destroy();
  });
});
