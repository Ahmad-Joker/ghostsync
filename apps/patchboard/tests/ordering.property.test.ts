import fc from "fast-check";
import { afterAll, describe, expect } from "vitest";
import type { Card } from "../src/model/adapters.js";
import { groupByColumn, toPlaced } from "../src/model/ordering.js";
import { COLUMNS, POSITION_MAX, formatPlacement, parsePlacement } from "../src/model/placement.js";
import { renormalizeColumn } from "../src/model/position.js";
import { BATCH_SEEDS, RUNS_PER_BATCH, registerBatches, totals } from "./batches.js";

const SUITE = "ordering";
type Entry = readonly [string, Card];
const entryArb: fc.Arbitrary<Entry> = fc
  .tuple(
    fc.constantFrom("card-a", "card-B", "card-b", "card-c1", "card-c2", "card-d", "card-e", "card-f"),
    fc.constantFrom(...COLUMNS),
    fc.constantFrom(1, 2, 512, 1024, 2048, POSITION_MAX),
  )
  .map(([id, col, pos]) => [id, { title: id, notes: "", placement: formatPlacement(col, pos) }] as const);
// Unique ids (a record id appears once in the store).
const entriesArb = fc.array(entryArb, { maxLength: 16 }).map((l) => [...new Map(l.map((e) => [e[0], e] as const)).values()]);
const key = (g: ReturnType<typeof groupByColumn>): string[][] => COLUMNS.map((c) => g[c].map((p) => p.id));

describe("ordering properties", () => {
  afterAll(() => {
    for (const label of ["P-PB-03", "P-PB-04", "P-PB-05"]) expect(totals.get(`${SUITE}/${label}`)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
  });
  registerBatches(SUITE, "P-PB-03", "groupByColumn is invariant under input permutation", () =>
    fc.property(entriesArb, fc.nat(), (entries, rot) => {
      const k = entries.length === 0 ? 0 : rot % entries.length;
      const permuted = [...entries.slice(k), ...entries.slice(0, k)].reverse();
      expect(key(groupByColumn(toPlaced(permuted)))).toEqual(key(groupByColumn(toPlaced(entries))));
    }),
  );
  registerBatches(SUITE, "P-PB-04", "total order with ID tie-break and every card in exactly one column", () =>
    fc.property(entriesArb, (entries) => {
      const g = groupByColumn(toPlaced(entries));
      const all: string[] = [];
      for (const c of COLUMNS) {
        const list = g[c];
        for (let i = 1; i < list.length; i++) {
          const a = list[i - 1];
          const b = list[i];
          if (a === undefined || b === undefined) continue;
          expect(a.position < b.position || (a.position === b.position && a.id < b.id)).toBe(true);
        }
        all.push(...list.map((p) => p.id));
      }
      expect([...all].sort()).toEqual(entries.map((e) => e[0]).sort());
    }),
  );
  registerBatches(SUITE, "P-PB-05", "renormalizeColumn keeps order and column and emits only valid placements", () =>
    fc.property(fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h"), { maxLength: 8 }), fc.constantFrom(...COLUMNS), (idList, column) => {
      const desired = idList.map((id, i) => ({ id, placement: formatPlacement(column, (i % 3) + 1) }));
      const writes = renormalizeColumn(column, desired);
      const finalPlacements = desired.map((d) => writes.get(d.id) ?? d.placement);
      const parsed = finalPlacements.map((p) => parsePlacement(p));
      parsed.forEach((p, i) => {
        expect(p).toBeDefined();
        expect(p?.column).toBe(column);
        const prev = parsed[i - 1];
        if (prev !== undefined && p !== undefined) expect(p.position).toBeGreaterThan(prev.position);
      });
      for (const [id, placement] of writes) {
        expect(desired.some((d) => d.id === id)).toBe(true);
        expect(parsePlacement(placement)).toBeDefined();
      }
    }),
  );
});