import { describe, expect, it } from "vitest";
import { checklistItemAdapter, incidentAdapter, type ChecklistItem, type IncidentDetails } from "../src/model/adapters.js";

const item: ChecklistItem = { text: "Close inlet", done: false, sortKey: 1024, createdBy: "r1", createdAt: 5 };
const inc: IncidentDetails = { title: "Pump", location: "Bay 2", severity: "high", status: "open", notes: "n" };

describe("checklistItemAdapter", () => {
  it("round-trips and emits exactly the declared keys", () => {
    const f = checklistItemAdapter.toFields(item);
    expect(Object.keys(f).sort()).toEqual(["createdAt", "createdBy", "done", "sortKey", "text"]);
    expect(checklistItemAdapter.fromFields(f)).toEqual(item);
  });
  it("rejects invalid entities", () => {
    const bad: ChecklistItem[] = [
      { ...item, text: "" },
      { ...item, text: "x".repeat(201) },
      { ...item, sortKey: Number.NaN },
      { ...item, sortKey: Number.POSITIVE_INFINITY },
      { ...item, createdBy: "" },
      { ...item, createdBy: "x".repeat(65) },
      { ...item, createdAt: -1 },
      { ...item, createdAt: 1.5 },
      { ...item, done: "yes" as unknown as boolean },
    ];
    for (const b of bad) expect(() => checklistItemAdapter.validate(b)).toThrow(TypeError);
    expect(() => checklistItemAdapter.validate({ ...item, text: "x".repeat(200) })).not.toThrow();
  });
  it("throws on partial or mistyped stored fields and ignores extra keys", () => {
    expect(() => checklistItemAdapter.fromFields({ text: "only" })).toThrow(TypeError);
    expect(() => checklistItemAdapter.fromFields({ ...checklistItemAdapter.toFields(item), done: "no" })).toThrow(TypeError);
    expect(checklistItemAdapter.fromFields({ ...checklistItemAdapter.toFields(item), extra: 1 })).toEqual(item);
  });
});

describe("incidentAdapter", () => {
  it("round-trips and bounds fields", () => {
    expect(incidentAdapter.fromFields(incidentAdapter.toFields(inc))).toEqual(inc);
    expect(() => incidentAdapter.validate({ ...inc, title: "x".repeat(121) })).toThrow(TypeError);
    expect(() => incidentAdapter.validate({ ...inc, location: "x".repeat(121) })).toThrow(TypeError);
    expect(() => incidentAdapter.validate({ ...inc, notes: "x".repeat(2001) })).toThrow(TypeError);
    expect(() => incidentAdapter.validate({ ...inc, severity: "extreme" as never })).toThrow(TypeError);
    expect(() => incidentAdapter.validate({ ...inc, status: "done" as never })).toThrow(TypeError);
    expect(() => incidentAdapter.validate({ ...inc, title: "x".repeat(120), notes: "x".repeat(2000) })).not.toThrow();
  });
  it("fromFields throws on out-of-enum stored values", () => {
    expect(() => incidentAdapter.fromFields({ ...incidentAdapter.toFields(inc), severity: "x" })).toThrow(TypeError);
  });
  it("uses the fieldledger app id and version 1", () => {
    expect(incidentAdapter.schema).toEqual({ app: "fieldledger", entityType: "incident", schemaVersion: 1 });
    expect(checklistItemAdapter.schema).toEqual({ app: "fieldledger", entityType: "checklistItem", schemaVersion: 1 });
  });
});
