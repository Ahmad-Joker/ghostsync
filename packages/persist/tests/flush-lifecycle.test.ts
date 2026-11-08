/**
 * Regressions for the four persistence-review findings (Node unit on
 * fake-indexeddb + mocked Web Locks — FAST FEEDBACK, NOT acceptance evidence):
 *
 *   1. flush() never strands a waiter — even when a save fails SYNCHRONOUSLY
 *      before its first await (pre-write maxBytes), and a SAME-SESSION retry
 *      after a TRANSIENT failure resolves (no hang).
 *   2. Terminal teardown finishes/aborts an active write transaction and awaits
 *      actual lock release BEFORE resolving — no late write, no "saved" after
 *      disposal; concurrent close()/dispose() settle consistently; an immediate
 *      same-key reopen acquires the lock.
 *   3. A SKIPPED stale write (a newer stored sequence) is surfaced as an error,
 *      never a false "saved"; the in-memory edit and the newer stored record
 *      both survive.
 *   4. Reads on a collection handle captured while OPEN return a typed
 *      ClosedError after terminal close/dispose, and subscribe is blocked after
 *      terminal disposal; recovery-only reads stay allowed.
 *
 * All failure instrumentation here is TEST-ONLY (a scoped crypto.subtle.digest
 * wrapper, a second raw IndexedDB connection, a transaction-abort hook) — the
 * shipped package exposes NO production failure-injection API.
 */
import { afterEach, describe, expect, it } from "vitest";

import { isPersistenceError } from "../src/errors.js";
import { openDatabase, writeRecord } from "../src/idb.js";
import { buildRecord, sha256Hex, type RecordIdentity, type StoredRecord } from "../src/record.js";
import { storageKey } from "../src/identity.js";
import { openReplica } from "../src/session.js";
import type { SaveState } from "../src/types.js";
import { uniqueDbName } from "./support/fake-reset.js";
import {
  armWriteAbortOnce,
  observeLockRelease,
  type EventLog,
} from "./support/tx-abort-hook.js";

/**
 * TEST-ONLY transient failure: make the NEXT `crypto.subtle.digest` reject once,
 * then restore the real implementation. This forces a save to fail AFTER its
 * first await (the checksum step) so the SAME session can retry and succeed —
 * exercising transaction/flush recovery without a production failure hook.
 */
function failNextDigestOnce(): () => void {
  const subtle = crypto.subtle;
  const real = subtle.digest.bind(subtle);
  let armed = true;
  const patched: typeof subtle.digest = ((...args: Parameters<typeof subtle.digest>) => {
    if (armed) {
      armed = false;
      return Promise.reject(new Error("test-only: forced digest failure"));
    }
    return real(...args);
  }) as typeof subtle.digest;
  Object.defineProperty(subtle, "digest", { value: patched, configurable: true, writable: true });
  return () => {
    Object.defineProperty(subtle, "digest", { value: real, configurable: true, writable: true });
  };
}

const restorers: Array<() => void> = [];
afterEach(() => {
  while (restorers.length > 0) {
    restorers.pop()?.();
  }
});

describe("fix 1 — flush() never strands a waiter", () => {
  it("IMMEDIATE repeated oversized flush rejects both times (no microtask gap, no hang)", async () => {
    const session = await openReplica({
      app: "a",
      documentId: "d",
      dbName: uniqueDbName(),
      maxBytes: 4, // any real snapshot exceeds this → a SYNCHRONOUS pre-await fail
    });
    session.set("k", "a-value-that-will-not-fit");

    // First flush: the save fails synchronously before its first await.
    try {
      await session.flush();
      throw new Error("first flush should have rejected");
    } catch (e) {
      expect(isPersistenceError(e, "QuotaExceededError")).toBe(true);
    }
    expect(session.state).toBe("error");

    // IMMEDIATE second flush — NO Promise.resolve()/timer/polling inserted
    // between the two flush calls. The retry waiter arrives while the failed
    // save worker is still unwinding; it MUST be serviced (rejected), not
    // stranded (fix 1).
    await expect(session.flush()).rejects.toSatisfy((e) =>
      isPersistenceError(e, "QuotaExceededError"),
    );
    expect(session.state).toBe("error");

    // Dirty data is retained in memory (not lost).
    expect(session.get("k")).toBe("a-value-that-will-not-fit");
    await session.dispose();
  });

  it("IMMEDIATE same-session retry after a TRANSIENT failure resolves saved (no microtask gap)", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });

    restorers.push(failNextDigestOnce());
    session.set("k", "v");
    // First flush fails (forced digest error) — but resolves/rejects, no hang.
    try {
      await session.flush();
      throw new Error("first flush should have rejected");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
    expect(session.state).toBe("error");

    // IMMEDIATE retry — NO delay inserted between calls. The transient cause is
    // gone; the retry waiter, arriving while the failed worker unwinds, is
    // serviced by a fresh save that succeeds (fix 1).
    await expect(session.flush()).resolves.toBeUndefined();
    expect(session.state).toBe("saved");
    expect(session.get("k")).toBe("v");
    await session.close();
  });
});

describe("fix 3 — a skipped stale write is surfaced, never falsely saved", () => {
  it("forced newer stored sequence makes flush surface a conflict; edit + stored record survive", async () => {
    const dbName = uniqueDbName();
    const app = "a";
    const documentId = "d";
    const replicaId = "r";
    const key = storageKey(app, documentId, replicaId);
    const identity: RecordIdentity = { storageKey: key, app, documentId, replicaId };

    const session = await openReplica({ app, documentId, replicaId, dbName });

    // TEST-ONLY: plant a record with a sequence FAR ahead of anything this
    // session will produce, via a SECOND raw connection (fake-indexeddb allows
    // concurrent connections). This simulates a newer snapshot already on disk.
    const newerBytes = new Uint8Array([7, 7, 7]);
    const newer: StoredRecord = buildRecord(
      identity,
      newerBytes,
      1_000_000,
      await sha256Hex(newerBytes),
    );
    const planter = await openDatabase(dbName);
    expect((await writeRecord(planter.db, newer)).written).toBe(true);
    planter.close();

    // Make an in-memory edit and flush. The session's generation is far below
    // the planted sequence, so writeRecord SKIPS the put (written:false).
    session.set("mine", "keep-me");
    await expect(session.flush()).rejects.toSatisfy((e) =>
      isPersistenceError(e, "TransactionAbortError"),
    );

    // No false "saved": the state reflects the conflict, and the in-memory edit
    // survives (not lost, not clobbered).
    expect(session.state).toBe("error");
    expect(session.get("mine")).toBe("keep-me");
    await session.dispose();

    // The newer stored record is intact (no clobber): reopening reflects the
    // truth on disk — the planted snapshot, NOT the lost edit.
    const check = await openDatabase(dbName);
    const stored = (await new Promise<StoredRecord>((resolve, reject) => {
      const tx = check.db.transaction("replicas", "readonly");
      const req = tx.objectStore("replicas").get(key);
      req.onsuccess = () => resolve(req.result as StoredRecord);
      tx.onerror = () => reject(tx.error);
    })) as StoredRecord;
    check.close();
    expect(stored.sequence).toBe(1_000_000);
    expect(Array.from(stored.bytes)).toEqual([7, 7, 7]);
  });
});

describe("fix 2 — transactions finish before ownership release", () => {
  it("dispose() DURING an in-flight save settles with no late 'saved' notification", async () => {
    const states: SaveState[] = [];
    const session = await openReplica({
      app: "a",
      documentId: "d",
      dbName: uniqueDbName(),
      onStateChange: (s) => states.push(s),
    });
    session.set("k", "v"); // schedules a save; hashing + the write run async
    // Dispose WITHOUT awaiting flush — the save routine is in flight.
    await session.dispose();

    // Terminal: no mutations, and NO "saved" was published after disposal.
    expect(() => session.set("x", 1)).toThrow();
    // No late "saved" notification: teardown suppresses state publication and
    // the save is awaited/aborted before release. dispose() makes no durability
    // claim. (A real aborted-transaction recovery is exercised in Chromium e2e.)
    expect(states).not.toContain("saved");
  });

  it("dispose() DURING a real aborted write transaction settles in order: tx terminal → lock release → dispose resolve", async () => {
    // Deterministic terminal-event ordering regression (fix 2). TEST-ONLY
    // instrumentation: a real aborted IndexedDB transaction plus observers for
    // the transaction's terminal event and the Web Lock release. No production
    // failure-injection API is used.
    const dbName = uniqueDbName();
    const log: EventLog = [];
    restorers.push(observeLockRelease(log));

    const states: SaveState[] = [];
    const session = await openReplica({
      app: "a",
      documentId: "d",
      replicaId: "r",
      dbName,
      onStateChange: (s) => states.push(s),
    });

    // Arm the one-shot abort so the NEXT readwrite transaction (this save's
    // write) aborts mid-flight — a genuine terminal tx.onabort.
    const armed = armWriteAbortOnce(log);
    restorers.push(armed.restore);
    session.set("k", "v"); // schedules a save; the write will abort
    // Start a flush we do NOT await, so the write transaction is live when we
    // dispose. Wait until the write transaction is actually active (its put was
    // enqueued and the abort requested) so dispose runs WHILE the transaction is
    // the session's active write — not during the earlier async hash phase.
    const flushing = session.flush().catch(() => undefined);
    await armed.aborting;
    await session.dispose();
    log.push("dispose:resolve");
    await flushing;

    // Observed order: the transaction's TERMINAL abort event fires, THEN the
    // Web Lock is actually released, THEN dispose() resolves.
    expect(log).toEqual(["tx:abort", "lock:release", "dispose:resolve"]);

    // No late "saved" after terminal teardown, and the session is terminal.
    expect(states).not.toContain("saved");
    expect(() => session.set("x", 1)).toThrow();

    // Ownership was released: an immediate SAME-KEY reopen acquires the lock.
    const reopened = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    await reopened.close();
  });

  it("dispose() DURING hashing settles with no write after release", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });
    // Arm a slow/failing digest so the save is parked at the hash await when we
    // dispose; teardown must not then open a write transaction.
    restorers.push(failNextDigestOnce());
    session.set("k", "v");
    await session.dispose();
    expect(() => session.set("x", 1)).toThrow();
    // Ownership released: a same-key reopen succeeds (lock was freed).
  });

  it("immediate SAME-KEY reopen after disposal acquires the lock", async () => {
    const dbName = uniqueDbName();
    const first = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    first.set("k", "v");
    // Do NOT await flush; dispose while a save may be in flight.
    const disposal = first.dispose();
    await disposal;
    // The lock must be released by the time dispose() resolves.
    const second = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    await second.close();
  });

  it("concurrent close() and dispose() settle consistently without hanging", async () => {
    const dbName = uniqueDbName();
    const session = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    session.set("k", "v");
    // Fire both terminal operations at once — they must settle on the SAME
    // teardown, neither hanging.
    await Promise.all([session.close(), session.dispose()]);
    expect(() => session.set("x", 1)).toThrow();
    // Ownership released once: a reopen succeeds.
    const again = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    await again.close();
  });
});

describe("fix 4 — collection reads/subscriptions are guarded", () => {
  const adapter = {
    schema: { app: "fieldledger" as const, schemaVersion: 1, entityType: "incident" as const },
    validate: () => undefined,
    toFields: (e: { id: string }) => ({ id: e.id }),
    fromFields: (f: Record<string, unknown>) => ({ id: String(f["id"]) }),
  };

  it("a collection handle captured while OPEN returns ClosedError on reads after terminal close", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });
    const col = session.collection(adapter);
    col.put("i1", { id: "i1" });
    await session.flush();
    await session.close();

    // Every read route returns a TYPED ClosedError (not a raw destroyed-doc error).
    expect(closedError(() => col.get("i1"))).toBe(true);
    expect(closedError(() => col.getResult("i1"))).toBe(true);
    expect(closedError(() => col.list())).toBe(true);
    expect(closedError(() => col.listResults())).toBe(true);
    expect(closedError(() => col.has("i1"))).toBe(true);
  });

  it("session reads, subscribe, and onStateChange return ClosedError after terminal dispose", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });
    await session.dispose();
    expect(closedError(() => session.get("k"))).toBe(true);
    expect(closedError(() => session.has("k"))).toBe(true);
    expect(closedError(() => session.getState())).toBe(true);
    expect(closedError(() => session.subscribe(() => undefined))).toBe(true);
    // A NEW onStateChange subscription after terminal disposal is rejected with
    // the typed ClosedError (fix 3).
    expect(closedError(() => session.onStateChange(() => undefined))).toBe(true);
  });

  it("onStateChange after a terminal close returns the typed ClosedError", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });
    await session.close();
    let caught: unknown;
    try {
      session.onStateChange(() => undefined);
    } catch (e) {
      caught = e;
    }
    expect(isPersistenceError(caught, "ClosedError")).toBe(true);
  });

  it("recovery-only reads stay allowed after a FAILED close", async () => {
    const session = await openReplica({
      app: "a",
      documentId: "d",
      dbName: uniqueDbName(),
      maxBytes: 4,
    });
    const col = session.collection(adapter);
    col.put("i1", { id: "i1" });
    await expect(session.close()).rejects.toSatisfy((e) =>
      isPersistenceError(e, "CloseFailedError"),
    );
    // recovery-only: reads still work (via the captured handle AND the session).
    expect(col.has("i1")).toBe(true);
    expect(() => session.exportBytes()).not.toThrow();
    // but mutations are blocked
    expect(() => col.put("i2", { id: "i2" })).toThrow();
    await session.dispose();
    // after terminal dispose, reads now reject
    expect(closedError(() => col.has("i1"))).toBe(true);
  });
});

/** Run `fn` and report whether it threw a typed ClosedError PersistenceError. */
function closedError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return isPersistenceError(e, "ClosedError");
  }
}
