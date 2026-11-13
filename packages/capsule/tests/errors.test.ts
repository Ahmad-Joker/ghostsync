import { describe, expect, it } from "vitest";

import {
  CapsuleError,
  decodeCapsule,
  encodeCapsule,
  importCapsuleInto,
  importCapsuleIntoPersisted,
  isCapsuleError,
} from "../src/index.js";
import type { PersistTarget, ReplicaTarget } from "../src/index.js";
import { APP, DOC, capsuleOf, persistedFake, rejection, replicaWith, standardUpdate } from "./helpers.js";

const cast = <T>(v: unknown): T => v as T;

describe("AC-CAP-006-1/4 TypeError (programmer misuse) vs CapsuleError (capsule/operational)", () => {
  it("CapsuleError carries a code and optional cause; isCapsuleError narrows", () => {
    const c = new CapsuleError("Malformed", "m", 7);
    expect(c).toBeInstanceOf(Error);
    expect(c.name).toBe("CapsuleError");
    expect(c.code).toBe("Malformed");
    expect(c.cause).toBe(7);
    expect(isCapsuleError(c)).toBe(true);
    expect(isCapsuleError(c, "Malformed")).toBe(true);
    expect(isCapsuleError(c, "OversizedRaw")).toBe(false);
    expect(isCapsuleError(new TypeError("x"))).toBe(false);
  });

  it("encodeCapsule: wrong types are TypeError, never CapsuleError", async () => {
    const update = standardUpdate();
    const bad: unknown[] = [
      null,
      "x",
      { app: "", documentId: DOC, update },
      { app: APP, documentId: 5, update },
      { app: APP, documentId: DOC, update: "bytes" },
      { app: APP, documentId: DOC, update: new Uint8Array(0) },
      { app: APP, documentId: DOC, update: { documentId: DOC, kind: "full" } },
    ];
    for (const input of bad) {
      const e = await rejection(encodeCapsule(cast(input)));
      expect(e).toBeInstanceOf(TypeError);
      expect(isCapsuleError(e)).toBe(false);
    }
  });

  it("decodeCapsule: non-bytes and bad opts are TypeError; bad capsule bytes are CapsuleError", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    for (const b of [null, "x", [1, 2], new ArrayBuffer(8)]) {
      expect(await rejection(decodeCapsule(cast(b)))).toBeInstanceOf(TypeError);
    }
    for (const opts of [{ maxCapsuleBytes: 0 }, { maxUpdateBytes: -1 }, { maxCapsuleBytes: 1.5 }, "x", null]) {
      expect(await rejection(decodeCapsule(cap, cast(opts)))).toBeInstanceOf(TypeError);
    }
    expect(isCapsuleError(await rejection(decodeCapsule(new Uint8Array(3))))).toBe(true);
  });

  it("importCapsuleInto: wrong target/expected/bytes shapes are TypeError", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const good = replicaWith(DOC);
    const cases: Array<() => Promise<unknown>> = [
      () => importCapsuleInto(cast<ReplicaTarget>({}), cap, { app: APP }),
      () => importCapsuleInto(cast<ReplicaTarget>(null), cap, { app: APP }),
      () => importCapsuleInto(good, cap, cast({})),
      () => importCapsuleInto(good, cap, { app: "" }),
      () => importCapsuleInto(good, cast("not bytes"), { app: APP }),
      () => importCapsuleInto(good, cap, { app: APP }, cast({ maxCapsuleBytes: 0 })),
    ];
    for (const run of cases) {
      expect(await rejection(run())).toBeInstanceOf(TypeError);
    }
  });

  it("importCapsuleIntoPersisted: wrong target/bytes shapes are TypeError", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const fake = persistedFake(replicaWith(DOC));
    const cases: Array<() => Promise<unknown>> = [
      () => importCapsuleIntoPersisted(cast<PersistTarget>({}), cap),
      () => importCapsuleIntoPersisted(cast<PersistTarget>({ ...fake.target, identity: { app: APP } }), cap),
      () => importCapsuleIntoPersisted(cast<PersistTarget>({ ...fake.target, flush: undefined }), cap),
      () => importCapsuleIntoPersisted(fake.target, cast(42)),
    ];
    for (const run of cases) {
      expect(await rejection(run())).toBeInstanceOf(TypeError);
    }
    expect(fake.calls).toEqual({ apply: 0, flush: 0 });
  });

  it("operational/capsule failures are CapsuleError with documented codes (not TypeError)", async () => {
    const e = await rejection(importCapsuleInto(replicaWith(DOC), new Uint8Array(20), { app: APP }));
    expect(e).not.toBeInstanceOf(TypeError);
    expect(isCapsuleError(e, "Malformed")).toBe(true);
  });

  it("helper success results are { applied: true }, never ok: true", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const r = await importCapsuleInto(replicaWith(DOC), cap, { app: APP });
    expect(r.applied).toBe(true);
    expect(Object.keys(r)).not.toContain("ok");
    const p = await importCapsuleIntoPersisted(persistedFake(replicaWith(DOC)).target, cap);
    expect(Object.keys(p)).not.toContain("ok");
  });
});
