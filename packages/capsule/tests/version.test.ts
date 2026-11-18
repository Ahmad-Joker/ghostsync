import { describe, expect, it } from "vitest";

import { decodeCapsule, isCapsuleError } from "../src/index.js";
import { metaOf, rejection, sealedCapsule, standardUpdate } from "./helpers.js";

describe("AC-CAP-002-6 format version mapping", () => {
  const update = standardUpdate();

  it("header version 1 decodes", async () => {
    const cap = sealedCapsule(metaOf(update.length), update);
    expect((await decodeCapsule(cap)).metadata.formatVersion).toBe(1);
  });

  it("header version 0 is Malformed", async () => {
    const cap = sealedCapsule(metaOf(update.length), update, { version: 0 });
    expect(isCapsuleError(await rejection(decodeCapsule(cap)), "Malformed")).toBe(true);
  });

  it.each([2, 3, 128, 255])("header version %i is UnsupportedVersion", async (v) => {
    const cap = sealedCapsule(metaOf(update.length), update, { version: v });
    expect(isCapsuleError(await rejection(decodeCapsule(cap)), "UnsupportedVersion")).toBe(true);
  });

  it("header 1 with metadata.formatVersion 2 is Malformed, never UnsupportedVersion", async () => {
    const cap = sealedCapsule(metaOf(update.length, { formatVersion: 2 }), update);
    const e = await rejection(decodeCapsule(cap));
    expect(isCapsuleError(e, "Malformed")).toBe(true);
    expect(isCapsuleError(e, "UnsupportedVersion")).toBe(false);
  });

  it("header 1 with a non-number metadata.formatVersion is Malformed", async () => {
    const cap = sealedCapsule(metaOf(update.length, { formatVersion: "1" }), update);
    expect(isCapsuleError(await rejection(decodeCapsule(cap)), "Malformed")).toBe(true);
  });
});
