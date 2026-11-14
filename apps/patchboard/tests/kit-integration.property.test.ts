import fc from "fast-check";
import { afterAll, describe, expect } from "vitest";
import { cardAdapter } from "../src/model/adapters.js";
import { COLUMNS } from "../src/model/placement.js";
import { addCard, commitCardFields, deleteCard, moveCard, reorderCard, type WritableCards } from "../src/model/write.js";
import { BATCH_SEEDS, RUNS_PER_BATCH, registerBatches, totals } from "./batches.js";
import { BOARD, exchange, kit, project, stored } from "./helpers.js";

type Op =
  | { readonly k: "add"; readonly id: string; readonly title: string }
  | { readonly k: "title"; readonly id: string; readonly title: string }
  | { readonly k: "move"; readonly id: string; readonly col: (typeof COLUMNS)[number] }
  | { readonly k: "reorder"; readonly id: string; readonly d: -1 | 1 }
  | { readonly k: "del"; readonly id: string };

const id = fc.constantFrom("card-a", "card-b", "card-c");
const title = fc.constantFrom("t0", "t1", "t2", "t3");
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant("add" as const), id, title }),
  fc.record({ k: fc.constant("title" as const), id, title }),
  fc.record({ k: fc.constant("move" as const), id, col: fc.constantFrom(...COLUMNS) }),
  fc.record({ k: fc.constant("reorder" as const), id, d: fc.constantFrom(-1 as const, 1 as const) }),
  fc.record({ k: fc.constant("del" as const), id }),
);
const historyArb = fc.array(opArb, { minLength: 1, maxLength: 12 });

function run(history: ReadonlyArray<Op>) {
  const replica = kit.createReplica(BOARD);
  const cards = replica.collection(cardAdapter) as WritableCards;
  for (const op of history) {
    if (op.k === "add") {
      const g = cards.getResult(op.id);
      if (!g.ok && g.reason === "absent") addCard(cards, op.id, op.title, "");
    } else if (op.k === "title") commitCardFields(cards, op.id, { title: op.title });
    else if (op.k === "move") moveCard(cards, op.id, op.col);
    else if (op.k === "reorder") reorderCard(cards, op.id, op.d);
    else deleteCard(cards, op.id);
  }
  return replica;
}

const SUITE = "kit-integration";
describe("kit integration properties (real Kit replicas, write helpers)", () => {
  afterAll(() => {
    for (const label of ["P-PB-06", "P-PB-07", "P-PB-08"]) expect(totals.get(`${SUITE}/${label}`)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
  });
  registerBatches(SUITE, "P-PB-06", "convergence under different delivery orders including duplicates", () =>
    fc.property(historyArb, historyArb, (ha, hb) => {
      const a = run(ha);
      const b = run(hb);
      const c = kit.createReplica(BOARD);
      const d = kit.createReplica(BOARD);
      try {
        const ua = a.exportState();
        const ub = b.exportState();
        c.applyUpdate(ua);
        c.applyUpdate(ub);
        c.applyUpdate(ua);
        d.applyUpdate(ub);
        d.applyUpdate(ub);
        d.applyUpdate(ua);
        expect(project(c)).toEqual(project(d));
      } finally {
        for (const r of [a, b, c, d]) r.destroy();
      }
    }),
  );
  registerBatches(SUITE, "P-PB-07", "concurrent move and edit of one card: both survive", () =>
    fc.property(fc.constantFrom("doing" as const, "done" as const), fc.string({ minLength: 1, maxLength: 20 }), fc.string({ maxLength: 30 }), (col, t, n) => {
      const a = kit.createReplica(BOARD);
      const ac = a.collection(cardAdapter) as WritableCards;
      ac.put("card-x", { title: "base title", notes: "base notes", placement: "todo|00001024" });
      const b = kit.createReplica(BOARD);
      b.applyUpdate(a.exportState());
      const bc = b.collection(cardAdapter) as WritableCards;
      try {
        moveCard(ac, "card-x", col);
        commitCardFields(bc, "card-x", { title: t, notes: n });
        exchange(a, b);
        for (const r of [a, b]) {
          const s = stored(r, "card-x");
          expect(s?.["placement"]).toBe(`${col}|00001024`);
          expect(s?.["title"]).toBe(t);
          expect(s?.["notes"]).toBe(n);
        }
        expect(project(a)).toEqual(project(b));
      } finally {
        a.destroy();
        b.destroy();
      }
    }),
  );
  registerBatches(SUITE, "P-PB-08", "concurrent moves of one card: one record, one submitted placement", () =>
    fc.property(fc.constantFrom(...COLUMNS), fc.constantFrom(...COLUMNS), (c1, c2) => {
      const a = kit.createReplica(BOARD);
      const ac = a.collection(cardAdapter) as WritableCards;
      ac.put("card-x", { title: "X", notes: "", placement: "todo|00001024" });
      const b = kit.createReplica(BOARD);
      b.applyUpdate(a.exportState());
      const bc = b.collection(cardAdapter) as WritableCards;
      try {
        moveCard(ac, "card-x", c1);
        moveCard(bc, "card-x", c2);
        exchange(a, b);
        expect(project(a)).toEqual(project(b));
        expect(project(a)).toHaveLength(1);
        const p = stored(a, "card-x")?.["placement"];
        expect([`${c1}|${c1 === "todo" ? "00001024" : "00001024"}`, `${c2}|00001024`]).toContain(p);
      } finally {
        a.destroy();
        b.destroy();
      }
    }),
  );
});