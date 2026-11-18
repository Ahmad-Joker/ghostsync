import type { ChecklistItem } from "./adapters.js";

export type Entry = readonly [string, ChecklistItem];

/** Ascending sortKey, then item ID in code-unit order (AC-FL-005-2). */
export function compareItems(a: Entry, b: Entry): number {
  if (a[1].sortKey !== b[1].sortKey) return a[1].sortKey < b[1].sortKey ? -1 : 1;
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Sorted copy; independent of input order. */
export function sortEntries(entries: ReadonlyArray<Entry>): Entry[] {
  return [...entries].sort(compareItems);
}

export const SORT_STEP = 1024;

export function nextSortKey(sorted: ReadonlyArray<Entry>): number {
  let max: number | undefined;
  for (const [, item] of sorted) {
    if (max === undefined || item.sortKey > max) max = item.sortKey;
  }
  return max === undefined ? SORT_STEP : max + SORT_STEP;
}

export function keyBetween(lo: number | undefined, hi: number | undefined): number {
  if (lo === undefined && hi === undefined) return SORT_STEP;
  if (lo === undefined) return (hi as number) - SORT_STEP;
  if (hi === undefined) return lo + SORT_STEP;
  return (lo + hi) / 2;
}

/** New sortKeys (index + 1) * 1024 for entries whose key differs. */
export function renormalize(sorted: ReadonlyArray<Entry>): Map<string, number> {
  const out = new Map<string, number>();
  sorted.forEach(([id, item], index) => {
    const key = (index + 1) * SORT_STEP;
    if (item.sortKey !== key) out.set(id, key);
  });
  return out;
}
