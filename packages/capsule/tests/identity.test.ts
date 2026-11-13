import { describe, expect, it } from "vitest";

import { importCapsuleInto, importCapsuleIntoPersisted, isCapsuleError } from "../src/index.js";
import { APP, DOC, capsuleOf, persistedFake, rejection, replicaWith } from "./helpers.js";

describe("AC-CAP-003 identity gating", () => {
  it("replica path: expected.app and target.documentId govern; mismatches apply nothing", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }), APP);

    const wrongApp = replicaWith(DOC, { keep: 1 });
    const before = wrongApp.getState();
    expect(isCapsuleError(await rejection(importCapsuleInto(wrongApp, cap, { app: "other" })), "AppIdentityMismatch")).toBe(true);
    expect(wrongApp.getState()).toEqual(before);

    let applied = 0;
    const wrongDoc = {
      documentId: "other-doc",
      applyUpdate: () => {
        applied++;
        return { ok: true } as const;
      },
    };
    expect(isCapsuleError(await rejection(importCapsuleInto(wrongDoc, cap, { app: APP })), "DocumentIdentityMismatch")).toBe(true);
    expect(applied).toBe(0);

    const ok = replicaWith(DOC);
    await expect(importCapsuleInto(ok, cap, { app: APP })).resolves.toMatchObject({ applied: true });
    expect(ok.getState()).toEqual({ k: 1 });
  });

  it("persisted import rejects correct documentId with another app before apply and flush", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }), "patchboard");
    const replica = replicaWith(DOC, { keep: "me" });
    const before = replica.getState();
    const fake = persistedFake(replica, { app: APP });
    const e = await rejection(importCapsuleIntoPersisted(fake.target, cap));
    expect(isCapsuleError(e, "AppIdentityMismatch")).toBe(true);
    expect(replica.getState()).toEqual(before);
    expect(fake.calls).toEqual({ apply: 0, flush: 0 });
  });

  it("persisted import is governed by target.identity.documentId", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const replica = replicaWith(DOC);
    const fake = persistedFake(replica, { documentId: "different" });
    const e = await rejection(importCapsuleIntoPersisted(fake.target, cap));
    expect(isCapsuleError(e, "DocumentIdentityMismatch")).toBe(true);
    expect(fake.calls).toEqual({ apply: 0, flush: 0 });
    expect(replica.getState()).toEqual({});
  });

  it("persisted success applies once, flushes once, and reports persisted:true", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const replica = replicaWith(DOC);
    const fake = persistedFake(replica);
    const result = await importCapsuleIntoPersisted(fake.target, cap);
    expect(result).toMatchObject({ applied: true, persisted: true });
    expect("saveError" in result).toBe(false);
    expect(fake.calls).toEqual({ apply: 1, flush: 1 });
    expect(replica.getState()).toEqual({ k: 1 });
  });
});
