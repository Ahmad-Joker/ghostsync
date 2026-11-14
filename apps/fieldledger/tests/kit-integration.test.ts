import { describe, expect, it } from "vitest";
import { createKit } from "@ghostsync/kit";
import type { Collection, Replica } from "@ghostsync/kit";
import { checklistItemAdapter, incidentAdapter, type ChecklistItem, type IncidentDetails } from "../src/model/adapters.js";
import { readModel } from "../src/model/read-model.js";
import { addItem, commitIncidentField, commitItemField, createIncident, discardItem, restoreItem } from "../src/model/write.js";

const kit = createKit();
const DOC = "inc-2026-0042";

interface Peer {
  r: Replica;
  items: Collection<ChecklistItem>;
  incidents: Collection<IncidentDetails>;
}
function peer(seed?: Uint8Array): Peer {
  const r = kit.createReplica(DOC, seed);
  return { r, items: r.collection(checklistItemAdapter), incidents: r.collection(incidentAdapter) };
}
function exchange(a: Replica, b: Replica): void {
  a.applyUpdate(b.exportState());
  b.applyUpdate(a.exportState());
}

describe("write helpers against real Kit replicas", () => {
  it("writes only the changed field: a stale field value is not clobbered", () => {
    const a = peer();
    const b = peer();
    addItem(a.items, "ci-1", "Close inlet", "ra", 1);
    exchange(a.r, b.r);
    // A edits text; B toggles done concurrently (different leaf keys of one record).
    commitItemField(a.items, "ci-1", "text", "Close inlet valve");
    commitItemField(b.items, "ci-1", "done", true);
    exchange(a.r, b.r);
    for (const p of [a, b]) {
      const r = p.items.getResult("ci-1");
      expect(r.ok && r.entity.text).toBe("Close inlet valve");
      expect(r.ok && r.entity.done).toBe(true);
    }
  });

  it("different items edited concurrently both survive", () => {
    const a = peer();
    const b = peer();
    addItem(a.items, "ci-x", "X", "ra", 1);
    addItem(a.items, "ci-y", "Y", "ra", 1);
    exchange(a.r, b.r);
    commitItemField(a.items, "ci-x", "text", "X2");
    commitItemField(b.items, "ci-y", "text", "Y2");
    exchange(a.r, b.r);
    const texts = (p: Peer): string[] => readModel(p.incidents, p.items).items.map(([, i]) => i.text);
    expect(texts(a)).toEqual(texts(b));
    expect(texts(a).sort()).toEqual(["X2", "Y2"]);
  });

  it("same-field conflict resolves to exactly one submitted value, identical on both", () => {
    const a = peer();
    const b = peer();
    createIncident(a.incidents, "base");
    exchange(a.r, b.r);
    commitIncidentField(a.incidents, "title", "Title from A");
    commitIncidentField(b.incidents, "title", "Title from B");
    exchange(a.r, b.r);
    const ta = readModel(a.incidents, a.items).incident;
    const tb = readModel(b.incidents, b.items).incident;
    expect(ta).toEqual(tb);
    expect(ta.kind === "ok" && ["Title from A", "Title from B"].includes(ta.value.title)).toBe(true);
  });

  it("createIncident never overwrites an existing record", () => {
    const a = peer();
    expect(createIncident(a.incidents, "one")).toBe(true);
    expect(createIncident(a.incidents, "two")).toBe(false);
    const m = readModel(a.incidents, a.items).incident;
    expect(m.kind === "ok" && m.value.title).toBe("one");
  });

  it("listResults surfaces a partial-adapter record as invalidRecord and Restore repairs it explicitly", () => {
    const a = peer();
    const partial = {
      schema: checklistItemAdapter.schema,
      validate: (): void => undefined,
      toFields: (e: { text: string }) => ({ text: e.text }),
      fromFields: (f: Record<string, unknown>) => f as never,
    };
    const writer = kit.createReplica(DOC);
    writer.collection(partial as never).put("ci-q1", { text: "Half item" } as never);
    a.r.applyUpdate(writer.exportState());
    writer.destroy();
    // list() hides it; listResults() surfaces it.
    expect(a.items.list().map(([id]) => id)).not.toContain("ci-q1");
    const m = readModel(a.incidents, a.items);
    expect(m.items).toEqual([]);
    expect(m.invalid).toEqual([{ id: "ci-q1", fields: { text: "Half item" } }]);
    restoreItem(a.items, "ci-q1", m.invalid[0]?.fields ?? {}, "ra", 7);
    const after = readModel(a.incidents, a.items);
    expect(after.invalid).toEqual([]);
    expect(after.items[0]?.[1]).toMatchObject({ text: "Half item", done: false, sortKey: 1024, createdBy: "ra", createdAt: 7 });
  });
});

describe("delete versus edit of an EXISTING field (E2E-FL-08 Kit-level characterization)", () => {
  it("converges to one of the enumerated shapes; observed shape is logged", () => {
    const base = peer();
    addItem(base.items, "ci-q", "Check valve", "rb", 1);
    const seed = base.r.exportState().bytes;
    const a = peer(seed);
    const b = peer(seed);
    discardItem(a.items, "ci-q");
    commitItemField(b.items, "ci-q", "text", "Check valve seat");
    exchange(a.r, b.r);
    const project = (p: Peer): unknown => p.items.listResults().map(([id, r]) => [id, r.ok ? { entity: r.entity } : r.reason === "invalidRecord" ? { invalid: r.fields } : { absent: true }]);
    expect(project(a)).toEqual(project(b));
    expect(a.r.getState()).toEqual(b.r.getState());
    const q = a.items.listResults().find(([id]) => id === "ci-q");
    let shape: string;
    if (q === undefined) shape = "absent";
    else if (q[1].ok) {
      expect(q[1].entity.text).toBe("Check valve seat");
      shape = "valid-with-edit";
    } else {
      expect(q[1].reason).toBe("invalidRecord");
      shape = `invalidRecord fields=${JSON.stringify(q[1].reason === "invalidRecord" ? q[1].fields : null)}`;
    }
    process.stdout.write(`[characterization] delete-vs-edit(existing field) observed shape: ${shape}\n`);
    expect(["absent", "valid-with-edit"].includes(shape) || shape.startsWith("invalidRecord")).toBe(true);
  });
});
