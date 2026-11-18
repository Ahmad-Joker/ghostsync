import { describe, expect, it } from "vitest";

import { importCapsuleInto, importCapsuleIntoPersisted, isCapsuleError } from "../src/index.js";
import { APP, DOC, capsuleOf, persistedFake, rejection, replicaWith } from "./helpers.js";

const closed = (): Error => Object.assign(new Error("session is closed"), { code: "ClosedError" });

describe("AC-CAP-006-5 / 009-4 target unavailable", () => {
  it("persisted target whose applyUpdate throws ClosedError rejects TargetUnavailable, never applied:true, no flush", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const err = closed();
    const fake = persistedFake(replicaWith(DOC), { applyThrows: err });
    const e = await rejection(importCapsuleIntoPersisted(fake.target, cap));
    expect(isCapsuleError(e, "TargetUnavailable")).toBe(true);
    expect((e as Error).cause).toBe(err);
    expect(fake.calls).toEqual({ apply: 1, flush: 0 });
  });

  it("replica target whose applyUpdate throws rejects TargetUnavailable", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const target = {
      documentId: DOC,
      applyUpdate: (): never => {
        throw closed();
      },
    };
    expect(isCapsuleError(await rejection(importCapsuleInto(target, cap, { app: APP })), "TargetUnavailable")).toBe(true);
  });

  it("successful apply then failing flush resolves applied:true, persisted:false with saveError (open-session recoverable case)", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const replica = replicaWith(DOC);
    const abort = Object.assign(new Error("write aborted"), { code: "TransactionAbortError" });
    const fake = persistedFake(replica, { flushError: abort });
    const result = await importCapsuleIntoPersisted(fake.target, cap);
    expect(result).toMatchObject({ applied: true, persisted: false });
    expect(result.saveError).toBe(abort);
    expect(replica.getState()).toEqual({ k: 1 });
    expect(fake.calls).toEqual({ apply: 1, flush: 1 });
  });

  it("a ClosedError during flush after a successful apply is applied:true, persisted:false (terminal path)", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const fake = persistedFake(replicaWith(DOC), { flushError: closed() });
    const result = await importCapsuleIntoPersisted(fake.target, cap);
    expect(result.applied).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.saveError?.code).toBe("ClosedError");
  });
});
