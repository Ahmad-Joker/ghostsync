import { describe, expect, it } from "vitest";

import { decodeCapsule, encodeCapsule, isCapsuleError } from "../src/index.js";
import { APP, DOC, metaOf, rejection, sealedCapsule, standardUpdate } from "./helpers.js";

const update = standardUpdate();
const N = update.length;

async function codeOf(bytes: Uint8Array): Promise<string | undefined> {
  const e = await rejection(decodeCapsule(bytes));
  return isCapsuleError(e) ? e.code : undefined;
}

describe("AC-CAP-002-4 metadata field validation", () => {
  it("unknown and missing top-level keys are Malformed", async () => {
    expect(await codeOf(sealedCapsule(metaOf(N, { extra: 1 }), update))).toBe("Malformed");
    expect(await codeOf(sealedCapsule(metaOf(N, { app: undefined }), update))).toBe("Malformed");
    expect(await codeOf(sealedCapsule(metaOf(N, { createdAt: undefined }), update))).toBe("Malformed");
  });

  it("app and documentId must be non-empty strings", async () => {
    for (const over of [{ app: "" }, { app: 1 }, { documentId: "" }, { documentId: null }]) {
      expect(await codeOf(sealedCapsule(metaOf(N, over), update)), JSON.stringify(over)).toBe("Malformed");
    }
  });

  it("updateByteLength must be a non-negative safe integer", async () => {
    for (const bad of [-1, 1.5, "8", null]) {
      expect(await codeOf(sealedCapsule(metaOf(N, { updateByteLength: bad }), update)), String(bad)).toBe("Malformed");
    }
  });

  it("createdAt must be strict canonical ISO-8601 UTC on decode", async () => {
    for (const bad of ["1/1/2026", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000+00:00", "2026-13-01T00:00:00.000Z", 5]) {
      expect(await codeOf(sealedCapsule(metaOf(N, { createdAt: bad }), update)), String(bad)).toBe("Malformed");
    }
  });

  it("encode rejects a non-canonical createdAt with TypeError", async () => {
    for (const createdAt of ["1/1/2026", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00.000+00:00", ""]) {
      await expect(encodeCapsule({ app: APP, documentId: DOC, update, createdAt })).rejects.toBeInstanceOf(TypeError);
    }
  });
});
