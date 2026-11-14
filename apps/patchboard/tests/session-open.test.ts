import { PersistenceError, type PersistSession } from "@ghostsync/persist";
import { createKit } from "@ghostsync/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardAdapter } from "../src/model/adapters.js";
import { SessionController, type SessionDeps } from "../src/session/session-controller.js";
import { SCHEMA_MISMATCH_MESSAGE } from "../src/state/errors.js";

function storage(failing = false): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => {
      if (failing) throw new Error("blocked");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (failing) throw new Error("blocked");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
}

function fakeSession(opts: { schemaMismatch?: boolean } = {}): { session: PersistSession; dispose: ReturnType<typeof vi.fn> } {
  const replica = createKit().createReplica("sprint-board");
  const dispose = vi.fn(() => Promise.resolve());
  const session = {
    restored: false,
    state: "saved",
    collection: () => {
      if (opts.schemaMismatch) throw new Error("GhostSync Kit: schema mismatch for collection patchboard/card: stored x != adapter y");
      return replica.collection(cardAdapter);
    },
    subscribe: () => () => undefined,
    dispose,
  } as unknown as PersistSession;
  return { session, dispose };
}

beforeEach(() => {
  vi.stubGlobal("history", { replaceState: () => undefined });
  vi.stubGlobal("location", { pathname: "/", search: "" });
});
afterEach(() => vi.unstubAllGlobals());

describe("U-PB-20 session open", () => {
  it("opens with the board id as documentId, the stable replica id and the app settings", async () => {
    const { session } = fakeSession();
    const calls: Array<Parameters<SessionDeps["openReplica"]>[0]> = [];
    const deps: SessionDeps = { openReplica: (o) => (calls.push(o), Promise.resolve(session)) };
    const s = storage();
    const c = new SessionController(s, () => undefined, () => undefined, deps);
    expect(await c.open("  Sprint-Board ")).toBe(true);
    expect(c.phase).toBe("ready");
    expect(calls).toHaveLength(1);
    const o = calls[0];
    expect(o?.app).toBe("patchboard");
    expect(o?.documentId).toBe("sprint-board");
    expect(o?.dbName).toBe("patchboard");
    expect(o?.maxBytes).toBe(8 * 1024 * 1024);
    expect(o?.replicaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.getItem("patchboard.replicaId.v1.sprint-board")).toBe(o?.replicaId);
    expect(c.revision).toBe(1);
    // A second controller on the same storage reuses the replica id.
    const calls2: string[] = [];
    const c2 = new SessionController(s, () => undefined, () => undefined, { openReplica: (op) => (calls2.push(op.replicaId ?? ""), Promise.resolve(fakeSession().session)) });
    await c2.open("sprint-board");
    expect(calls2).toEqual([o?.replicaId]);
  });
  it("an invalid board id stays on join and opens nothing", async () => {
    let opened = 0;
    const c = new SessionController(storage(), () => undefined, () => undefined, { openReplica: () => (opened++, Promise.reject(new Error("no"))) });
    expect(await c.open("ab")).toBe(false);
    expect(c.phase).toBe("join");
    expect(c.joinMessage).toContain("not valid");
    expect(opened).toBe(0);
  });
  it("StorageInUseError gives the in-use phase and a retry action", async () => {
    const c = new SessionController(storage(), () => undefined, () => undefined, {
      openReplica: () => Promise.reject(new PersistenceError("StorageInUseError", "in use")),
    });
    expect(await c.open("sprint-board")).toBe(false);
    expect(c.phase).toBe("in-use");
    expect(c.errorAllowsRetry).toBe(true);
  });
  it("other persistence errors give the error phase", async () => {
    const c = new SessionController(storage(), () => undefined, () => undefined, {
      openReplica: () => Promise.reject(new PersistenceError("InvalidRecordError", "bad")),
    });
    await c.open("sprint-board");
    expect(c.phase).toBe("error");
    expect(c.errorMessage).toContain("Open a different board");
  });
  it("a schema mismatch on first read disposes the session", async () => {
    const { session, dispose } = fakeSession({ schemaMismatch: true });
    const c = new SessionController(storage(), () => undefined, () => undefined, { openReplica: () => Promise.resolve(session) });
    expect(await c.open("sprint-board")).toBe(false);
    expect(c.phase).toBe("error");
    expect(c.errorMessage).toBe(SCHEMA_MISMATCH_MESSAGE);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("blocked local storage fails before opening a session", async () => {
    let opened = 0;
    const c = new SessionController(storage(true), () => undefined, () => undefined, { openReplica: () => (opened++, Promise.reject(new Error("no"))) });
    expect(await c.open("sprint-board")).toBe(false);
    expect(c.phase).toBe("error");
    expect(opened).toBe(0);
  });
});