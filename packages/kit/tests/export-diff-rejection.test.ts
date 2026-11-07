import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-export-diff-rejection";

describe("REQ-SDK-007 exportDiff carrier rejection (AC-SDK-007-8, AC-SDK-004-3)", () => {
  it("rejects each bad peer carrier with a stable reason, no mutation, no notification", () => {
    const r = createKit().createReplica(DOC);
    r.set("alpha", 1);
    const before = r.getState();
    let notifications = 0;
    r.subscribe(() => notifications++);

    // malformed shape
    expect(r.exportDiff(null)).toEqual({ ok: false, reason: "invalidStateVector" });
    expect(r.exportDiff({})).toEqual({ ok: false, reason: "invalidStateVector" });
    expect(r.exportDiff({ documentId: DOC, kind: "stateVector" })).toEqual({
      ok: false,
      reason: "invalidStateVector",
    });
    // wrong kind
    expect(r.exportDiff({ documentId: DOC, kind: "full", bytes: new Uint8Array([0]) })).toEqual({
      ok: false,
      reason: "invalidStateVector",
    });
    // wrong documentId
    expect(
      r.exportDiff({ documentId: "other", kind: "stateVector", bytes: new Uint8Array([0]) }),
    ).toEqual({ ok: false, reason: "documentIdMismatch" });
    // undecodable state-vector bytes
    expect(
      r.exportDiff({ documentId: DOC, kind: "stateVector", bytes: new Uint8Array([255, 255, 255, 255]) }),
    ).toEqual({ ok: false, reason: "invalidStateVector" });

    expect(r.getState()).toEqual(before);
    expect(notifications).toBe(0);
    r.destroy();
  });

  it("a valid no-op diff is non-trivial non-empty bytes (not zero-length)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    a.set("x", 1);
    b.applyUpdate(a.exportState());
    const diff = a.exportDiff(b.exportStateVector());
    expect(diff.ok).toBe(true);
    if (!diff.ok) throw new Error("unreachable");
    expect(diff.update.bytes.length).toBeGreaterThan(0);
    a.destroy();
    b.destroy();
  });
});
