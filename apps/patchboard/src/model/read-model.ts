import type { Fields, GetResult } from "@ghostsync/kit";
import type { Card } from "./adapters.js";
import { groupByColumn, toPlaced, type Placed } from "./ordering.js";
import type { ColumnId } from "./placement.js";

/** Read side of a guarded collection. listResults() is the ONLY read path used for rendering. */
export interface ReadSource {
  listResults(): ReadonlyArray<readonly [string, GetResult<Card>]>;
}

export interface InvalidRow {
  readonly id: string;
  readonly fields: Fields;
}

export interface Model {
  readonly columns: Record<ColumnId, Placed[]>;
  /** Incomplete cards ordered by ID. They belong to no column. */
  readonly invalid: ReadonlyArray<InvalidRow>;
}

export function readBoard(source: ReadSource): Model {
  const valid: Array<readonly [string, Card]> = [];
  const invalid: InvalidRow[] = [];
  for (const [id, r] of source.listResults()) {
    if (r.ok) valid.push([id, r.entity]);
    else if (r.reason === "invalidRecord") invalid.push({ id, fields: r.fields });
  }
  invalid.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { columns: groupByColumn(toPlaced(valid)), invalid };
}