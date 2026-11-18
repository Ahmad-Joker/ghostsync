import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-deletion";

describe("correction 6: deletion regression — stale update does not resurrect a deletion", () => {
  it("delete syncs to B, and a replayed older update does not restore F on a fresh replica C", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);

    // A sets F="x" and syncs it to B.
    a.set("F", "x");
    const olderUpdate = a.exportState(); // pre-deletion full state
    b.applyUpdate(olderUpdate);
    expect(a.get("F")).toBe("x");
    expect(b.get("F")).toBe("x");

    // A deletes F and sends another full update; F disappears on B.
    a.delete("F");
    const deletedUpdate = a.exportState(); // post-deletion full state
    b.applyUpdate(deletedUpdate);
    expect(a.has("F")).toBe(false);
    expect(b.has("F")).toBe(false);

    // Restore the deleted state into a fresh replica C.
    const c = kit.createReplica(deletedUpdate.documentId, deletedUpdate.bytes);
    expect(c.has("F")).toBe(false);

    // Replay the OLDER pre-deletion update into C: the deletion must win.
    const outcome = c.applyUpdate(olderUpdate);
    expect(outcome).toEqual({ ok: true });
    expect(c.has("F")).toBe(false);
    expect(c.getState()).toEqual({});

    a.destroy();
    b.destroy();
    c.destroy();
  });
});
