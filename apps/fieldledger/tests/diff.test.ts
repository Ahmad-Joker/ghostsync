import { describe, expect, it } from "vitest";
import type { ChecklistItem, IncidentDetails } from "../src/model/adapters.js";
import { diffModels } from "../src/model/diff.js";
import type { Model } from "../src/model/read-model.js";

const it1 = (text: string, done = false, sortKey = 1024): ChecklistItem => ({ text, done, sortKey, createdBy: "r", createdAt: 0 });
const inc = (title: string): IncidentDetails => ({ title, location: "", severity: "medium", status: "open", notes: "" });
const model = (items: Array<[string, ChecklistItem]>, title?: string, invalid: Model["invalid"] = []): Model => ({
  incident: title === undefined ? { kind: "absent" } : { kind: "ok", value: inc(title) },
  items,
  invalid,
});

describe("diffModels", () => {
  it("reports no changes for equal models", () => {
    const m = model([["a", it1("x")]], "T");
    expect(diffModels(m, m).noChanges).toBe(true);
  });
  it("reports added, removed and changed items and incident fields", () => {
    const before = model([["a", it1("x")], ["b", it1("y")]], "T1");
    const after = model([["a", it1("x2", true)], ["c", it1("z")]], "T2");
    const d = diffModels(before, after);
    expect(d.addedItems).toEqual(["c"]);
    expect(d.removedItems).toEqual(["b"]);
    expect(d.changedItems.map((c) => [c.id, c.field])).toEqual([["a", "text"], ["a", "done"]]);
    expect(d.changedIncident).toEqual([{ field: "title", before: "T1", after: "T2" }]);
    expect(d.noChanges).toBe(false);
  });
  it("reports items that became invalid, not as removed", () => {
    const d = diffModels(model([["a", it1("x")]]), model([], undefined, [{ id: "a", fields: { text: "x" } }]));
    expect(d.becameInvalid).toEqual(["a"]);
    expect(d.removedItems).toEqual([]);
  });
});
