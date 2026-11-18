import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit } from "../src/index.js";

const DOC = "doc-invariants";

/** Build a full-state update carrying a single key=value edit for DOC. */
function updateFor(key: string, value: string | number | boolean | null): Uint8Array {
  const kit = createKit();
  const r = kit.createReplica(DOC);
  r.set(key, value);
  const bytes = r.exportState().bytes;
  r.destroy();
  return bytes;
}

describe("REQ-004 idempotency and order independence", () => {
  it("AC-004-1: idempotency — re-apply is a no-op", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    const u = updateFor("alpha", 1);

    r.applyUpdate({ documentId: DOC, bytes: u });
    const s0 = r.getState();
    r.applyUpdate({ documentId: DOC, bytes: u });

    expect(r.getState()).toEqual(s0);

    r.destroy();
  });

  it("AC-004-2: commutativity — shuffled delivery converges", () => {
    const kit = createKit();
    const u1 = updateFor("a", 1);
    const u2 = updateFor("b", 2);
    const u3 = updateFor("c", 3);

    const forward = kit.createReplica(DOC);
    for (const bytes of [u1, u2, u3]) forward.applyUpdate({ documentId: DOC, bytes });

    const shuffled = kit.createReplica(DOC);
    for (const bytes of [u3, u1, u2]) shuffled.applyUpdate({ documentId: DOC, bytes });

    expect(forward.getState()).toEqual(shuffled.getState());
    expect(forward.getState()).toEqual({ a: 1, b: 2, c: 3 });

    forward.destroy();
    shuffled.destroy();
  });

  it("AC-004-3: grouping invariance — mergeUpdates equals sequential", () => {
    const kit = createKit();
    const u1 = updateFor("a", 1);
    const u2 = updateFor("b", 2);
    const u3 = updateFor("c", 3);

    const seq = kit.createReplica(DOC);
    for (const bytes of [u1, u2, u3]) seq.applyUpdate({ documentId: DOC, bytes });

    const merged = kit.createReplica(DOC);
    const batch = Y.mergeUpdates([u1, u2, u3]);
    merged.applyUpdate({ documentId: DOC, bytes: batch });

    expect(seq.getState()).toEqual(merged.getState());

    seq.destroy();
    merged.destroy();
  });
});
