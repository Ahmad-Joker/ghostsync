import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../src/model/adapters.js";
import { keyBetween, nextSortKey, renormalize, sortEntries, SORT_STEP, type Entry } from "../src/model/ordering.js";

const item = (text: string, sortKey: number): ChecklistItem => ({ text, done: false, sortKey, createdBy: "r", createdAt: 0 });

// ORD-FIX-1 (design 14.4.1), in SCRAMBLED insertion order.
const FIXTURE: Entry[] = [
  ["ci-c3", item("Check valve", 2048)],
  ["ci-f6", item("Sign off", 4096)],
  ["ci-a1", item("Close inlet", 2048)],
  ["ci-b2", item("Record flow", 2048)],
  ["ci-e5", item("Tag out valve", 512)],
  ["ci-B2", item("Photograph gauge", 2048)],
  ["ci-d4", item("Isolate pump", 1024)],
  ["ci-a", item("Log pressure", 2048)],
];

// Hand derivation: 512 -> ci-e5; 1024 -> ci-d4; 2048 tie by code-unit ID order after "ci-":
// "B2" < "a" < "a1" < "b2" < "c3" ("a" is a prefix of "a1"); 4096 -> ci-f6.
const ORD_BASE_EXPECTED = ["ci-e5", "ci-d4", "ci-B2", "ci-a", "ci-a1", "ci-b2", "ci-c3", "ci-f6"];
const ORD_CONCURRENT_EXPECTED = [
  "ci-e5", "ci-d4", "ci-B2", "ci-a", "ci-a1", "ci-b2", "ci-c3", "ci-f6", "ci-n1", "ci-n2",
];
const ids = (entries: ReadonlyArray<Entry>): string[] => entries.map(([id]) => id);

describe("ordering (ORD-FIX-1, literal expectations)", () => {
  it("sorts the scrambled fixture to the hand-written base sequence", () => {
    expect(ids(sortEntries(FIXTURE))).toEqual(ORD_BASE_EXPECTED);
    expect(ids(sortEntries([...FIXTURE].reverse()))).toEqual(ORD_BASE_EXPECTED);
  });

  it("two concurrent appends with equal keys tie on ID (ci-n1 before ci-n2)", () => {
    const extra: Entry[] = [
      ["ci-n2", item("A item", 5120)],
      ["ci-n1", item("B item", 5120)],
    ];
    expect(ids(sortEntries([...extra, ...FIXTURE]))).toEqual(ORD_CONCURRENT_EXPECTED);
    expect(ids(sortEntries([...FIXTURE, ...extra].reverse()))).toEqual(ORD_CONCURRENT_EXPECTED);
  });

  it("nextSortKey is max + 1024, or 1024 when empty", () => {
    expect(nextSortKey([])).toBe(1024);
    expect(nextSortKey(FIXTURE)).toBe(5120);
  });

  it("keyBetween covers all four cases", () => {
    expect(keyBetween(undefined, undefined)).toBe(1024);
    expect(keyBetween(undefined, 2048)).toBe(1024);
    expect(keyBetween(2048, undefined)).toBe(3072);
    expect(keyBetween(1024, 2048)).toBe(1536);
  });

  it("renormalize returns only entries whose key differs", () => {
    const sorted = sortEntries([
      ["ci-a", item("a", 1024)],
      ["ci-b", item("b", 1024)],
      ["ci-c", item("c", 3000)],
    ]);
    expect([...renormalize(sorted)]).toEqual([
      ["ci-b", 2048],
      ["ci-c", 3072],
    ]);
    expect(SORT_STEP).toBe(1024);
  });
});