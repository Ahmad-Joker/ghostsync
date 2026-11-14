import fc from "fast-check";
import { afterAll, describe, expect } from "vitest";
import { createKit } from "@ghostsync/kit";
import { checklistItemAdapter } from "../src/model/adapters.js";
import { addItem, commitItemField, discardItem, moveItem } from "../src/model/write.js";
import { BATCH_SEEDS, registerBatches, RUNS_PER_BATCH, totals } from "./batches.js";

type Op =
  | { readonly k: "add"; readonly id: string; readonly text: string }
  | { readonly k: "text"; readonly id: string; readonly text: string }
  | { readonly k: "done"; readonly id: string; readonly done: boolean }
  | { readonly k: "move"; readonly id: string; readonly d: -1 | 1 }
  | { readonly k: "del"; readonly id: string };

const id = fc.constantFrom("ci-a", "ci-b", "ci-c");
const text = fc.constantFrom("t0", "t1", "t2", "t3");
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant("add" as const), id, text }),
  fc.record({ k: fc.constant("text" as const), id, text }),
  fc.record({ k: fc.constant("done" as const), id, done: fc.boolean() }),
  fc.record({ k: fc.constant("move" as const), id, d: fc.constantFrom(-1 as const, 1 as const) }),
  fc.record({ k: fc.constant("del" as const), id }),
);
const historyArb = fc.array(opArb, { minLength: 1, maxLength: 12 });

const kit = createKit();

function run(history: ReadonlyArray<Op>, replicaId: string, submitted: Set<string>) {
  const replica = kit.createReplica("inc-prop");
  const items = replica.collection(checklistItemAdapter);
  for (const op of history) {
    if (op.k === "add") {
      const g = items.getResult(op.id);
      if (!g.ok && g.reason === "absent") {
        addItem(items, op.id, op.text, replicaId, 0);
        submitted.add(op.text);
      }
    } else if (op.k === "text") {
      commitItemField(items, op.id, "text", op.text);
      submitted.add(op.text);
    } else if (op.k === "done") commitItemField(items, op.id, "done", op.done);
    else if (op.k === "move") moveItem(items, op.id, op.d);
    else discardItem(items, op.id);
  }
  return { replica, items };
}

function project(items: ReturnType<typeof run>["items"]): unknown {
  return [...items.listResults()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([i, r]) => [i, r.ok ? { ok: true, entity: r.entity } : r.reason === "invalidRecord" ? { ok: false, fields: r.fields } : { ok: false }]);
}

const SUITE = "kit-integration";
describe("kit integration properties (real Kit replicas, write helpers)", () => {
  afterAll(() => {
    for (const label of ["convergence", "surviving-values-were-submitted"]) {
      expect(totals.get(`${SUITE}/${label}`)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
    }
  });

  registerBatches(SUITE, "convergence", "two replicas converge after exchanging full updates both ways", () =>
    fc.property(historyArb, historyArb, (ha, hb) => {
      const submitted = new Set<string>();
      const a = run(ha, "ra", submitted);
      const b = run(hb, "rb", submitted);
      try {
        a.replica.applyUpdate(b.replica.exportState());
        b.replica.applyUpdate(a.replica.exportState());
        expect(project(a.items)).toEqual(project(b.items));
        expect(a.replica.getState()).toEqual(b.replica.getState());
      } finally {
        a.replica.destroy();
        b.replica.destroy();
      }
    }),
  );

  registerBatches(SUITE, "surviving-values-were-submitted", "every surviving text was submitted by some operation", () =>
    fc.property(historyArb, historyArb, (ha, hb) => {
      const submitted = new Set<string>();
      const a = run(ha, "ra", submitted);
      const b = run(hb, "rb", submitted);
      try {
        a.replica.applyUpdate(b.replica.exportState());
        for (const [, r] of a.items.listResults()) {
          if (r.ok) expect(submitted.has(r.entity.text)).toBe(true);
          else if (r.reason === "invalidRecord" && typeof r.fields.text === "string") expect(submitted.has(r.fields.text)).toBe(true);
        }
      } finally {
        a.replica.destroy();
        b.replica.destroy();
      }
    }),
  );
});