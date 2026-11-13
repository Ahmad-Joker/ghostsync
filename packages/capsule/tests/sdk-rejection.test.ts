import { describe, expect, it } from "vitest";

import { importCapsuleInto, importCapsuleIntoPersisted, isCapsuleError } from "../src/index.js";
import type { ApplyOutcome } from "../src/index.js";
import { APP, DOC, capsuleOf, metaOf, persistedFake, rejection, replicaWith, sealedCapsule } from "./helpers.js";

const reasons = ["documentIdMismatch", "invalidCarrier", "malformedUpdate"] as const;

describe("AC-CAP-006-2 Kit non-ok outcomes become SdkRejection", () => {
  it.each(reasons)("replica path maps %s", async (reason) => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const outcome: ApplyOutcome = { ok: false, reason };
    const target = { documentId: DOC, applyUpdate: () => outcome };
    const e = await rejection(importCapsuleInto(target, cap, { app: APP }));
    expect(isCapsuleError(e, "SdkRejection")).toBe(true);
    expect((e as Error).cause).toEqual({ reason });
  });

  it("persisted path rejects SdkRejection and never flushes", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const replica = replicaWith(DOC);
    const fake = persistedFake(replica);
    const rejecting = { ...fake.target, applyUpdate: (): ApplyOutcome => ({ ok: false, reason: "malformedUpdate" }) };
    const e = await rejection(importCapsuleIntoPersisted(rejecting, cap));
    expect(isCapsuleError(e, "SdkRejection")).toBe(true);
    expect(fake.calls.flush).toBe(0);
  });

  it("a structurally valid capsule with garbage Yjs bytes is rejected by the real Kit and leaves state unchanged", async () => {
    const garbage = new Uint8Array([255, 255, 255, 255, 1, 2, 3]);
    const cap = sealedCapsule(metaOf(garbage.length), garbage);
    const target = replicaWith(DOC, { keep: 1 });
    const before = target.getState();
    const e = await rejection(importCapsuleInto(target, cap, { app: APP }));
    expect(isCapsuleError(e, "SdkRejection")).toBe(true);
    expect(target.getState()).toEqual(before);
  });

  it("a zero-length update region is a valid capsule that the Kit rejects as SdkRejection", async () => {
    const cap = sealedCapsule(metaOf(0), new Uint8Array(0));
    const e = await rejection(importCapsuleInto(replicaWith(DOC), cap, { app: APP }));
    expect(isCapsuleError(e, "SdkRejection")).toBe(true);
  });
});
