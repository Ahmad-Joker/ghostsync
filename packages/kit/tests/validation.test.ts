import { describe, expect, it } from "vitest";

import { createKit } from "../src/index.js";
import type { Scalar } from "../src/index.js";

const DOC = "doc-target";

describe("REQ-006 carrier validation and document-ID rejection", () => {
  it("AC-006-1: documentId mismatch rejected, state unchanged", () => {
    const kit = createKit();
    const target = kit.createReplica(DOC);
    target.set("k", "v");
    const before = target.getState();

    const other = kit.createReplica("doc-other");
    other.set("x", "y");

    const outcome = target.applyUpdate(other.exportState());

    expect(outcome).toEqual({ ok: false, reason: "documentIdMismatch" });
    expect(target.getState()).toEqual(before);

    target.destroy();
    other.destroy();
  });

  it("AC-006-2: distinguishable outcomes (ok / mismatch / invalidCarrier)", () => {
    const kit = createKit();
    const target = kit.createReplica(DOC);
    const peer = kit.createReplica(DOC);
    peer.set("k", "v");
    const mismatchPeer = kit.createReplica("doc-x");
    mismatchPeer.set("k", "v");

    const ok = target.applyUpdate(peer.exportState());
    const mismatch = target.applyUpdate(mismatchPeer.exportState());
    const invalid = target.applyUpdate({ documentId: DOC, bytes: "nope" });

    expect(ok).toEqual({ ok: true });
    expect(mismatch).toEqual({ ok: false, reason: "documentIdMismatch" });
    expect(invalid).toEqual({ ok: false, reason: "invalidCarrier" });

    target.destroy();
    peer.destroy();
    mismatchPeer.destroy();
  });

  it("AC-006-3 (behavioral): wrong-documentId carrier rejected, state unchanged (identity, not auth)", () => {
    const kit = createKit();
    const target = kit.createReplica(DOC);
    target.set("k", "v");
    const before = target.getState();

    // Otherwise-valid Yjs bytes, but tagged with a different documentId.
    const foreign = kit.createReplica("someone-elses-doc");
    foreign.set("injected", "value");
    const carrier = foreign.exportState();

    const outcome = target.applyUpdate(carrier);

    expect(outcome).toEqual({ ok: false, reason: "documentIdMismatch" });
    // The identity guard is NOT authentication; it simply refuses mismatched ids
    // and leaves the target untouched.
    expect(target.getState()).toEqual(before);
    expect(target.has("injected")).toBe(false);

    target.destroy();
    foreign.destroy();
  });

  it("AC-006-4: invalid carriers rejected before decode, state unchanged", () => {
    const kit = createKit();
    const target = kit.createReplica(DOC);
    target.set("k", "v");
    const before = target.getState();

    const cases: unknown[] = [
      null,
      undefined,
      "string-not-object",
      42,
      {}, // missing documentId and bytes
      { bytes: new Uint8Array([1, 2]) }, // missing documentId
      { documentId: 123, bytes: new Uint8Array([1, 2]) }, // non-string documentId
      { documentId: "", bytes: new Uint8Array([1, 2]) }, // empty documentId
      { documentId: DOC }, // missing bytes
      { documentId: DOC, bytes: [1, 2, 3] }, // non-Uint8Array bytes
      { documentId: DOC, bytes: new Uint8Array(0) }, // zero-length bytes (correction 3)
    ];

    for (const carrier of cases) {
      expect(target.applyUpdate(carrier)).toEqual({ ok: false, reason: "invalidCarrier" });
    }
    expect(target.getState()).toEqual(before);

    target.destroy();
  });
});

describe("REQ-007 runtime scalar and documentId validation", () => {
  it("AC-007-1: set rejects non-scalar values before mutating", () => {
    const kit = createKit();
    const r = kit.createReplica(DOC);
    r.set("keep", "ok");
    const before = r.getState();

    const bad: unknown[] = [
      undefined,
      [1, 2, 3],
      { a: 1 },
      () => 1,
      Symbol("s"),
      10n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    for (const value of bad) {
      expect(() => r.set("x", value as Scalar)).toThrow(TypeError);
    }
    // state unchanged: no rejected write landed
    expect(r.getState()).toEqual(before);

    // allowed scalars accepted
    expect(() => r.set("s", "str")).not.toThrow();
    expect(() => r.set("n", 3.14)).not.toThrow();
    expect(() => r.set("b", false)).not.toThrow();
    expect(() => r.set("z", null)).not.toThrow();

    r.destroy();
  });

  it("AC-007-2: createReplica rejects empty/non-string documentId", () => {
    const kit = createKit();
    expect(() => kit.createReplica("")).toThrow(TypeError);
    // @ts-expect-error runtime guard for non-string callers
    expect(() => kit.createReplica(123)).toThrow(TypeError);
    // @ts-expect-error runtime guard for missing documentId
    expect(() => kit.createReplica()).toThrow(TypeError);
  });
});
