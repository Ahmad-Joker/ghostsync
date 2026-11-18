import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";

const DOC = "doc-export";

describe("REQ-002 full-state export (AC-002-4) + empty-doc export (correction 3)", () => {
  it("AC-002-4: full-state export reproduces state on a fresh empty replica", () => {
    const kit = createKit();
    const source = kit.createReplica(DOC);
    source.set("alpha", 1);
    source.set("beta", "two");
    source.set("gamma", null);

    const carrier = source.exportState();

    const fresh = kit.createReplica(DOC);
    const outcome = fresh.applyUpdate(carrier);

    expect(outcome).toEqual({ ok: true });
    expect(fresh.getState()).toEqual(source.getState());
    expect(fresh.getState()).toEqual({ alpha: 1, beta: "two", gamma: null });

    source.destroy();
    fresh.destroy();
  });

  it("correction 3: an empty Y.Doc export is non-empty bytes and imports to {}", () => {
    const kit = createKit();
    const empty = kit.createReplica(DOC);

    const carrier = empty.exportState();
    // The export of an empty doc is NON-empty Yjs bytes, not length 0.
    expect(carrier.bytes.length).toBeGreaterThan(0);

    const fresh = kit.createReplica(DOC);
    const outcome = fresh.applyUpdate(carrier);

    expect(outcome).toEqual({ ok: true });
    expect(fresh.getState()).toEqual({});

    empty.destroy();
    fresh.destroy();
  });

  it("correction 3: a zero-length Uint8Array is rejected as an invalid carrier", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);

    const outcome = r.applyUpdate({ documentId: DOC, bytes: new Uint8Array(0) });

    expect(outcome).toEqual({ ok: false, reason: "invalidCarrier" });

    r.destroy();
  });
});
