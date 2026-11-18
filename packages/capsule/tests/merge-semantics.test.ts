import { describe, expect, it } from "vitest";

import { decodeCapsule, importCapsuleInto, importCapsuleIntoPersisted } from "../src/index.js";
import { APP, DOC, capsuleOf, persistedFake, replicaWith } from "./helpers.js";

describe("AC-CAP-007-3 empty-source merge semantics", () => {
  it("an empty source encodes (non-empty Yjs bytes) and imports into a fresh target leaving it empty", async () => {
    const empty = replicaWith(DOC);
    const cap = await capsuleOf(empty);
    expect((await decodeCapsule(cap)).update.length).toBeGreaterThan(0);
    const target = replicaWith(DOC);
    await expect(importCapsuleInto(target, cap, { app: APP })).resolves.toMatchObject({ applied: true });
    expect(target.getState()).toEqual({});
  });

  it("an empty source imported into a populated target preserves every entry", async () => {
    const cap = await capsuleOf(replicaWith(DOC));
    const target = replicaWith(DOC, { a: 1, b: "two", c: null, d: false });
    const before = target.getState();
    await importCapsuleInto(target, cap, { app: APP });
    expect(target.getState()).toEqual(before);
  });

  it("the same holds on the persisted path", async () => {
    const cap = await capsuleOf(replicaWith(DOC));
    const replica = replicaWith(DOC, { keep: "me" });
    const fake = persistedFake(replica);
    await expect(importCapsuleIntoPersisted(fake.target, cap)).resolves.toMatchObject({ applied: true, persisted: true });
    expect(replica.getState()).toEqual({ keep: "me" });
  });
});

describe("AC-CAP-009-3 merged-size flush failure maps to persisted:false (mapping only; real size proof is in Chromium)", () => {
  it("a flush rejecting with a QuotaExceededError-coded error resolves applied:true, persisted:false with that error", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { incoming: "x" }));
    const replica = replicaWith(DOC, { own: 1 });
    const quota = Object.assign(new Error("snapshot exceeds maxBytes"), { code: "QuotaExceededError" });
    const fake = persistedFake(replica, { flushError: quota });
    const result = await importCapsuleIntoPersisted(fake.target, cap);
    expect(result.applied).toBe(true);
    expect(result.persisted).toBe(false);
    expect(result.saveError).toBe(quota);
    expect(replica.getState()).toEqual({ own: 1, incoming: "x" });
  });
});
