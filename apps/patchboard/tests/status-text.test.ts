import { describe, expect, it } from "vitest";
import { connectionNote, countDiffLines, importHeadline } from "../src/ui/status-text.js";

describe("connectionNote (status text from real state)", () => {
  it("says changes still save when offline in a ready workspace", () => {
    expect(connectionNote(false, "ready", "saved")).toBe("Offline · Changes still save on this device.");
    expect(connectionNote(true, "ready", "dirty")).toBe("Online · Changes save on this device.");
  });
  it("never claims a save when saving failed or a recovery is pending", () => {
    expect(connectionNote(false, "ready", "error")).toBe("Offline · Changes are NOT saved to this device.");
    expect(connectionNote(true, "recovery", "saved")).toBe("Online · Changes are NOT saved to this device.");
  });
  it("makes no save claim before a board is open", () => {
    expect(connectionNote(true, "join", "saved")).not.toContain("save");
    expect(connectionNote(false, "in-use", "saved")).not.toContain("still save");
  });
});

describe("importHeadline", () => {
  it("counts added and changed lines from the diff", () => {
    const c = countDiffLines(["Added: Alpha in To do", "Title changed: A to B", "Moved: A, To do to Doing", "Removed: Gone", "Now incomplete: card-x"]);
    expect(c).toEqual({ added: 1, changes: 2, removed: 1, incomplete: 1 });
    expect(importHeadline({ added: 1, changes: 1, removed: 0, incomplete: 0 })).toBe("Imported: 1 added, 1 change");
    expect(importHeadline(c)).toBe("Imported: 1 added, 2 changes, 1 removed, 1 incomplete");
  });
  it("says nothing new when there are no lines, without the words No changes", () => {
    const text = importHeadline(countDiffLines([]));
    expect(text).toBe("Imported: nothing new");
    expect(text.toLowerCase()).not.toContain("no changes");
  });
});
