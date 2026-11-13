import { describe, expect, it } from "vitest";

import { importCapsuleInto } from "../src/index.js";
import { APP, DOC, capsuleOf, replicaWith } from "./helpers.js";

describe("AC-CAP-007 convergence", () => {
  it("duplicate import is a no-op", async () => {
    const a = replicaWith(DOC, { k: 1, j: "two" });
    const cap = await capsuleOf(a);
    const b = replicaWith(DOC, { own: true });
    const first = await importCapsuleInto(b, cap, { app: APP });
    const afterFirst = b.getState();
    const second = await importCapsuleInto(b, cap, { app: APP });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    expect(b.getState()).toEqual(afterFirst);
    expect(afterFirst).toEqual({ k: 1, j: "two", own: true });
  });

  it("bidirectional exchange converges, including a conflicting key", async () => {
    const a = replicaWith(DOC, { shared: "from-a", onlyA: 1 });
    const b = replicaWith(DOC, { shared: "from-b", onlyB: 2 });
    const capA = await capsuleOf(a);
    const capB = await capsuleOf(b);
    await importCapsuleInto(a, capB, { app: APP });
    await importCapsuleInto(b, capA, { app: APP });
    expect(a.getState()).toEqual(b.getState());
    expect(Object.keys(a.getState()).sort()).toEqual(["onlyA", "onlyB", "shared"]);
    // A second round (duplicates in the other order) changes nothing.
    const settled = a.getState();
    await importCapsuleInto(a, capB, { app: APP });
    await importCapsuleInto(b, capA, { app: APP });
    expect(a.getState()).toEqual(settled);
    expect(b.getState()).toEqual(settled);
  });

  it("out-of-order arrival of successive full-state capsules converges", async () => {
    const a = replicaWith(DOC, { v: 1 });
    const early = await capsuleOf(a);
    a.set("v", 2);
    a.set("w", "late");
    const late = await capsuleOf(a);

    const forward = replicaWith(DOC);
    await importCapsuleInto(forward, early, { app: APP });
    await importCapsuleInto(forward, late, { app: APP });
    const reverse = replicaWith(DOC);
    await importCapsuleInto(reverse, late, { app: APP });
    await importCapsuleInto(reverse, early, { app: APP });
    expect(forward.getState()).toEqual(a.getState());
    expect(reverse.getState()).toEqual(a.getState());
  });
});
