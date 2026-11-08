/**
 * REQ-BP-003-4 — the read-modify-write generation guard drops a stale
 * older-generation write; the stored sequence never regresses. Node unit on
 * fake-indexeddb — fast feedback, NOT acceptance evidence.
 */
import { describe, expect, it } from "vitest";

import { openDatabase, readRecord, writeRecord } from "../src/idb.js";
import { buildRecord, sha256Hex, type RecordIdentity, type StoredRecord } from "../src/record.js";
import { uniqueDbName } from "./support/fake-reset.js";

const identity: RecordIdentity = {
  storageKey: "app\u001fdoc\u001fr",
  app: "app",
  documentId: "doc",
  replicaId: "r",
};

async function record(seq: number, payload: number): Promise<StoredRecord> {
  const bytes = new Uint8Array([payload]);
  return buildRecord(identity, bytes, seq, await sha256Hex(bytes));
}

describe("writeRecord generation guard (REQ-BP-003-4)", () => {
  it("writes a newer generation and skips a stale older one", async () => {
    const conn = await openDatabase(uniqueDbName());
    try {
      const w2 = await writeRecord(conn.db, await record(2, 20));
      expect(w2.written).toBe(true);

      // A stale older-generation write must be dropped.
      const w1 = await writeRecord(conn.db, await record(1, 10));
      expect(w1.written).toBe(false);

      const stored = (await readRecord(conn.db, identity.storageKey)) as StoredRecord;
      expect(stored.sequence).toBe(2);
      expect(Array.from(stored.bytes)).toEqual([20]);
    } finally {
      conn.close();
    }
  });

  it("skips an equal generation (no regression, idempotent)", async () => {
    const conn = await openDatabase(uniqueDbName());
    try {
      expect((await writeRecord(conn.db, await record(5, 1))).written).toBe(true);
      expect((await writeRecord(conn.db, await record(5, 2))).written).toBe(false);
      const stored = (await readRecord(conn.db, identity.storageKey)) as StoredRecord;
      expect(stored.sequence).toBe(5);
      expect(Array.from(stored.bytes)).toEqual([1]);
    } finally {
      conn.close();
    }
  });

  it("advances across increasing generations", async () => {
    const conn = await openDatabase(uniqueDbName());
    try {
      for (let g = 1; g <= 5; g++) {
        expect((await writeRecord(conn.db, await record(g, g))).written).toBe(true);
      }
      const stored = (await readRecord(conn.db, identity.storageKey)) as StoredRecord;
      expect(stored.sequence).toBe(5);
    } finally {
      conn.close();
    }
  });
});
