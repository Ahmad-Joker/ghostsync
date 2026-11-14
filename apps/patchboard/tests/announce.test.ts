import { describe, expect, it } from "vitest";
import { announceAdd, announceDelete, announceMove, announceReorder, focusTarget, shortTitle } from "../src/ui/announce.js";

describe("U-PB-19 announcements", () => {
  it("has the literal texts", () => {
    expect(announceMove("Alpha", "doing", 1, 1)).toBe('Moved "Alpha" to Doing, position 1 of 1.');
    expect(announceReorder("Alpha", "down", "todo", 2, 3)).toBe('Moved "Alpha" down, position 2 of 3 in To do.');
    expect(announceAdd("Alpha", "todo", 1, 1)).toBe('Added "Alpha" to To do, position 1 of 1.');
    expect(announceDelete("Gamma")).toBe('Deleted card "Gamma".');
  });
  it("cuts titles over 40 code points to 39 plus an ellipsis", () => {
    expect(shortTitle("a".repeat(40))).toBe("a".repeat(40));
    expect(shortTitle("a".repeat(41))).toBe(`${"a".repeat(39)}\u2026`);
  });
  it("focus goes to the same-action control when enabled, else the card", () => {
    expect(focusTarget({ sameActionEnabled: true })).toBe("action");
    expect(focusTarget({ sameActionEnabled: false })).toBe("card");
  });
});