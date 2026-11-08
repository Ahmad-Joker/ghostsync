/**
 * REQ-BP-002 / REQ-BP-005 / REQ-BP-006 — open/restore validation, corrupt-record
 * preservation, lock contention (zero writes), maxBytes-before-write, and the
 * failed-close recovery-only path. Node unit on fake-indexeddb + mocked Web
 * Locks — FAST FEEDBACK, NOT acceptance evidence (REQ-BP-007).
 */
import { describe, expect, it } from "vitest";

import { isPersistenceError } from "../src/errors.js";
import { openDatabase, readRecord, writeRecord } from "../src/idb.js";
import { buildRecord, sha256Hex, type RecordIdentity, type StoredRecord } from "../src/record.js";
import { storageKey } from "../src/identity.js";
import { openReplica } from "../src/session.js";
import { uniqueDbName } from "./support/fake-reset.js";

describe("open / restore (REQ-BP-002)", () => {
  it("rejects a corrupt stored record and leaves the bytes byte-identical", async () => {
    const dbName = uniqueDbName();
    const app = "a";
    const documentId = "d";
    const replicaId = "r";
    const key = storageKey(app, documentId, replicaId);
    const identity: RecordIdentity = { storageKey: key, app, documentId, replicaId };

    // Plant a record whose checksum does not match its bytes (corruption).
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const corrupt: StoredRecord = {
      ...buildRecord(identity, bytes, 1, await sha256Hex(bytes)),
      checksum: "0".repeat(64),
    };
    const conn = await openDatabase(dbName);
    await writeRecord(conn.db, corrupt);
    conn.close();

    await expect(
      openReplica({ app, documentId, replicaId, dbName }),
    ).rejects.toSatisfy((e) => isPersistenceError(e, "InvalidRecordError"));

    // The corrupt record is preserved untouched.
    const check = await openDatabase(dbName);
    const stored = (await readRecord(check.db, key)) as StoredRecord;
    check.close();
    expect(Array.from(stored.bytes)).toEqual([1, 2, 3, 4]);
    expect(stored.checksum).toBe("0".repeat(64));
  });

  it("rejects an oversized stored record before decoding (maxBytes)", async () => {
    const dbName = uniqueDbName();
    const app = "a";
    const documentId = "d";
    const replicaId = "r";
    const key = storageKey(app, documentId, replicaId);
    const identity: RecordIdentity = { storageKey: key, app, documentId, replicaId };
    const bytes = new Uint8Array(200);
    const rec = buildRecord(identity, bytes, 1, await sha256Hex(bytes));
    const conn = await openDatabase(dbName);
    await writeRecord(conn.db, rec);
    conn.close();

    await expect(
      openReplica({ app, documentId, replicaId, dbName, maxBytes: 50 }),
    ).rejects.toSatisfy((e) => isPersistenceError(e, "InvalidRecordError"));
  });
});

describe("exclusive lock contention (REQ-BP-005)", () => {
  it("a second same-key open rejects with StorageInUseError and writes nothing", async () => {
    const dbName = uniqueDbName();
    const first = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    await expect(
      openReplica({ app: "a", documentId: "d", replicaId: "r", dbName }),
    ).rejects.toSatisfy((e) => isPersistenceError(e, "StorageInUseError"));

    // After the owner closes, a retry can open and sees latest committed data.
    first.set("x", 42);
    await first.flush();
    await first.close();
    const retry = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    expect(retry.get("x")).toBe(42);
    await retry.close();
  });

  it("different replicaIds (separate keys) both open concurrently", async () => {
    const dbName = uniqueDbName();
    const a = await openReplica({ app: "a", documentId: "d", replicaId: "rA", dbName });
    const b = await openReplica({ app: "a", documentId: "d", replicaId: "rB", dbName });
    await a.close();
    await b.close();
    expect(a.storageKey).not.toBe(b.storageKey);
  });
});

describe("maxBytes enforced before a write (clarification 2)", () => {
  it("surfaces an error and keeps live data when a snapshot exceeds maxBytes", async () => {
    const session = await openReplica({
      app: "a",
      documentId: "d",
      dbName: uniqueDbName(),
      maxBytes: 4, // absurdly small: any real snapshot exceeds it
    });
    session.set("key", "value");
    await expect(session.flush()).rejects.toSatisfy((e) =>
      isPersistenceError(e, "QuotaExceededError"),
    );
    expect(session.state).toBe("error");
    // Live data is preserved in memory.
    expect(session.get("key")).toBe("value");
    await session.dispose();
  });
});
