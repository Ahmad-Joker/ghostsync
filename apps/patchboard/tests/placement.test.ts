import { describe, expect, it } from "vitest";
import { formatPlacement, parsePlacement } from "../src/model/placement.js";

describe("U-PB-04 placement", () => {
  it("formats and parses the literal", () => {
    expect(formatPlacement("doing", 1024)).toBe("doing|00001024");
    expect(parsePlacement("doing|00001024")).toEqual({ column: "doing", position: 1024 });
    expect(formatPlacement("todo", 1)).toBe("todo|00000001");
    expect(formatPlacement("done", 99_999_999)).toBe("done|99999999");
  });
  it("rejects out-of-range positions when formatting", () => {
    expect(() => formatPlacement("todo", 0)).toThrow(RangeError);
    expect(() => formatPlacement("todo", 100_000_000)).toThrow(RangeError);
    expect(() => formatPlacement("todo", 1.5)).toThrow(RangeError);
  });
  it("rejects every invalid string", () => {
    for (const bad of ["Doing|00001024", " doing|00001024", "doing|0001024", "doing|000010240", "doing|00000000", "archive|00001024", "doing|00001024|x", ""]) {
      expect(parsePlacement(bad), bad).toBeUndefined();
    }
  });
});