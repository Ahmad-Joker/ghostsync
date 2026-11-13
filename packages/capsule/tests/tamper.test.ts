import { describe, expect, it } from "vitest";

import { decodeCapsule, isCapsuleError } from "../src/index.js";
import { APP, DOC, capsuleOf, metaOf, rejection, replicaWith, sealedCapsule, standardUpdate } from "./helpers.js";

async function codeOf(bytes: Uint8Array): Promise<string | undefined> {
  const e = await rejection(decodeCapsule(bytes));
  return isCapsuleError(e) ? e.code : undefined;
}

describe("AC-CAP-004-1 / 006-3 tamper detection (scoped per mutation class)", () => {
  it("a flipped payload byte is ChecksumMismatch", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: "value" }));
    cap[cap.length - 1] = (cap[cap.length - 1] as number) ^ 0xff;
    expect(await codeOf(cap)).toBe("ChecksumMismatch");
  });

  it("a changed identity field (same length) is ChecksumMismatch", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const i = new TextDecoder().decode(cap).indexOf(APP);
    cap[i] = (cap[i] as number) ^ 0x01; // 'f' -> 'g', still valid UTF-8/JSON
    expect(await codeOf(cap)).toBe("ChecksumMismatch");
  });

  it("a flipped hex digit of the stored sha256 is ChecksumMismatch", async () => {
    const update = standardUpdate();
    const cap = sealedCapsule(metaOf(update.length), update);
    const text = new TextDecoder().decode(cap.subarray(0, 11 + 200));
    const at = text.indexOf('"sha256":"') + '"sha256":"'.length;
    cap[at] = cap[at] === 0x30 ? 0x31 : 0x30;
    expect(await codeOf(cap)).toBe("ChecksumMismatch");
  });

  it("magic, version and length-prefix flips fail earlier with their own codes", async () => {
    const base = await capsuleOf(replicaWith(DOC, { k: 1 }));
    const magic = base.slice();
    magic[1] = 0x00;
    expect(await codeOf(magic)).toBe("Malformed");

    const version = base.slice();
    version[6] = 9;
    expect(await codeOf(version)).toBe("UnsupportedVersion");

    const hugeLength = base.slice();
    hugeLength[7] = 0xff;
    expect(await codeOf(hugeLength)).toBe("Malformed");

    const plusOne = base.slice();
    plusOne[10] = (plusOne[10] as number) + 1; // metadata swallows the first update byte
    expect(await codeOf(plusOne)).toBe("Malformed");
  });

  it("a metadata byte flip that breaks JSON is Malformed, not ChecksumMismatch", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { k: 1 }));
    cap[11] = 0x5b; // '{' -> '['
    expect(await codeOf(cap)).toBe("Malformed");
  });

  it("updateByteLength that lies about the update region is Malformed", async () => {
    const update = standardUpdate();
    expect(await codeOf(sealedCapsule(metaOf(update.length + 1), update))).toBe("Malformed");
    expect(await codeOf(sealedCapsule(metaOf(update.length - 1), update))).toBe("Malformed");
  });
});
