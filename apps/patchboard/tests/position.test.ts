import { describe, expect, it } from "vitest";
import { nextPosition, positionBetween, renormalizeColumn } from "../src/model/position.js";

const U = undefined;
describe("U-PB-06 position", () => {
  const table: Array<[number | undefined, number | undefined, number | undefined]> = [
    [U, U, 1024],
    [U, 2048, 1024],
    [U, 1024, 512],
    [U, 2, 1],
    [U, 1, U],
    [2048, U, 3072],
    [99_999_000, U, 99_999_500],
    [99_999_999, U, U],
    [1024, 2048, 1536],
    [1, 2, U],
    [1, 3, 2],
    [5, 5, U],
    [2048, 1024, U],
  ];
  for (const [lo, hi, want] of table) {
    it(`positionBetween(${String(lo)}, ${String(hi)}) = ${String(want)}`, () => {
      expect(positionBetween(lo, hi)).toBe(want);
    });
  }
  it("nextPosition appends after the last position", () => {
    expect(nextPosition([])).toBe(1024);
    expect(nextPosition([512, 2048])).toBe(3072);
    expect(nextPosition([99_999_999])).toBeUndefined();
  });
  it("RN-FIX-1 renormalize gives the literal placements", () => {
    const m = renormalizeColumn("todo", [
      { id: "card-p1", placement: "todo|00000001" },
      { id: "card-p3", placement: "todo|00000003" },
      { id: "card-p2", placement: "todo|00000002" },
    ]);
    expect([...m.entries()]).toEqual([
      ["card-p1", "todo|00001024"],
      ["card-p3", "todo|00002048"],
      ["card-p2", "todo|00003072"],
    ]);
  });
  it("renormalize omits cards whose placement is already right", () => {
    const m = renormalizeColumn("todo", [
      { id: "card-p1", placement: "todo|00001024" },
      { id: "card-p2", placement: "todo|00000002" },
    ]);
    expect([...m.keys()]).toEqual(["card-p2"]);
  });
});