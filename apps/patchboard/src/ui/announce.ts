import { COLUMN_LABEL, type ColumnId } from "../model/placement.js";

/** Titles over 40 code points are cut to 39 plus an ellipsis. */
export function shortTitle(title: string): string {
  const points = Array.from(title);
  return points.length <= 40 ? title : `${points.slice(0, 39).join("")}…`;
}

export function announceMove(title: string, column: ColumnId, position: number, total: number): string {
  return `Moved "${shortTitle(title)}" to ${COLUMN_LABEL[column]}, position ${position} of ${total}.`;
}

export function announceReorder(
  title: string,
  direction: "up" | "down",
  column: ColumnId,
  position: number,
  total: number,
): string {
  return `Moved "${shortTitle(title)}" ${direction}, position ${position} of ${total} in ${COLUMN_LABEL[column]}.`;
}

export function announceAdd(title: string, column: ColumnId, position: number, total: number): string {
  return `Added "${shortTitle(title)}" to ${COLUMN_LABEL[column]}, position ${position} of ${total}.`;
}

export function announceDelete(title: string): string {
  return `Deleted card "${shortTitle(title)}".`;
}

export interface FocusTargetInput {
  readonly sameActionEnabled: boolean;
}

/** Focus target after a move or reorder: the same-action control when it exists and is enabled, else the card. */
export function focusTarget(input: FocusTargetInput): "action" | "card" {
  return input.sameActionEnabled ? "action" : "card";
}
