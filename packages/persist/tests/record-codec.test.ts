/**
 * REQ-BP-002-5 / REQ-BP-006-5 / NFR-BP-006 — record validation order (size →
 * format/shape → version → identity → checksum → sequence) and SHA-256 checksum.
 * Node unit — fast feedback, NOT acceptance evidence. Real crypto.subtle digest.
 */
import { describe, expect, it } from "vitest";

import { isPersistenceError } from "../src/errors.js";
import {
  buildRecord,
  isValidSequence,
  RECORD_VERSION,
  sha256Hex,
  validateRecord,
  type RecordIdentity,
} from "../src/record.js";

const identity: RecordIdentity = {
  storageKey: "app\u001fdoc\u001fr",
  app: "app",
  documentId: "doc",
  replicaId: "r",
};

async function validRecord(bytes: Uint8Array, sequence = 1) {
  const checksum = await sha256Hex(bytes);
  return buildRecord(identity, bytes, sequence, checksum);
}

describe("sha256Hex (NFR-BP-006)", () => {
  it("produces the known SHA-256 of an empty buffer", async () => {
    // SHA-256("") is a fixed well-known constant.
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is stable and copies before hashing (offset views do not leak)", async () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = backing.subarray(2, 4); // [3, 4]
    const direct = await sha256Hex(new Uint8Array([3, 4]));
    expect(await sha256Hex(view)).toBe(direct);
  });
});

describe("validateRecord order (REQ-BP-002-5)", () => {
  it("accepts a well-formed record", async () => {
    const rec = await validRecord(new Uint8Array([9, 8, 7]));
    await expect(validateRecord(rec, identity, 1024)).resolves.toMatchObject({
      version: RECORD_VERSION,
    });
  });

  it("rejects a non-object / missing-field shape BEFORE touching bytes.length", async () => {
    await expect(validateRecord(null, identity, 1024)).rejects.toSatisfy((e) =>
      isPersistenceError(e, "InvalidRecordError"),
    );
    await expect(validateRecord({ storageKey: "x" }, identity, 1024)).rejects.toSatisfy((e) =>
      isPersistenceError(e, "InvalidRecordError"),
    );
  });

  it("enforces the size bound before hashing/decoding", async () => {
    const rec = await validRecord(new Uint8Array(100));
    await expect(validateRecord(rec, identity, 50)).rejects.toSatisfy((e) =>
      isPersistenceError(e, "InvalidRecordError"),
    );
  });

  it("rejects an unknown/greater version (no auto-wipe)", async () => {
    const rec = { ...(await validRecord(new Uint8Array([1]))), version: 2 };
    await expect(validateRecord(rec, identity, 1024)).rejects.toSatisfy((e) =>
      isPersistenceError(e, "InvalidRecordError"),
    );
  });

  it("rejects an identity mismatch", async () => {
    const rec = { ...(await validRecord(new Uint8Array([1]))), app: "other" };
    await expect(validateRecord(rec, identity, 1024)).rejects.toSatisfy((e) =>
      isPersistenceError(e, "InvalidRecordError"),
    );
  });

  it("rejects a checksum mismatch (corruption)", async () => {
    const rec = { ...(await validRecord(new Uint8Array([1, 2, 3]))), checksum: "deadbeef" };
    await expect(validateRecord(rec, identity, 1024)).rejects.toSatisfy((e) =>
      isPersistenceError(e, "InvalidRecordError"),
    );
  });

  it("rejects a non-integer / negative / unsafe sequence", async () => {
    for (const seq of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const rec = { ...(await validRecord(new Uint8Array([1]), 1)), sequence: seq };
      await expect(validateRecord(rec, identity, 1024)).rejects.toSatisfy((e) =>
        isPersistenceError(e, "InvalidRecordError"),
      );
    }
  });
});

describe("isValidSequence (REQ-BP-003)", () => {
  it("accepts non-negative safe integers only", () => {
    expect(isValidSequence(0)).toBe(true);
    expect(isValidSequence(42)).toBe(true);
    expect(isValidSequence(-1)).toBe(false);
    expect(isValidSequence(1.5)).toBe(false);
    expect(isValidSequence(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidSequence("3" as unknown)).toBe(false);
  });
});
