import { DEFAULT_MAX_CAPSULE_BYTES, encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardAdapter } from "../src/model/adapters.js";
import { readBoard } from "../src/model/read-model.js";
import { SessionController } from "../src/session/session-controller.js";
import { metaLines } from "../src/transfer/capsule-meta.js";
import type { Seams } from "./controller-seams.js";

const BOARD = "test-board";

async function capsuleBytes(app = "patchboard", documentId = BOARD): Promise<Uint8Array> {
  const r = createKit().createReplica(documentId);
  try {
    r.collection(cardAdapter).put("card-peer", { title: "From peer", notes: "", placement: "todo|00001024" });
    return await encodeCapsule({ app, documentId, update: r.exportState() });
  } finally {
    r.destroy();
  }
}

/** A controller over a fake persisted target whose flush can be made to fail. */
function controllerWithTarget(flushFails: { on: boolean }): SessionController {
  const replica = createKit().createReplica(BOARD);
  const cards = replica.collection(cardAdapter);
  const c = new SessionController({} as Storage, () => undefined, () => undefined);
  const s = c as unknown as Seams;
  s.phase = "ready";
  s.boardId = BOARD;
  s.cards = cards;
  c.model = readBoard(cards);
  s.session = {
    identity: { app: "patchboard", documentId: BOARD, replicaId: "r1" },
    applyUpdate: (carrier: Parameters<typeof replica.applyUpdate>[0]) => replica.applyUpdate(carrier),
    flush: () => {
      if (flushFails.on) return Promise.reject(Object.assign(new Error("aborted"), { name: "PersistenceError", code: "TransactionAbortError" }));
      s.onSaveState("saved", { sequence: 2 });
      return Promise.resolve();
    },
  };
  return c;
}

function breakReads(c: SessionController): void {
  (c as unknown as Seams).cards = {
    listResults: (): never => {
      throw Object.assign(new Error("schema mismatch"), { name: "SchemaMismatchError" });
    },
  };
}

const fileOf = (bytes: Uint8Array): File => new File([bytes as BlobPart], "peer.gscap");

describe("U-PB-18 import flow", () => {
  it("applied-saved keeps app, documentId and createdAt and has a diff", async () => {
    const c = controllerWithTarget({ on: false });
    await c.importFile(fileOf(await capsuleBytes()));
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.metadata?.app).toBe("patchboard");
    expect(c.importView?.metadata?.documentId).toBe(BOARD);
    expect(metaLines(c.importView?.metadata).map((l) => l.value)).toEqual(["patchboard", BOARD, c.importView?.metadata?.createdAt]);
    expect(c.importView?.workspaceStale).toBeUndefined();
    expect(c.importView?.diff).toEqual(["Added: From peer in To do"]);
  });
  it("an empty diff on a duplicate import", async () => {
    const c = controllerWithTarget({ on: false });
    const bytes = await capsuleBytes();
    await c.importFile(fileOf(bytes));
    await c.importFile(fileOf(bytes));
    expect(c.importView?.diff).toEqual([]);
  });
  it("applied-unsaved carries metadata and a successful retry keeps the SAME metadata", async () => {
    const fail = { on: true };
    const c = controllerWithTarget(fail);
    await c.importFile(fileOf(await capsuleBytes()));
    expect(c.importView?.state).toBe("applied-unsaved");
    expect(c.importView?.code).toBe("TransactionAbortError");
    const meta = c.importView?.metadata;
    fail.on = false;
    await c.retrySave();
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.metadata).toBe(meta);
  });
  it("failed post-import refresh: last model kept, diff suppressed, stale flag set", async () => {
    const c = controllerWithTarget({ on: false });
    const lastGood = c.model;
    const bytes = await capsuleBytes();
    breakReads(c);
    await c.importFile(fileOf(bytes));
    expect(c.importView?.state).toBe("applied-saved");
    expect("diff" in (c.importView ?? {})).toBe(false);
    expect(c.importView?.workspaceStale).toBe(true);
    expect(c.importView?.metadata?.documentId).toBe(BOARD);
    expect(c.model).toBe(lastGood);
  });
  it("stale flag survives Retry save", async () => {
    const fail = { on: true };
    const c = controllerWithTarget(fail);
    const bytes = await capsuleBytes();
    breakReads(c);
    await c.importFile(fileOf(bytes));
    expect(c.importView?.state).toBe("applied-unsaved");
    expect(c.importView?.workspaceStale).toBe(true);
    fail.on = false;
    await c.retrySave();
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.workspaceStale).toBe(true);
    expect(c.importView?.diff).toBeUndefined();
  });
  it("wrong board and wrong app are rejected without touching the board", async () => {
    const c = controllerWithTarget({ on: false });
    const revision = c.revision;
    await c.importFile(fileOf(await capsuleBytes("patchboard", "other-board")));
    expect(c.importView?.state).toBe("rejected");
    expect(c.importView?.code).toBe("DocumentIdentityMismatch");
    expect(c.importView?.message).toContain("other-board");
    expect(c.importView?.message.endsWith("Nothing was changed.")).toBe(true);
    await c.importFile(fileOf(await capsuleBytes("fieldledger", BOARD)));
    expect(c.importView?.code).toBe("AppIdentityMismatch");
    expect(c.importView?.message).toContain("fieldledger");
    expect(c.importView?.metadata).toBeUndefined();
    expect(c.model?.columns.todo).toEqual([]);
    expect(c.revision).toBe(revision);
  });
  it("garbage bytes are rejected as Malformed", async () => {
    const c = controllerWithTarget({ on: false });
    await c.importFile(fileOf(new Uint8Array([1, 2, 3])));
    expect(c.importView?.state).toBe("rejected");
    expect(c.importView?.code).toBe("Malformed");
  });
  it("an oversized file is rejected before it is read", async () => {
    const c = controllerWithTarget({ on: false });
    let read = false;
    const big = {
      size: DEFAULT_MAX_CAPSULE_BYTES + 1,
      arrayBuffer: () => {
        read = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as File;
    await c.importFile(big);
    expect(c.importView?.code).toBe("OversizedRaw");
    expect(read).toBe(false);
  });
  it("only one import runs at a time", async () => {
    const c = controllerWithTarget({ on: false });
    const bytes = await capsuleBytes();
    let reads = 0;
    const slow = {
      size: bytes.length,
      arrayBuffer: () => {
        reads += 1;
        return new Promise<ArrayBuffer>((res) => setTimeout(() => res(bytes.buffer.slice(0) as ArrayBuffer), 20));
      },
    } as unknown as File;
    const first = c.importFile(slow);
    await c.importFile(slow);
    await first;
    expect(reads).toBe(1);
  });
});

interface Deferred {
  readonly file: File;
  readonly release: (mode?: "ok" | "fail") => void;
}

/** A file whose arrayBuffer() resolves only when the test releases it. */
function delayedFile(bytes: Uint8Array): Deferred {
  let resolve: (b: ArrayBuffer) => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const pending = new Promise<ArrayBuffer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const file = { size: bytes.length, arrayBuffer: () => pending } as unknown as File;
  return {
    file,
    release: (mode = "ok") => (mode === "ok" ? resolve(bytes.buffer.slice(0) as ArrayBuffer) : reject(new Error("read failed"))),
  };
}

function lifecycle() {
  vi.stubGlobal("history", { replaceState: () => undefined });
  vi.stubGlobal("location", { pathname: "/", search: "" });
  const calls = { close: 0, dispose: 0, flush: 0, notify: 0 };
  const replica = createKit().createReplica(BOARD);
  const cards = replica.collection(cardAdapter);
  const c = new SessionController({} as Storage, () => void (calls.notify += 1), () => undefined);
  const s = c as unknown as Seams;
  s.phase = "ready";
  s.boardId = BOARD;
  s.cards = cards;
  c.model = readBoard(cards);
  s.session = {
    identity: { app: "patchboard", documentId: BOARD, replicaId: "r1" },
    applyUpdate: (carrier: Parameters<typeof replica.applyUpdate>[0]) => replica.applyUpdate(carrier),
    flush: () => {
      calls.flush += 1;
      return Promise.resolve();
    },
    close: () => {
      calls.close += 1;
      return Promise.resolve();
    },
    dispose: () => {
      calls.dispose += 1;
      return Promise.resolve();
    },
  };
  return { c, s, calls };
}

describe("U-PB-19 import lifecycle guard", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["ok", "fail"] as const)("Change board and Update now are refused while an import is pending, and work after it ends (%s)", async (mode) => {
    const { c, calls } = lifecycle();
    const d = delayedFile(await capsuleBytes());
    const running = c.importFile(d.file);
    expect(c.importPending).toBe(true);
    let applied = 0;
    await c.changeBoard();
    expect(await c.requestUpdate(() => void (applied += 1))).toBe(false);
    expect(calls.close).toBe(0);
    expect(calls.flush).toBe(0);
    expect(applied).toBe(0);
    expect(c.phase).toBe("ready");
    d.release(mode);
    await running;
    expect(c.importPending).toBe(false);
    expect(c.importView?.state).toBe(mode === "ok" ? "applied-saved" : "rejected");
    expect(await c.requestUpdate(() => void (applied += 1))).toBe(true);
    expect(applied).toBe(1);
    await c.changeBoard();
    expect(calls.close).toBe(1);
    expect(c.phase).toBe("join");
  });

  it("a rejected capsule also re-enables both actions", async () => {
    const { c, calls } = lifecycle();
    const d = delayedFile(new Uint8Array([1, 2, 3]));
    const running = c.importFile(d.file);
    expect(c.importPending).toBe(true);
    d.release();
    await running;
    expect(c.importView?.state).toBe("rejected");
    expect(c.importPending).toBe(false);
    await c.changeBoard();
    expect(calls.close).toBe(1);
  });

  it.each(["ok", "fail"] as const)("an old import result is discarded after the session changed (%s)", async (mode) => {
    const { c, s, calls } = lifecycle();
    const d = delayedFile(await capsuleBytes());
    const running = c.importFile(d.file);
    // The session ends underneath the import, then another board becomes current.
    await c.discardAndSwitch();
    expect(calls.dispose).toBe(1);
    const other = createKit().createReplica("other-board");
    const otherCards = other.collection(cardAdapter);
    s.phase = "ready";
    s.boardId = "other-board";
    s.cards = otherCards;
    c.model = readBoard(otherCards);
    let otherFlushes = 0;
    s.session = {
      identity: { app: "patchboard", documentId: "other-board", replicaId: "r1" },
      applyUpdate: () => {
        throw new Error("the old import must not touch the new session");
      },
      flush: () => {
        otherFlushes += 1;
        return Promise.resolve();
      },
    };
    const model = c.model;
    const revision = c.revision;
    const notified = calls.notify;
    d.release(mode);
    await running;
    expect(c.importView).toBeUndefined();
    expect(c.model).toBe(model);
    expect(c.revision).toBe(revision);
    expect(calls.notify).toBe(notified);
    expect(otherFlushes).toBe(0);
  });
});