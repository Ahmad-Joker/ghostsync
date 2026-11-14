import fc from "fast-check";
import { expect, it } from "vitest";
import { reportRun } from "./fc-report.js";

/**
 * Four separately named 50-case batches per property, fixed distinct seeds, replay details
 * on failure (mirror of packages/capsule/tests/merge.property.test.ts). Not collected by Vitest.
 */
export const BATCH_SEEDS: ReadonlyArray<number> = [424242, 424243, 424244, 424245];
export const RUNS_PER_BATCH = 50;
export const totals = new Map<string, number>();

export function registerBatches<T>(
  suite: string,
  label: string,
  title: string,
  makeProperty: () => fc.IProperty<T>,
): void {
  BATCH_SEEDS.forEach((seed, i) => {
    it(`${label}: ${title} [batch ${i + 1}/${BATCH_SEEDS.length}, seed ${seed}, ${RUNS_PER_BATCH} runs]`, () => {
      const result = fc.check(makeProperty(), { numRuns: RUNS_PER_BATCH, seed });
      reportRun(`${suite} ${label} batch ${i + 1}/${BATCH_SEEDS.length}`, result, expect.fail);
      expect(result.numRuns).toBe(RUNS_PER_BATCH);
      expect(result.numSkips).toBe(0);
      totals.set(`${suite}/${label}`, (totals.get(`${suite}/${label}`) ?? 0) + result.numRuns);
    });
  });
}