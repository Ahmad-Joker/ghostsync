import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-restore";

describe("REQ-005 export bytes restore a fresh replica that can sync again", () => {
  it("AC-005-1: restore equivalence after destroy", () => {
    const kit = createKit();
    const r1 = kit.createReplica(DOC);
    r1.set("E1", "one");
    r1.set("E2", 2);
    const before = r1.getState();
    const saved = r1.exportState();
    r1.destroy();

    const r2 = kit.createReplica(saved.documentId, saved.bytes);

    expect(r2.documentId).toBe(DOC);
    expect(r2.getState()).toEqual(before);

    r2.destroy();
  });

  it("AC-005-2: restored replica syncs with a peer; both new edits preserved", () => {
    const kit = createKit();
    const r1 = kit.createReplica(DOC);
    r1.set("seed", "s");
    const saved = r1.exportState();
    r1.destroy();

    const r2 = kit.createReplica(saved.documentId, saved.bytes);
    const r3 = kit.createReplica(DOC);
    r3.applyUpdate(saved); // share the same seed with the peer

    r2.set("E3", 3);
    r3.set("E4", 4);

    r3.applyUpdate(r2.exportState());
    r2.applyUpdate(r3.exportState());

    expect(r2.getState()).toEqual(r3.getState());
    expect(r2.get("E3")).toBe(3);
    expect(r2.get("E4")).toBe(4);

    r2.destroy();
    r3.destroy();
  });

  it("AC-005-3: set-then-delete survives restore", () => {
    const kit = createKit();
    const r1 = kit.createReplica(DOC);
    r1.set("F", "x");
    r1.delete("F");
    const saved = r1.exportState();
    r1.destroy();

    const r2 = kit.createReplica(saved.documentId, saved.bytes);

    expect(r2.has("F")).toBe(false);
    expect(r2.getState()).toEqual({});

    r2.destroy();
  });
});
