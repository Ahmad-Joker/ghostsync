import type { GetResult } from "@ghostsync/kit";
import type { Card } from "./adapters.js";
import { toPlaced, sortPlaced, type Placed } from "./ordering.js";
import { formatPlacement, parsePlacement, type ColumnId } from "./placement.js";
import { nextPosition, positionBetween, renormalizeColumn } from "./position.js";

/** The slice of a guarded collection the write helpers need. */
export interface WritableCards {
  put(id: string, entity: Card): void;
  getResult(id: string): GetResult<Card>;
  listResults(): ReadonlyArray<readonly [string, GetResult<Card>]>;
  delete(id: string): void;
}

export type WriteOutcome = "ok" | "noop" | "absent" | "invalid";

function validCards(cards: WritableCards): Placed[] {
  const out: Array<readonly [string, Card]> = [];
  for (const [id, r] of cards.listResults()) if (r.ok) out.push([id, r.entity]);
  return toPlaced(out);
}

function columnCards(cards: WritableCards, column: ColumnId): Placed[] {
  return sortPlaced(validCards(cards).filter((p) => p.column === column));
}

/** Write each new placement on top of the CURRENT stored card (placement only). */
function applyPlacements(cards: WritableCards, writes: ReadonlyMap<string, string>): void {
  for (const [cid, placement] of writes) {
    const cur = cards.getResult(cid);
    if (cur.ok) cards.put(cid, { ...cur.entity, placement });
  }
}

export function addCard(cards: WritableCards, id: string, title: string, notes: string): WriteOutcome {
  const todo = columnCards(cards, "todo");
  let position = nextPosition(todo.map((p) => p.position));
  if (position === undefined) {
    applyPlacements(cards, renormalizeColumn("todo", todo.map((p) => ({ id: p.id, placement: p.card.placement }))));
    position = nextPosition(columnCards(cards, "todo").map((p) => p.position));
  }
  if (position === undefined) return "invalid";
  cards.put(id, { title, notes, placement: formatPlacement("todo", position) });
  return "ok";
}

/** Reads the CURRENT stored card, changes only the touched title/notes fields. Never writes placement. */
export function commitCardFields(
  cards: WritableCards,
  id: string,
  changes: { readonly title?: string; readonly notes?: string },
): WriteOutcome {
  const r = cards.getResult(id);
  if (!r.ok) return r.reason === "absent" ? "absent" : "invalid";
  const next: Card = {
    ...r.entity,
    ...(changes.title !== undefined ? { title: changes.title } : {}),
    ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
  };
  if (next.title === r.entity.title && next.notes === r.entity.notes) return "noop";
  cards.put(id, next);
  return "ok";
}

/** Move to the END of `column`. Reads the CURRENT stored card; writes placement only. */
export function moveCard(cards: WritableCards, id: string, column: ColumnId): WriteOutcome {
  const r = cards.getResult(id);
  if (!r.ok) return r.reason === "absent" ? "absent" : "invalid";
  const cur = parsePlacement(r.entity.placement);
  if (cur === undefined) return "invalid";
  if (cur.column === column) return "noop";
  const dest = columnCards(cards, column);
  const p = nextPosition(dest.map((d) => d.position));
  if (p !== undefined) {
    cards.put(id, { ...r.entity, placement: formatPlacement(column, p) });
    return "ok";
  }
  const desired = [
    ...dest.map((d) => ({ id: d.id, placement: d.card.placement })),
    { id, placement: r.entity.placement },
  ];
  applyPlacements(cards, renormalizeColumn(column, desired));
  return "ok";
}

/** Move one step inside the column. Reads the CURRENT stored card; writes placement only. */
export function reorderCard(cards: WritableCards, id: string, delta: -1 | 1): WriteOutcome {
  const r = cards.getResult(id);
  if (!r.ok) return r.reason === "absent" ? "absent" : "invalid";
  const cur = parsePlacement(r.entity.placement);
  if (cur === undefined) return "invalid";
  const sorted = columnCards(cards, cur.column);
  const from = sorted.findIndex((p) => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sorted.length) return "noop";
  const desired = [...sorted];
  const [moved] = desired.splice(from, 1);
  if (moved === undefined) return "invalid";
  desired.splice(to, 0, moved);
  const c = positionBetween(desired[to - 1]?.position, desired[to + 1]?.position);
  if (c !== undefined) {
    cards.put(id, { ...r.entity, placement: formatPlacement(cur.column, c) });
    return "ok";
  }
  applyPlacements(
    cards,
    renormalizeColumn(cur.column, desired.map((p) => ({ id: p.id, placement: p.card.placement }))),
  );
  return "ok";
}

export function deleteCard(cards: WritableCards, id: string): void {
  cards.delete(id);
}

/** Explicit repair of an incomplete card with documented fallbacks. Unknown fields are removed by the Kit. */
export function restoreCard(cards: WritableCards, id: string, endPosition: () => number | undefined): WriteOutcome {
  const r = cards.getResult(id);
  if (r.ok) return "noop";
  if (r.reason === "absent") return "absent";
  const f = r.fields;
  const title = typeof f["title"] === "string" && f["title"].length >= 1 && f["title"].length <= 120 ? f["title"] : "Untitled card";
  const notes = typeof f["notes"] === "string" && f["notes"].length <= 2000 ? f["notes"] : "";
  let placement: string;
  const stored = f["placement"];
  if (typeof stored === "string" && parsePlacement(stored) !== undefined) {
    placement = stored;
  } else {
    let p = endPosition();
    if (p === undefined) {
      const todo = columnCards(cards, "todo");
      applyPlacements(cards, renormalizeColumn("todo", todo.map((t) => ({ id: t.id, placement: t.card.placement }))));
      p = endPosition();
    }
    if (p === undefined) return "invalid";
    placement = formatPlacement("todo", p);
  }
  cards.put(id, { title, notes, placement });
  return "ok";
}