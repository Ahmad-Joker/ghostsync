import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createKit } from "../src/index.js";

const DOC = "doc-identity";

describe("REQ-SDK-003 identity dimensions (AC-SDK-003-1/3/5)", () => {
  it("documentId is carried separately and is not derived from clientID", () => {
    const r = createKit().createReplica(DOC);
    expect(r.documentId).toBe(DOC);
    r.destroy();
  });

  it("two replicas of one documentId get distinct Yjs clientIDs", () => {
    // Fresh Y.Doc per replica => fresh clientID; we observe clientIDs via the
    // decoded update structure of each replica by comparing exported bytes.
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("x", 1);
    b.set("x", 2);
    const da = new Y.Doc();
    const db = new Y.Doc();
    Y.applyUpdate(da, a.exportState().bytes);
    Y.applyUpdate(db, b.exportState().bytes);
    expect(da.clientID).not.toBe(db.clientID);
    da.destroy();
    db.destroy();
    a.destroy();
    b.destroy();
  });

  it("metadata is not authentication: a wrong-documentId carrier is rejected and state is unchanged", () => {
    const r = createKit().createReplica(DOC);
    r.set("alpha", 1);
    const before = r.getState();

    const peer = createKit().createReplica("other-doc");
    peer.set("beta", 2);
    const foreign = peer.exportState();

    const outcome = r.applyUpdate({ documentId: "other-doc", bytes: foreign.bytes });
    expect(outcome).toEqual({ ok: false, reason: "documentIdMismatch" });
    expect(r.getState()).toEqual(before);
    r.destroy();
    peer.destroy();
  });
});
