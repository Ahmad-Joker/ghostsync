import { POSITION_MAX, formatPlacement, type ColumnId } from "./placement.js";

export const POSITION_STEP = 1024;

/** A position strictly between lo and hi (either may be open), or undefined when no valid integer exists. */
export function positionBetween(lo: number | undefined, hi: number | undefined): number | undefined {
  if (lo === undefined && hi === undefined) return POSITION_STEP;
  if (lo === undefined && hi !== undefined) {
    const c = hi - POSITION_STEP >= 1 ? hi - POSITION_STEP : Math.floor(hi / 2);
    return c >= 1 && c < hi ? c : undefined;
  }
  if (lo !== undefined && hi === undefined) {
    const c = lo + POSITION_STEP <= POSITION_MAX ? lo + POSITION_STEP : Math.ceil((lo + POSITION_MAX) / 2);
    return c > lo && c <= POSITION_MAX ? c : undefined;
  }
  if (lo === undefined || hi === undefined || lo >= hi) return undefined;
  const c = Math.floor((lo + hi) / 2);
  return c > lo && c < hi ? c : undefined;
}

/** Position after the last of the sorted column positions (the end of a column). */
export function nextPosition(sortedColumnPositions: ReadonlyArray<number>): number | undefined {
  return positionBetween(sortedColumnPositions[sortedColumnPositions.length - 1], undefined);
}

/** New placements (only those that differ) for `desired` in order, evenly spaced. */
export function renormalizeColumn(
  column: ColumnId,
  desired: ReadonlyArray<{ readonly id: string; readonly placement: string }>,
): Map<string, string> {
  const n = desired.length;
  const step = Math.min(POSITION_STEP, Math.floor(POSITION_MAX / (n + 1)));
  const out = new Map<string, string>();
  desired.forEach((d, i) => {
    const next = formatPlacement(column, (i + 1) * step);
    if (next !== d.placement) out.set(d.id, next);
  });
  return out;
}