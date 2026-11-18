import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeCapsule,
  encodeCapsule,
  importCapsuleInto,
  importCapsuleIntoPersisted,
  isCapsuleError,
} from "../src/index.js";
import { APP, DOC, capsuleOf, persistedFake, rejection, replicaWith } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AC-CAP-006-6 CryptoUnavailable", () => {
  const stubs: Array<[string, () => Error]> = [
    ["digest throws synchronously", () => {
      const cause = new Error("boom-sync");
      vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(() => {
        throw cause;
      });
      return cause;
    }],
    ["digest rejects", () => {
      const cause = new Error("boom-async");
      vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(cause);
      return cause;
    }],
  ];

  it.each(stubs)("encode, decode and both imports reject CryptoUnavailable when %s", async (_name, install) => {
    const source = replicaWith(DOC, { k: 1 });
    const cap = await capsuleOf(source);
    const target = replicaWith(DOC);
    const before = target.getState();
    const fake = persistedFake(replicaWith(DOC));
    const cause = install();

    const results = [
      await rejection(encodeCapsule({ app: APP, documentId: DOC, update: source.exportState() })),
      await rejection(decodeCapsule(cap)),
      await rejection(importCapsuleInto(target, cap, { app: APP })),
      await rejection(importCapsuleIntoPersisted(fake.target, cap)),
    ];
    for (const e of results) {
      expect(isCapsuleError(e, "CryptoUnavailable")).toBe(true);
      expect(isCapsuleError(e, "Malformed")).toBe(false);
      expect(isCapsuleError(e, "ChecksumMismatch")).toBe(false);
      expect((e as Error).cause).toBe(cause);
    }
    expect(target.getState()).toEqual(before);
    expect(fake.calls).toEqual({ apply: 0, flush: 0 });
  });

  it("a missing crypto global is CryptoUnavailable", async () => {
    const source = replicaWith(DOC, { k: 1 });
    const cap = await capsuleOf(source);
    vi.stubGlobal("crypto", undefined);
    expect(isCapsuleError(await rejection(decodeCapsule(cap)), "CryptoUnavailable")).toBe(true);
  });

  it("a structurally bad capsule still yields its own earlier code", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    cap[0] = 0;
    vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValue(new Error("x"));
    expect(isCapsuleError(await rejection(decodeCapsule(cap)), "Malformed")).toBe(true);
  });
});
