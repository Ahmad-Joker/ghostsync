import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";

import { createKit } from "@ghostsync/kit";
import type { Replica, Scalar } from "@ghostsync/kit";

import { importCapsuleInto } from "../src/index.js";
import { reportRun } from "./fc-report.js";
import { APP, DOC, capsuleOf } from "./helpers.js";

type Op =
  | { readonly kind: "set"; readonly key: string; readonly value: Scalar }
  | { readonly kind: "delete"; readonly key: string };

const scalarArb: fc.Arbitrary<Scalar> = fc.oneof(
  fc.string({ maxLength: 6 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.boolean(),
  fc.constant(null),
);

// Bounded generators over a tiny key space so key collisions/deletions are common.
const historyArb: fc.Arbitrary<ReadonlyArray<Op>> = fc.array(
  fc.oneof(
    fc.record({ kind: fc.constant("set" as const), key: fc.constantFrom("k0", "k1", "k2"), value: scalarArb }),
    fc.record({ kind: fc.constant("delete" as const), key: fc.constantFrom("k0", "k1", "k2") }),
  ),
  { minLength: 1, maxLength: 6 },
);

// One Kit per file (as in the Kit's own property tests); every replica a run
// creates is tracked and destroyed when the run ends, so 200 runs do not pile
// up live Y.Docs. Each source capsule is encoded once per run and reused.
const kit = createKit();
const live: Replica[] = [];

function fresh(): Replica {
  const r = kit.createReplica(DOC);
  live.push(r);
  return r;
}

function destroyAll(): void {
  for (const r of live.splice(0)) r.destroy();
}

function build(history: ReadonlyArray<Op>): Replica {
  const r = fresh();
  for (const op of history) {
    if (op.kind === "set") r.set(op.key, op.value);
    else r.delete(op.key);
  }
  return r;
}

async function viaCapsule(target: Replica, capsule: Uint8Array): Promise<void> {
  await importCapsuleInto(target, capsule, { app: APP });
}

/** Direct Kit reference: raw full-state updates, no capsule. */
function reference(...sources: Replica[]): Record<string, Scalar> {
  const ref = fresh();
  for (const s of sources) ref.applyUpdate(s.exportState());
  return ref.getState();
}

// Each property is 4 batches x 50 runs = 200 cases. Seeds are fixed constants,
// distinct per batch, and the same four are reused by all three properties.
// Explicit per-call numRuns/seed override the global config in vitest.setup.ts.
const BATCH_SEEDS: ReadonlyArray<number> = [424242, 424243, 424244, 424245];
const RUNS_PER_BATCH = 50;
const totals = new Map<string, number>();

function registerBatches<T>(label: string, title: string, makeProperty: () => fc.IAsyncProperty<T>): void {
  BATCH_SEEDS.forEach((seed, i) => {
    it(`${label}: ${title} [batch ${i + 1}/${BATCH_SEEDS.length}, seed ${seed}, ${RUNS_PER_BATCH} runs]`, async () => {
      const result = await fc.check(makeProperty(), { numRuns: RUNS_PER_BATCH, seed });
      reportRun(`capsule ${label} batch ${i + 1}/${BATCH_SEEDS.length}`, result, expect.fail);
      expect(result.numRuns).toBe(RUNS_PER_BATCH);
      expect(result.numSkips).toBe(0);
      totals.set(label, (totals.get(label) ?? 0) + result.numRuns);
    });
  });
}
describe("merge invariants over capsule-wrapped updates (vs a direct Kit reference)", () => {
  afterAll(() => {
    for (const label of ["commutativity", "associativity", "idempotency"]) {
      expect(totals.get(label)).toBe(BATCH_SEEDS.length * RUNS_PER_BATCH);
    }
  });

  registerBatches("commutativity", "import order does not matter", () =>
      fc.asyncProperty(historyArb, historyArb, async (ha, hb) => {
        try {
          const x = build(ha);
          const y = build(hb);
          const cx = await capsuleOf(x);
          const cy = await capsuleOf(y);
          const xy = fresh();
          const yx = fresh();
          await viaCapsule(xy, cx);
          await viaCapsule(xy, cy);
          await viaCapsule(yx, cy);
          await viaCapsule(yx, cx);
          expect(xy.getState()).toEqual(yx.getState());
          expect(xy.getState()).toEqual(reference(x, y));
          return true;
        } finally {
          destroyAll();
        }
      }),
    );

  registerBatches("associativity", "(X+Y)+Z equals X+(Y+Z) with grouped re-import", () =>
      fc.asyncProperty(historyArb, historyArb, historyArb, async (ha, hb, hc) => {
        try {
          const x = build(ha);
          const y = build(hb);
          const z = build(hc);
          const cx = await capsuleOf(x);
          const cy = await capsuleOf(y);
          const cz = await capsuleOf(z);

          const xy = fresh();
          await viaCapsule(xy, cx);
          await viaCapsule(xy, cy);
          const left = fresh();
          await viaCapsule(left, await capsuleOf(xy));
          await viaCapsule(left, cz);

          const yz = fresh();
          await viaCapsule(yz, cy);
          await viaCapsule(yz, cz);
          const right = fresh();
          await viaCapsule(right, cx);
          await viaCapsule(right, await capsuleOf(yz));

          expect(left.getState()).toEqual(right.getState());
          expect(left.getState()).toEqual(reference(x, y, z));
          return true;
        } finally {
          destroyAll();
        }
      }),
    );

  registerBatches("idempotency", "importing the same capsule again changes nothing", () =>
      fc.asyncProperty(historyArb, historyArb, async (ha, hb) => {
        try {
          const x = build(ha);
          const own = build(hb);
          const cap = await capsuleOf(x);
          const once = fresh();
          await viaCapsule(once, await capsuleOf(own));
          await viaCapsule(once, cap);
          const afterOnce = once.getState();
          await importCapsuleInto(once, cap, { app: APP });
          await importCapsuleInto(once, cap, { app: APP });
          expect(once.getState()).toEqual(afterOnce);
          expect(afterOnce).toEqual(reference(own, x));
          return true;
        } finally {
          destroyAll();
        }
      }),
    );
});
