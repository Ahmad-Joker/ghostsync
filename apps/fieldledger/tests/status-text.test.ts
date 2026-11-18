import { describe, expect, it } from "vitest";
import type { ModelDiff } from "../src/model/diff.js";
import { connectionNote, countModelDiff, importHeadline } from "../src/ui/status-text.js";

describe("connectionNote (status text from real state)", () => {
  it("says changes still save when offline in a ready workspace", () => {
    expect(connectionNote(false, "ready", "saved")).toBe("Offline · Changes still save on this device.");
    expect(connectionNote(true, "ready", "dirty")).toBe("Online · Changes save on this device.");
  });
  it("never claims a save when saving failed or a recovery is pending", () => {
    expect(connectionNote(false, "ready", "error")).toBe("Offline · Changes are NOT saved to this device.");
    expect(connectionNote(true, "recovery", "saved")).toBe("Online · Changes are NOT saved to this device.");
  });
  it("makes no save claim before an incident is open", () => {
    expect(connectionNote(true, "join", "saved")).not.toContain("save");
    expect(connectionNote(false, "in-use", "saved")).not.toContain("still save");
  });
});

describe("importHeadline", () => {
  const diff = (over: Partial<ModelDiff>): ModelDiff => ({
    addedItems: [],
    removedItems: [],
    changedItems: [],
    changedIncident: [],
    becameInvalid: [],
    noChanges: true,
    ...over,
  });
  it("counts structured diff entries", () => {
    const c = countModelDiff(
      diff({ addedItems: ["a"], changedItems: [{ id: "a", field: "text", before: "x", after: "y" }], changedIncident: [{ field: "status", before: "open", after: "resolved" }], noChanges: false }),
    );
    expect(c).toEqual({ added: 1, changes: 2, removed: 0, incomplete: 0 });
    expect(importHeadline({ added: 1, changes: 1, removed: 0, incomplete: 0 })).toBe("Imported: 1 added, 1 change");
    expect(importHeadline(c)).toBe("Imported: 1 added, 2 changes");
  });
  it("says nothing new when the diff is empty, without the words No changes", () => {
    const text = importHeadline(countModelDiff(diff({})));
    expect(text).toBe("Imported: nothing new");
    expect(text.toLowerCase()).not.toContain("no changes");
  });
});
