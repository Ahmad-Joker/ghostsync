import { describe, expect, it } from "vitest";
import { encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import { checklistItemAdapter, incidentAdapter } from "../src/model/adapters.js";
import { readModel } from "../src/model/read-model.js";
import { SessionController } from "../src/session/session-controller.js";
import { capMetaValue, META_VALUE_MAX, metaLines } from "../src/transfer/capsule-meta.js";

const DOC = "inc-2026-0042";

describe("capMetaValue (AC-FL-013-7)", () => {
  it("keeps 80 characters exactly, truncates 81 and more to 80 shown characters ending in an ellipsis", () => {
    expect(META_VALUE_MAX).toBe(80);
    const v80 = "a".repeat(80);
    expect(capMetaValue(v80)).toBe(v80);
    const v81 = "a".repeat(81);
    expect(capMetaValue(v81)).toBe(`${"a".repeat(79)}…`);
    expect(Array.from(capMetaValue(v81))).toHaveLength(80);
    expect(Array.from(capMetaValue("b".repeat(5000)))).toHaveLength(80);
  });

  it("counts code points so a surrogate pair is never split", () => {
    const emoji = "😀".repeat(81);
    const out = capMetaValue(emoji);
    expect(Array.from(out)).toHaveLength(80);
    expect(out).toBe(`${"😀".repeat(79)}…`);
    expect(capMetaValue("😀".repeat(80))).toBe("😀".repeat(80));
  });

  it("returns HTML-looking input unchanged as literal text and handles empty/undefined", () => {
    const html = '<img src=x onerror="alert(1)"><b>x</b>';
    expect(capMetaValue(html)).toBe(html);
    expect(capMetaValue("")).toBe("");
    expect(capMetaValue(undefined)).toBe("");
  });
});

describe("metaLines", () => {
  it("gives the three labelled lines with stable test ids, each value capped", () => {
    const lines = metaLines({ app: "fieldledger", documentId: DOC, createdAt: "x".repeat(100) });
    expect(lines.map((l) => [l.testId, l.label])).toEqual([
      ["import-meta-app", "Capsule app"],
      ["import-meta-document-id", "Document"],
      ["import-meta-created-at", "Created"],
    ]);
    expect(lines.map((l) => l.value)).toEqual(["fieldledger", DOC, `${"x".repeat(79)}…`]);
  });

  it("gives no lines without metadata (rejected result)", () => {
    expect(metaLines(undefined)).toEqual([]);
  });
});

interface Seams {
  phase: string;
  session: unknown;
  documentId: string;
  incidents: unknown;
  items: unknown;
  onSaveState(state: string, info: { sequence: number }): void;
}

async function capsuleBytes(): Promise<Uint8Array> {
  const r = createKit().createReplica(DOC);
  try {
    r.collection(checklistItemAdapter).put("ci-1", { text: "From peer", done: false, sortKey: 1024, createdBy: "peer", createdAt: 1 });
    return await encodeCapsule({ app: "fieldledger", documentId: DOC, update: r.exportState() });
  } finally {
    r.destroy();
  }
}

/** A controller over a fake persisted target whose flush can be made to fail. */
function controllerWithTarget(flushFails: { on: boolean }): SessionController {
  const kitReplica = createKit().createReplica(DOC);
  const incidents = kitReplica.collection(incidentAdapter);
  const items = kitReplica.collection(checklistItemAdapter);
  const c = new SessionController({} as Storage, () => undefined, () => undefined);
  const s = c as unknown as Seams;
  s.phase = "ready";
  s.documentId = DOC;
  s.incidents = incidents;
  s.items = items;
  c.model = readModel(incidents, items);
  s.session = {
    identity: { app: "fieldledger", documentId: DOC, replicaId: "r1" },
    applyUpdate: (carrier: Parameters<typeof kitReplica.applyUpdate>[0]) => kitReplica.applyUpdate(carrier),
    flush: () => {
      if (flushFails.on) return Promise.reject(Object.assign(new Error("aborted"), { name: "PersistenceError", code: "TransactionAbortError" }));
      s.onSaveState("saved", { sequence: 2 });
      return Promise.resolve();
    },
  };
  return c;
}

/** Make every later collection read throw a schema mismatch (as after a newer-schema capsule is applied). */
function breakReads(c: SessionController): void {
  const s = c as unknown as Seams;
  const throwing = {
    listResults: (): never => {
      throw Object.assign(new Error("schema mismatch"), { name: "SchemaMismatchError" });
    },
  };
  s.incidents = throwing;
  s.items = throwing;
}

const fileOf = (bytes: Uint8Array): File => new File([bytes as BlobPart], "peer.gscap");

describe("ImportView carries capsule metadata", () => {
  it("applied-saved keeps app, documentId and createdAt", async () => {
    const c = controllerWithTarget({ on: false });
    await c.importFile(fileOf(await capsuleBytes()));
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.metadata?.app).toBe("fieldledger");
    expect(c.importView?.metadata?.documentId).toBe(DOC);
    expect(c.importView?.metadata?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(metaLines(c.importView?.metadata).map((l) => l.value)).toEqual(["fieldledger", DOC, c.importView?.metadata?.createdAt]);
  });

  it("applied-unsaved carries it, and a successful retry keeps the SAME metadata object", async () => {
    const fail = { on: true };
    const c = controllerWithTarget(fail);
    await c.importFile(fileOf(await capsuleBytes()));
    expect(c.importView?.state).toBe("applied-unsaved");
    const meta = c.importView?.metadata;
    expect(meta?.app).toBe("fieldledger");
    expect(meta?.documentId).toBe(DOC);
    fail.on = false;
    await c.retrySave();
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.metadata).toBe(meta);
  });

  it("success path: readable result has a diff and no stale flag", async () => {
    const c = controllerWithTarget({ on: false });
    await c.importFile(fileOf(await capsuleBytes()));
    expect(c.importView?.workspaceStale).toBeUndefined();
    expect(c.importView?.diff?.noChanges).toBe(false);
  });

  it("failed post-import refresh (applied-saved): last model kept, diff suppressed, stale flag set, metadata kept", async () => {
    const c = controllerWithTarget({ on: false });
    const lastGood = c.model;
    const bytes = await capsuleBytes();
    breakReads(c);
    await c.importFile(fileOf(bytes));
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.diff).toBeUndefined();
    expect("diff" in (c.importView ?? {})).toBe(false);
    expect(c.importView?.workspaceStale).toBe(true);
    expect(c.importView?.metadata?.documentId).toBe(DOC);
    expect(c.model).toBe(lastGood);
  });

  it("failed post-import refresh (applied-unsaved): stale flag survives a successful Retry save, diff stays absent", async () => {
    const fail = { on: true };
    const c = controllerWithTarget(fail);
    const bytes = await capsuleBytes();
    breakReads(c);
    await c.importFile(fileOf(bytes));
    expect(c.importView?.state).toBe("applied-unsaved");
    expect(c.importView?.code).toBe("TransactionAbortError");
    expect(c.importView?.workspaceStale).toBe(true);
    expect(c.importView?.diff).toBeUndefined();
    const meta = c.importView?.metadata;
    expect(meta?.documentId).toBe(DOC);
    fail.on = false;
    await c.retrySave();
    expect(c.importView?.state).toBe("applied-saved");
    expect(c.importView?.workspaceStale).toBe(true);
    expect(c.importView?.diff).toBeUndefined();
    expect(c.importView?.metadata).toBe(meta);
  });

  it("a rejected import shows no metadata and no stale values from the previous import", async () => {
    const c = controllerWithTarget({ on: false });
    await c.importFile(fileOf(await capsuleBytes()));
    expect(c.importView?.metadata).toBeDefined();
    await c.importFile(fileOf(new Uint8Array([1, 2, 3])));
    expect(c.importView?.state).toBe("rejected");
    expect(c.importView?.metadata).toBeUndefined();
    expect(metaLines(c.importView?.metadata)).toEqual([]);
  });
});
