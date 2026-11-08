/**
 * REQ-BP-003 — dirty/saving/saved/error transitions, flush, restore, generation
 * restoration, close/dispose, recovery-only. Node unit on fake-indexeddb +
 * mocked Web Locks — FAST FEEDBACK, NOT acceptance evidence (REQ-BP-007).
 */
import { describe, expect, it } from "vitest";

import { isPersistenceError } from "../src/errors.js";
import { openReplica } from "../src/session.js";
import type { SaveState } from "../src/types.js";
import { incidentAdapter } from "./support/incident-adapter.js";
import { uniqueDbName } from "./support/fake-reset.js";

describe("save-state machine (REQ-BP-003)", () => {
  it("fresh open is restored:false and transitions dirty→saving→saved on flush", async () => {
    const states: SaveState[] = [];
    const session = await openReplica({
      app: "fieldledger",
      documentId: "doc",
      dbName: uniqueDbName(),
      onStateChange: (s) => states.push(s),
    });
    expect(session.restored).toBe(false);

    session.set("status", "open");
    expect(session.state).toBe("dirty");
    await session.flush();
    expect(session.state).toBe("saved");
    expect(states).toContain("dirty");
    expect(states).toContain("saving");
    expect(states).toContain("saved");
    await session.close();
  });

  it("flush() with no pending edits resolves immediately", async () => {
    const session = await openReplica({
      app: "a",
      documentId: "d",
      dbName: uniqueDbName(),
    });
    await expect(session.flush()).resolves.toBeUndefined();
    await session.close();
  });

  it("persists legacy + structured edits and restores them after reopen", async () => {
    const dbName = uniqueDbName();
    const replicaId = "r-fixed";
    const s1 = await openReplica({ app: "fieldledger", documentId: "doc", replicaId, dbName });
    s1.set("status", "open");
    s1.collection(incidentAdapter).put("i1", { id: "i1", title: "Leak", priority: 2 });
    await s1.flush();
    await s1.close();

    const s2 = await openReplica({ app: "fieldledger", documentId: "doc", replicaId, dbName });
    expect(s2.restored).toBe(true);
    expect(s2.get("status")).toBe("open");
    expect(s2.collection(incidentAdapter).get("i1")).toEqual({
      id: "i1",
      title: "Leak",
      priority: 2,
    });
    await s2.close();
  });

  it("repeated reopen/edit/save cycles advance the sequence and retain latest", async () => {
    const dbName = uniqueDbName();
    const replicaId = "r-cycle";
    let lastSeq = -1;
    for (let i = 0; i < 4; i++) {
      let seq = -1;
      const s = await openReplica({
        app: "a",
        documentId: "d",
        replicaId,
        dbName,
        onStateChange: (_st, info) => {
          seq = info.sequence;
        },
      });
      s.set("counter", i);
      await s.flush();
      expect(seq).toBeGreaterThan(lastSeq);
      lastSeq = seq;
      await s.close();
    }
    const final = await openReplica({ app: "a", documentId: "d", replicaId, dbName });
    expect(final.get("counter")).toBe(3);
    await final.close();
  });

  it("same document, different replicaId stay isolated", async () => {
    const dbName = uniqueDbName();
    const a = await openReplica({ app: "app", documentId: "doc", replicaId: "rA", dbName });
    const b = await openReplica({ app: "app", documentId: "doc", replicaId: "rB", dbName });
    expect(a.storageKey).not.toBe(b.storageKey);
    a.set("who", "A");
    b.set("who", "B");
    await a.flush();
    await b.flush();
    await a.close();
    await b.close();

    const a2 = await openReplica({ app: "app", documentId: "doc", replicaId: "rA", dbName });
    const b2 = await openReplica({ app: "app", documentId: "doc", replicaId: "rB", dbName });
    expect(a2.get("who")).toBe("A");
    expect(b2.get("who")).toBe("B");
    await a2.close();
    await b2.close();
  });
});

describe("close / dispose lifecycle (REQ-BP-003-7, clarification 1)", () => {
  it("successful close rejects all operational methods and collection handles", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });
    const col = session.collection(incidentAdapter);
    session.set("x", 1);
    await session.close();

    expect(() => session.set("y", 2)).toThrow();
    expect(() => session.get("x")).toThrow();
    expect(() => col.put("i", { id: "i", title: "t", priority: 1 })).toThrow();
    expect(() => session.exportBytes()).toThrow();
    await expect(session.flush()).rejects.toSatisfy((e) => isPersistenceError(e, "ClosedError"));
  });

  it("close() and dispose() are idempotent", async () => {
    const session = await openReplica({ app: "a", documentId: "d", dbName: uniqueDbName() });
    await session.close();
    await expect(session.close()).resolves.toBeUndefined();
    await expect(session.dispose()).resolves.toBeUndefined();
  });

  it("dispose() releases ownership without claiming a save", async () => {
    const dbName = uniqueDbName();
    const session = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    session.set("unsaved", 1);
    await session.dispose();
    expect(() => session.set("x", 2)).toThrow();
    // Ownership released: a new session can open the same key.
    const again = await openReplica({ app: "a", documentId: "d", replicaId: "r", dbName });
    await again.close();
  });
});
