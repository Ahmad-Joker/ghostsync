import { COLUMNS, COLUMN_LABEL } from "./placement.js";
import type { Placed } from "./ordering.js";
import type { Model } from "./read-model.js";

const cap = (s: string): string => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

function flat(m: Model): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const c of COLUMNS) for (const p of m.columns[c]) out.set(p.id, p);
  return out;
}

/** Human-readable change lines between two boards read with listResults(). Empty means no changes. */
export function diffBoards(before: Model, after: Model): string[] {
  const b = flat(before);
  const a = flat(after);
  const invalidAfter = new Set(after.invalid.map((r) => r.id));
  const lines: string[] = [];
  for (const [id, n] of a) {
    const o = b.get(id);
    if (o === undefined) {
      lines.push(`Added: ${cap(n.card.title)} in ${COLUMN_LABEL[n.column]}`);
      continue;
    }
    if (o.card.title !== n.card.title) lines.push(`Title changed: ${cap(o.card.title)} to ${cap(n.card.title)}`);
    if (o.card.notes !== n.card.notes) lines.push(`Notes changed: ${cap(n.card.title)}`);
    if (o.column !== n.column) {
      lines.push(`Moved: ${cap(n.card.title)}, ${COLUMN_LABEL[o.column]} to ${COLUMN_LABEL[n.column]}`);
    } else if (o.position !== n.position) {
      lines.push(`Reordered: ${cap(n.card.title)} in ${COLUMN_LABEL[n.column]}`);
    }
  }
  for (const [id, o] of b) {
    if (a.has(id)) continue;
    if (invalidAfter.has(id)) lines.push(`Now incomplete: ${cap(id)}`);
    else lines.push(`Removed: ${cap(o.card.title)}`);
  }
  return lines;
}