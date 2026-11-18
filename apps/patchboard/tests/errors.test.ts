import { describe, expect, it } from "vitest";
import type { CapsuleErrorCode } from "@ghostsync/capsule";
import type { PersistenceErrorCode } from "@ghostsync/persist";
import { createKit } from "@ghostsync/kit";
import { cardAdapter } from "../src/model/adapters.js";
import { isSchemaMismatch, mapCapsuleError, mapPersistError, mapSaveError } from "../src/state/errors.js";

const cur = { documentId: "sprint-board" };

describe("mapCapsuleError", () => {
  const codes: CapsuleErrorCode[] = [
    "UnsupportedVersion", "Malformed", "AppIdentityMismatch", "DocumentIdentityMismatch", "OversizedRaw",
    "OversizedDecoded", "ChecksumMismatch", "SdkRejection", "TargetUnavailable", "CryptoUnavailable",
  ];
  it("maps every CapsuleError code and always says nothing was changed", () => {
    for (const code of codes) {
      const m = mapCapsuleError(code, cur);
      expect(m.length).toBeGreaterThan(20);
      expect(m.endsWith("Nothing was changed.")).toBe(true);
    }
    expect(mapCapsuleError("TypeError", cur)).toContain("Unexpected error.");
    expect(mapCapsuleError("ReadFailed", cur)).toContain("Could not read that file.");
  });
  it("names the other document and app, truncated to 80 chars", () => {
    expect(mapCapsuleError("DocumentIdentityMismatch", cur, { documentId: "other-board" })).toContain("other-board");
    expect(mapCapsuleError("AppIdentityMismatch", cur, { app: "fieldledger" })).toContain("fieldledger");
    expect(mapCapsuleError("AppIdentityMismatch", cur, { app: "x".repeat(200) })).not.toContain("x".repeat(81));
  });
});

describe("mapPersistError / mapSaveError", () => {
  const codes: PersistenceErrorCode[] = [
    "DatabaseOpenError", "StorageUnavailableError", "UnsupportedEnvironmentError", "StorageInUseError",
    "TransactionAbortError", "QuotaExceededError", "BlockedError", "InvalidRecordError", "CloseFailedError", "ClosedError",
  ];
  it("maps every PersistenceError code", () => {
    for (const c of codes) expect(mapPersistError(c).message.length).toBeGreaterThan(20);
    expect(mapPersistError("Unknown").message).toContain("save failed");
  });
  it("InvalidRecordError copy keeps data and gives the manual step", () => {
    const m = mapPersistError("InvalidRecordError").message;
    expect(m).toContain("Nothing was changed");
    expect(m).toContain("Open a different board");
  });
  it("StorageInUse offers Try again", () => {
    expect(mapPersistError("StorageInUseError").actions).toContain("Try again");
  });
  it("save errors: quota keeps failing, abort usually works, both offer retry and backup", () => {
    expect(mapSaveError("QuotaExceededError").message).toContain("keep failing");
    expect(mapSaveError("TransactionAbortError").message).toContain("usually works");
    expect(mapSaveError("TransactionAbortError").actions).toEqual(["Retry save", "Download backup capsule"]);
  });
});

describe("isSchemaMismatch", () => {
  it("recognizes the REAL Kit schema-mismatch error", () => {
    const kit = createKit();
    const r = kit.createReplica("board-1234");
    r.collection(cardAdapter);
    const v2 = { ...cardAdapter, schema: { ...cardAdapter.schema, schemaVersion: 2 } };
    let caught: unknown;
    try {
      r.collection(v2);
    } catch (e) {
      caught = e;
    }
    r.destroy();
    expect(caught).toBeInstanceOf(Error);
    expect(isSchemaMismatch(caught)).toBe(true);
    expect(isSchemaMismatch(new Error("other"))).toBe(false);
    expect(isSchemaMismatch("x")).toBe(false);
  });
});
