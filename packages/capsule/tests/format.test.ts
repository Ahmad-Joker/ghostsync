import { describe, expect, it } from "vitest";

import { CAPSULE_MAGIC, decodeCapsule, isCapsuleError } from "../src/index.js";
import { DOC, capsuleOf, nodeSha256Hex, rejection, replicaWith } from "./helpers.js";

describe("AC-CAP-002 container layout", () => {
  it("has the documented byte layout and checksum coverage (independent node:crypto oracle)", async () => {
    const a = replicaWith(DOC, { a: "é💾" });
    const cap = await capsuleOf(a);

    expect(Array.from(cap.subarray(0, 6))).toEqual([0x47, 0x53, 0x43, 0x41, 0x50, 0x00]);
    expect(Array.from(CAPSULE_MAGIC)).toEqual([0x47, 0x53, 0x43, 0x41, 0x50, 0x00]);
    expect(cap[6]).toBe(1);
    const metaLength = new DataView(cap.buffer, cap.byteOffset).getUint32(7, false);
    const update = a.exportState().bytes;
    expect(cap.length).toBe(11 + metaLength + update.length);
    expect(Array.from(cap.subarray(11 + metaLength))).toEqual(Array.from(update));

    const text = new TextDecoder().decode(cap.subarray(11, 11 + metaLength));
    const parsed = JSON.parse(text) as { sha256: string };
    // Zero the 64 hex bytes of the sha256 value, hash offsets 7..end.
    const region = cap.slice(7);
    const hex = new TextEncoder().encode(parsed.sha256);
    let off = -1;
    for (let i = 0; i + 64 <= cap.length && off < 0; i++) {
      if (hex.every((b, k) => cap[i + k] === b)) off = i;
    }
    expect(off).toBeGreaterThan(10);
    region.fill(0x30, off - 7, off - 7 + 64);
    expect(nodeSha256Hex(region)).toBe(parsed.sha256);
  });

  it("rejects truncated capsules and trailing bytes as Malformed", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    for (const bad of [cap.slice(0, 5), cap.slice(0, 10), cap.slice(0, 20), cap.slice(0, cap.length - 1)]) {
      const e = await rejection(decodeCapsule(bad));
      expect(isCapsuleError(e, "Malformed")).toBe(true);
    }
    const extra = new Uint8Array(cap.length + 1);
    extra.set(cap);
    expect(isCapsuleError(await rejection(decodeCapsule(extra)), "Malformed")).toBe(true);
  });

  it("rejects wrong magic as Malformed", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    cap[0] = 0x58;
    expect(isCapsuleError(await rejection(decodeCapsule(cap)), "Malformed")).toBe(true);
  });
});
