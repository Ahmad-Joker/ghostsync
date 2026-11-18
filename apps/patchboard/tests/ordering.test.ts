import { describe, expect, it } from "vitest";
import { groupByColumn, toPlaced } from "../src/model/ordering.js";
import {
  ORD_DOING_EXPECTED,
  ORD_DONE_EXPECTED,
  ORD_FIXTURE,
  ORD_TODO_CONCURRENT_EXPECTED,
  ORD_TODO_EXPECTED,
} from "./fixtures.js";

const ids = (l: ReadonlyArray<{ id: string }>): string[] => l.map((p) => p.id);

describe("U-PB-07 ordering (ORD-FIX-PB-1)", () => {
  for (const [name, entries] of [
    ["scrambled", ORD_FIXTURE],
    ["reversed", [...ORD_FIXTURE].reverse()],
  ] as const) {
    it(`${name} input gives the hand-written literals`, () => {
      const g = groupByColumn(toPlaced(entries));
      expect(ids(g.todo)).toEqual(ORD_TODO_EXPECTED);
      expect(ids(g.doing)).toEqual(ORD_DOING_EXPECTED);
      expect(ids(g.done)).toEqual(ORD_DONE_EXPECTED);
    });
  }
  it("concurrent inserts with equal positions are ordered by card ID", () => {
    const extra = [
      ["card-n2", { title: "Concurrent B", notes: "", placement: "todo|00003072" }],
      ["card-n1", { title: "Concurrent A", notes: "", placement: "todo|00003072" }],
    ] as const;
    expect(ids(groupByColumn(toPlaced([...ORD_FIXTURE, ...extra])).todo)).toEqual(ORD_TODO_CONCURRENT_EXPECTED);
    expect(ids(groupByColumn(toPlaced([...extra, ...[...ORD_FIXTURE].reverse()])).todo)).toEqual(ORD_TODO_CONCURRENT_EXPECTED);
  });
});