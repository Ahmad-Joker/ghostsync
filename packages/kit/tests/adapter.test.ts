import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import { assertSchemaIdentity, schemaIdentityEqual } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-adapter";

describe("REQ-SDK-001 adapter contract", () => {
  it("AC-SDK-001-1/4: toFields/fromFields round-trip through a collection", () => {
    const r = createKit().createReplica(DOC);
    const incidents = r.collection(incidentAdapter);
    const value: Incident = {
      title: "Pump offline",
      severity: "high",
      reportedAt: 1700000000000,
      resolved: false,
      notes: null,
    };
    incidents.put("inc-1", value);
    expect(incidents.get("inc-1")).toEqual(value);
    r.destroy();
  });

  it("AC-SDK-001-2: a non-scalar field value is rejected before mutation", () => {
    const r = createKit().createReplica(DOC);
    // An adapter whose toFields emits a non-scalar (nested object) value.
    const badAdapter = {
      schema: { app: "x", schemaVersion: 1, entityType: "bad" },
      validate() {
        /* passes */
      },
      toFields: () => ({ nested: { deep: true } }) as unknown as Record<string, never>,
      fromFields: () => ({}),
    };
    const col = r.collection(badAdapter);
    expect(() => col.put("1", {})).toThrow(TypeError);
    // No field key was written (nothing mutated before the throw).
    expect(col.has("1")).toBe(false);
    r.destroy();
  });

  it("assertSchemaIdentity rejects malformed identities", () => {
    expect(() => assertSchemaIdentity(null)).toThrow(TypeError);
    expect(() => assertSchemaIdentity({ app: "", schemaVersion: 1, entityType: "x" })).toThrow();
    expect(() => assertSchemaIdentity({ app: "a", schemaVersion: -1, entityType: "x" })).toThrow();
    expect(() => assertSchemaIdentity({ app: "a", schemaVersion: 1.5, entityType: "x" })).toThrow();
    expect(() => assertSchemaIdentity({ app: "a", schemaVersion: 1, entityType: "" })).toThrow();
    expect(() => assertSchemaIdentity({ app: "a", schemaVersion: 1, entityType: "x" })).not.toThrow();
  });

  it("schemaIdentityEqual compares all three components", () => {
    const base = { app: "a", schemaVersion: 1, entityType: "e" };
    expect(schemaIdentityEqual(base, { ...base })).toBe(true);
    expect(schemaIdentityEqual(base, { ...base, schemaVersion: 2 })).toBe(false);
    expect(schemaIdentityEqual(base, { ...base, app: "b" })).toBe(false);
    expect(schemaIdentityEqual(base, { ...base, entityType: "f" })).toBe(false);
  });
});
