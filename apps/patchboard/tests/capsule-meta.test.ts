import { describe, expect, it } from "vitest";
import { capMetaValue, META_VALUE_MAX, metaLines } from "../src/transfer/capsule-meta.js";

describe("U-PB-15 capMetaValue", () => {
  it("keeps 80 code points, cuts 81 and more to 79 plus an ellipsis", () => {
    expect(META_VALUE_MAX).toBe(80);
    const v80 = "a".repeat(80);
    expect(capMetaValue(v80)).toBe(v80);
    expect(capMetaValue("a".repeat(81))).toBe(`${"a".repeat(79)}\u2026`);
    expect(Array.from(capMetaValue("b".repeat(5000)))).toHaveLength(80);
  });
  it("never splits a surrogate pair", () => {
    const emoji = "\u{1F600}";
    expect(Array.from(capMetaValue(emoji.repeat(81)))).toHaveLength(80);
    expect(capMetaValue(emoji.repeat(81))).toBe(`${emoji.repeat(79)}\u2026`);
    expect(capMetaValue(emoji.repeat(80))).toBe(emoji.repeat(80));
  });
  it("keeps hostile text as is and handles empty or undefined", () => {
    const html = '<img src=x onerror="alert(1)">';
    expect(capMetaValue(html)).toBe(html);
    expect(capMetaValue("")).toBe("");
    expect(capMetaValue(undefined)).toBe("");
  });
  it("metaLines gives three labelled lines, none without metadata", () => {
    const lines = metaLines({ app: "patchboard", documentId: "sprint-board", createdAt: "x".repeat(100) });
    expect(lines.map((l) => [l.testId, l.label])).toEqual([
      ["import-meta-app", "Capsule app"],
      ["import-meta-document-id", "Document"],
      ["import-meta-created-at", "Created"],
    ]);
    expect(lines[2]?.value).toBe(`${"x".repeat(79)}\u2026`);
    expect(metaLines(undefined)).toEqual([]);
  });
});