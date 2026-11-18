import fc from "fast-check";
import { afterAll, describe, expect } from "vitest";
import type { ChecklistItem } from "../src/model/adapters.js";
import { compareItems, renormalize, sortEntries, type Entry } from "../src/model/ordering.js";
import { BATCH_SEEDS, registerBatches, RUNS_PER_BATCH, totals } from "./batches.js";

const itemArb = (id: string): fc.Arbitrary<Entry> =>
  fc
    .tuple(fc.integer({ min: 0, max: 8192 }))
    .map(([sortKey]): Entry => [id, { text: "t", done: false, sortKey, createdBy: "r", createdAt: 0 } satisfies ChecklistItem]);

// Distinct IDs (a Map keyed by ID in the app), bounded to 6; keys collide often on purpose.
const entriesArb: fc.Arbitrary<Entry[]> = fc
  .subarray(["ci-a", "ci-b", "ci-c", "ci-B", "ci-a1", "ci-z"], { minLength: 1, maxLength: 6 })
  .chain((ids) => fc.tuple(...ids.map(itemArb)));

const SUITE = "ordering";
describe("ordering properties", () => {
  afterAll(() => {
    for (const label of ["permutation-invariance", "total-order", "renormalize-preserves-order"]) {
      expect(totals.get(`${SUITE}/${label}`)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
    }
  });

  registerBatches(SUITE, "permutation-invariance", "sort result does not depend on input order", () =>
    fc.property(entriesArb, fc.nat(), (entries, rot) => {
      const rotated = [...entries.slice(rot % entries.length), ...entries.slice(0, rot % entries.length)];
      const a = sortEntries(entries).map(([id]) => id);
      expect(sortEntries(rotated).map(([id]) => id)).toEqual(a);
      expect(sortEntries([...entries].reverse()).map(([id]) => id)).toEqual(a);
    }),
  );

  registerBatches(SUITE, "total-order", "comparison is antisymmetric, transitive and total on distinct IDs", () =>
    fc.property(entriesArb, (entries) => {
      for (const x of entries) {
        for (const y of entries) {
          expect(Math.sign(compareItems(x, y))).toBe(-Math.sign(compareItems(y, x)) || 0);
          if (x[0] !== y[0]) expect(compareItems(x, y)).not.toBe(0);
          for (const z of entries) {
            if (compareItems(x, y) <= 0 && compareItems(y, z) <= 0) expect(compareItems(x, z)).toBeLessThanOrEqual(0);
          }
        }
      }
    }),
  );

  registerBatches(SUITE, "renormalize-preserves-order", "renormalize keeps the relative order and touches only changed keys", () =>
    fc.property(entriesArb, (entries) => {
      const sorted = sortEntries(entries);
      const updates = renormalize(sorted);
      const applied = sorted.map(([id, item]): Entry => [id, { ...item, sortKey: updates.get(id) ?? item.sortKey }]);
      expect(sortEntries(applied).map(([id]) => id)).toEqual(sorted.map(([id]) => id));
      for (const [id, key] of updates) expect(key).not.toBe(sorted.find(([i]) => i === id)?.[1].sortKey);
    }),
  );
});