import { describe, expect, it } from "vitest";

import { decodeCapsule } from "../src/index.js";
import { sha256Hex } from "../src/checksum.js";
import { DOC, capsuleOf, nodeSha256Hex, replicaWith, sealedCapsule, metaOf, standardUpdate, MARK } from "./helpers.js";

describe("AC-CAP-004 checksum", () => {
  it("sha256Hex (crypto.subtle) agrees with the independent node:crypto oracle", async () => {
    const data = new Uint8Array([1, 2, 3, 250, 0, 7]);
    expect(await sha256Hex(data)).toBe(nodeSha256Hex(data));
  });

  it("an encoded capsule's stored digest equals the oracle over offsets 7..end with the span zeroed", async () => {
    const cap = await capsuleOf(replicaWith(DOC, { a: 1, b: "two" }));
    const { metadata } = await decodeCapsule(cap);
    const region = cap.slice(7);
    const hex = new TextEncoder().encode(metadata.sha256);
    let off = -1;
    for (let i = 7; i + 64 <= cap.length && off < 0; i++) {
      if (hex.every((b, k) => cap[i + k] === b)) off = i;
    }
    expect(off).toBeGreaterThan(10);
    region.fill(0x30, off - 7, off - 7 + 64);
    expect(nodeSha256Hex(region)).toBe(metadata.sha256);
  });

  it("verifies the RECEIVED bytes: a differently formatted but consistent capsule verifies (no reserialization)", async () => {
    const update = standardUpdate();
    const spaced = metaOf(update.length).replace(/,/g, " ,\n  ").replace(`"${MARK}"`, `  "${MARK}"  `);
    const cap = sealedCapsule(spaced, update);
    await expect(decodeCapsule(cap)).resolves.toBeDefined();
  });
});
