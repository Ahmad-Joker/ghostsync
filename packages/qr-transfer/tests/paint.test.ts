import { describe, expect, it } from "vitest";
import { chooseScale } from "../src/browser/paint.js";
import type { QrSymbol } from "../src/symbol.js";

const sym = (version: number): QrSymbol => ({ version, size: 4 * version + 17, modules: new Uint8Array(0) });

describe("U-QR-05b chooseScale", () => {
  it("version 25 (125 modules with the quiet zone): 625 px gives 5, 750 gives 6, 1000 gives 8, 499 gives undefined", () => {
    expect(chooseScale(1000, sym(25))).toBe(8);
    expect(chooseScale(750, sym(25))).toBe(6);
    expect(chooseScale(625, sym(25))).toBe(5);
    expect(chooseScale(624, sym(25))).toBe(4);
    expect(chooseScale(500, sym(25))).toBe(4);
    expect(chooseScale(499, sym(25))).toBeUndefined();
    expect(chooseScale(320, sym(25))).toBeUndefined();
  });
  it("small versions are capped at 8", () => {
    expect(chooseScale(5000, sym(12))).toBe(8);
  });
  it("non-finite widths draw nothing", () => {
    expect(chooseScale(Number.NaN, sym(12))).toBeUndefined();
  });
});
