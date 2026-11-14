export const COLUMNS = ["todo", "doing", "done"] as const;
export type ColumnId = (typeof COLUMNS)[number];
export const COLUMN_LABEL: Record<ColumnId, string> = { todo: "To do", doing: "Doing", done: "Done" };

export const POSITION_MIN = 1;
export const POSITION_MAX = 99_999_999;

export interface ParsedPlacement {
  readonly column: ColumnId;
  readonly position: number;
}

const PLACEMENT_RE = /^(todo|doing|done)\|(\d{8})$/;

/** "<column>|<8-digit position>", e.g. `doing|00001024`. Throws RangeError outside 1..99_999_999. */
export function formatPlacement(column: ColumnId, position: number): string {
  if (!Number.isInteger(position) || position < POSITION_MIN || position > POSITION_MAX) {
    throw new RangeError(`position must be an integer from ${POSITION_MIN} to ${POSITION_MAX}`);
  }
  return `${column}|${String(position).padStart(8, "0")}`;
}

export function parsePlacement(value: string): ParsedPlacement | undefined {
  const m = PLACEMENT_RE.exec(value);
  if (m === null) return undefined;
  const column = m[1] as ColumnId;
  const position = Number.parseInt(m[2] ?? "", 10);
  if (position < POSITION_MIN) return undefined;
  return { column, position };
}