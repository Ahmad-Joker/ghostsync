import fc from "fast-check";
import { afterAll, describe, expect } from "vitest";
import { COLUMNS, POSITION_MAX, formatPlacement, parsePlacement } from "../src/model/placement.js";
import { BATCH_SEEDS, RUNS_PER_BATCH, registerBatches, totals } from "./batches.js";

const SUITE = "placement";
describe("P-PB-01 placement properties", () => {
  afterAll(() => {
    expect(totals.get(`${SUITE}/P-PB-01`)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
  });
  registerBatches(SUITE, "P-PB-01", "format/parse round trip; every other string is rejected", () =>
    fc.property(
      fc.constantFrom(...COLUMNS),
      fc.integer({ min: 1, max: POSITION_MAX }),
      fc.oneof(fc.string(), fc.string().map((s) => `todo|${s}`), fc.nat(99_999_999).map((n) => `doing|${String(n).padStart(8, "0")}`)),
      (column, position, s) => {
        const f = formatPlacement(column, position);
        expect(f).toMatch(/^(todo|doing|done)\|\d{8}$/);
        expect(parsePlacement(f)).toEqual({ column, position });
        const p = parsePlacement(s);
        const shouldParse = /^(todo|doing|done)\|\d{8}$/.test(s) && !s.endsWith("|00000000");
        expect(p !== undefined).toBe(shouldParse);
        if (p !== undefined) expect(formatPlacement(p.column, p.position)).toBe(s);
      },
    ),
  );
});