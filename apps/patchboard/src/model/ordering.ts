import type { Card } from "./adapters.js";
import { COLUMNS, parsePlacement, type ColumnId } from "./placement.js";

export interface Placed {
  readonly id: string;
  readonly card: Card;
  readonly column: ColumnId;
  readonly position: number;
}

/** Parse each valid card's placement. Entries whose placement does not parse are skipped (the adapter prevents them). */
export function toPlaced(entries: ReadonlyArray<readonly [string, Card]>): Placed[] {
  const out: Placed[] = [];
  for (const [id, card] of entries) {
    const p = parsePlacement(card.placement);
    if (p !== undefined) out.push({ id, card, column: p.column, position: p.position });
  }
  return out;
}

/** Position ascending, then card ID in code-unit order (not localeCompare). */
export function compareCards(a: Placed, b: Placed): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortPlaced(items: ReadonlyArray<Placed>): Placed[] {
  return [...items].sort(compareCards);
}

export function groupByColumn(items: ReadonlyArray<Placed>): Record<ColumnId, Placed[]> {
  const out: Record<ColumnId, Placed[]> = { todo: [], doing: [], done: [] };
  for (const c of COLUMNS) out[c] = sortPlaced(items.filter((i) => i.column === c));
  return out;
}