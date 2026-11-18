import { createKit, type EntityAdapter, type Fields, type Replica } from "@ghostsync/kit";
import { expect } from "vitest";
import { cardAdapter, type Card } from "../src/model/adapters.js";
import type { WritableCards } from "../src/model/write.js";

/** Reads and writes RAW stored fields (including incomplete cards) with the card's schema identity. */
export const probeAdapter: EntityAdapter<Fields> = {
  schema: cardAdapter.schema,
  validate(): void {
    /* accepts anything */
  },
  toFields(e: Fields): Fields {
    return { ...e };
  },
  fromFields(f: Fields): Fields {
    return { ...f };
  },
};

export const kit = createKit();

export function stored(replica: Replica, id: string): Fields | undefined {
  const r = replica.collection(probeAdapter).getResult(id);
  return r.ok ? r.entity : undefined;
}

export function writtenFields(before: Fields, after: Fields): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k] || k in before !== k in after).sort();
}

export function assertStaleSafe(before: Fields, after: Fields, expected: string[], keep: Fields): void {
  expect(writtenFields(before, after)).toEqual(expected);
  for (const [k, v] of Object.entries(keep)) expect(after[k]).toBe(v);
}

export function exchange(a: Replica, b: Replica): void {
  a.applyUpdate(b.exportState());
  b.applyUpdate(a.exportState());
}

export type Shape = { kind: "absent" } | { kind: "valid"; card: Card } | { kind: "invalid"; fields: Fields };

/** Sorted, cause-free projection of a replica's cards for deep equality. */
export function project(replica: Replica): Array<[string, Shape]> {
  const out: Array<[string, Shape]> = [];
  for (const [id, r] of replica.collection(cardAdapter).listResults()) {
    out.push([id, r.ok ? { kind: "valid", card: r.entity } : r.reason === "invalidRecord" ? { kind: "invalid", fields: r.fields } : { kind: "absent" }]);
  }
  return out.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

export function shapeOf(replica: Replica, id: string): Shape {
  return project(replica).find(([i]) => i === id)?.[1] ?? { kind: "absent" };
}

export const BOARD = "test-board";