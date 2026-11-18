import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_CAPSULE_BYTES, DEFAULT_MAX_UPDATE_BYTES, decodeCapsule, isCapsuleError } from "../src/index.js";
import { DOC, capsuleOf, rejection, replicaWith } from "./helpers.js";

describe("AC-CAP-005 size bounds", () => {
  it("defaults are 16 MiB raw and 8 MiB decoded", () => {
    expect(DEFAULT_MAX_CAPSULE_BYTES).toBe(16 * 1024 * 1024);
    expect(DEFAULT_MAX_UPDATE_BYTES).toBe(8 * 1024 * 1024);
  });

  it("raw size is checked first, even for bytes that are not a capsule", async () => {
    const e = await rejection(decodeCapsule(new Uint8Array(100), { maxCapsuleBytes: 50 }));
    expect(isCapsuleError(e, "OversizedRaw")).toBe(true);
  });

  it("a capsule exactly at the raw limit is accepted; one byte less is OversizedRaw", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    await expect(decodeCapsule(cap, { maxCapsuleBytes: cap.length })).resolves.toBeDefined();
    const e = await rejection(decodeCapsule(cap, { maxCapsuleBytes: cap.length - 1 }));
    expect(isCapsuleError(e, "OversizedRaw")).toBe(true);
  });

  it("decoded size is checked before hashing (bad checksum still yields OversizedDecoded)", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: "payload" }));
    cap[cap.length - 1] = (cap[cap.length - 1] as number) ^ 0xff; // would be ChecksumMismatch
    const e = await rejection(decodeCapsule(cap, { maxUpdateBytes: 2 }));
    expect(isCapsuleError(e, "OversizedDecoded")).toBe(true);
  });

  it("an update exactly at the decoded limit is accepted", async () => {
    const r = replicaWith(DOC, { k: 1 });
    const cap = await capsuleOf(r);
    const n = r.exportState().bytes.length;
    await expect(decodeCapsule(cap, { maxUpdateBytes: n })).resolves.toBeDefined();
    const e = await rejection(decodeCapsule(cap, { maxUpdateBytes: n - 1 }));
    expect(isCapsuleError(e, "OversizedDecoded")).toBe(true);
  });
});
