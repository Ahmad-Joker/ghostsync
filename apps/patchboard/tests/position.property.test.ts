import fc from "fast-check";
import { afterAll, describe, expect } from "vitest";
import { POSITION_MAX } from "../src/model/placement.js";
import { positionBetween } from "../src/model/position.js";
import { BATCH_SEEDS, RUNS_PER_BATCH, registerBatches, totals } from "./batches.js";

const SUITE = "position";
const pos = fc.integer({ min: 1, max: POSITION_MAX });
const near = fc.integer({ min: 1, max: 12 });

describe("P-PB-02 positionBetween", () => {
  afterAll(() => {
    expect(totals.get(`${SUITE}/P-PB-02`)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
  });
  registerBatches(SUITE, "P-PB-02", "integer strictly between, undefined only when none exists", () =>
    fc.property(fc.option(fc.oneof(pos, near), { nil: undefined }), fc.option(fc.oneof(pos, near, fc.integer({ min: POSITION_MAX - 12, max: POSITION_MAX })), { nil: undefined }), (lo, hi) => {
      const c = positionBetween(lo, hi);
      if (c !== undefined) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(POSITION_MAX);
        if (lo !== undefined) expect(c).toBeGreaterThan(lo);
        if (hi !== undefined) expect(c).toBeLessThan(hi);
        return;
      }
      if (lo !== undefined && hi !== undefined) expect(hi - lo < 2).toBe(true);
      else if (hi !== undefined) expect(hi).toBe(1);
      else if (lo !== undefined) expect(lo).toBe(POSITION_MAX);
    }),
  );
});