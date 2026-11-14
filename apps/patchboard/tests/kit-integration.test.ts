import { describe, expect, it } from "vitest";
import { cardAdapter } from "../src/model/adapters.js";
import { isSchemaMismatch } from "../src/state/errors.js";
import { addCard, commitCardFields, deleteCard, moveCard, type WritableCards } from "../src/model/write.js";
import { BOARD, exchange, kit, probeAdapter, project, shapeOf, stored } from "./helpers.js";

function peer(seed?: Uint8Array) {
  const replica = kit.createReplica(BOARD, seed);
  return { replica, cards: replica.collection(cardAdapter) as WritableCards };
}
function seeded() {
  const a = peer();
  a.cards.put("card-q", { title: "Check valve", notes: "n", placement: "todo|00001024" });
  const b = peer();
  b.replica.applyUpdate(a.replica.exportState());
  return { a, b };
}

describe("U-PB-09 CH-PB-1 / CH-PB-2 characterization (observed Kit behavior, no winner promised)", () => {
  it("CH-PB-1 delete versus edit of an existing field (title)", () => {
    const { a, b } = seeded();
    deleteCard(a.cards, "card-q");
    commitCardFields(b.cards, "card-q", { title: "Check valve 2" });
    exchange(a.replica, b.replica);
    expect(project(a.replica)).toEqual(project(b.replica));
    const shape = shapeOf(a.replica, "card-q");
    process.stdout.write(`[characterization] CH-PB-1 delete vs edit title: ${JSON.stringify(shape)}\n`);
    expect(["absent", "valid", "invalid"]).toContain(shape.kind);
  });
  it("CH-PB-2 delete versus move (placement)", () => {
    const { a, b } = seeded();
    deleteCard(a.cards, "card-q");
    moveCard(b.cards, "card-q", "doing");
    exchange(a.replica, b.replica);
    expect(project(a.replica)).toEqual(project(b.replica));
    const shape = shapeOf(a.replica, "card-q");
    process.stdout.write(`[characterization] CH-PB-2 delete vs move: ${JSON.stringify(shape)}\n`);
    expect(["absent", "valid", "invalid"]).toContain(shape.kind);
  });
});

describe("U-PB-09 merge cases (real Kit replicas)", () => {
  it("move versus edit: both survive", () => {
    const { a, b } = seeded();
    moveCard(a.cards, "card-q", "doing");
    commitCardFields(b.cards, "card-q", { title: "New title", notes: "New notes" });
    exchange(a.replica, b.replica);
    for (const p of [a, b]) expect(stored(p.replica, "card-q")).toEqual({ title: "New title", notes: "New notes", placement: "doing|00001024" });
    expect(project(a.replica)).toEqual(project(b.replica));
  });
  it("same-card moves converge to one record and one submitted placement", () => {
    const { a, b } = seeded();
    moveCard(a.cards, "card-q", "doing");
    moveCard(b.cards, "card-q", "done");
    exchange(a.replica, b.replica);
    expect(project(a.replica)).toEqual(project(b.replica));
    expect(project(a.replica)).toHaveLength(1);
    expect(["doing|00001024", "done|00001024"]).toContain(stored(a.replica, "card-q")?.["placement"]);
  });
  it("different-card moves both survive", () => {
    const a = peer();
    a.cards.put("card-y", { title: "Y", notes: "", placement: "todo|00001024" });
    a.cards.put("card-z", { title: "Z", notes: "", placement: "todo|00002048" });
    const b = peer();
    b.replica.applyUpdate(a.replica.exportState());
    moveCard(a.cards, "card-y", "doing");
    moveCard(b.cards, "card-z", "done");
    exchange(a.replica, b.replica);
    for (const p of [a, b]) {
      expect(stored(p.replica, "card-y")?.["placement"]).toBe("doing|00001024");
      expect(stored(p.replica, "card-z")?.["placement"]).toBe("done|00001024");
    }
  });
  it("same-field edits keep exactly one of the submitted titles, identical on both", () => {
    const { a, b } = seeded();
    commitCardFields(a.cards, "card-q", { title: "Alpha" });
    commitCardFields(b.cards, "card-q", { title: "Beta" });
    exchange(a.replica, b.replica);
    expect(stored(a.replica, "card-q")?.["title"]).toBe(stored(b.replica, "card-q")?.["title"]);
    expect(["Alpha", "Beta"]).toContain(stored(a.replica, "card-q")?.["title"]);
  });
  it("concurrent adds keep both cards", () => {
    const a = peer();
    const b = peer();
    addCard(a.cards, "card-n1", "Concurrent A", "");
    addCard(b.cards, "card-n2", "Concurrent B", "");
    exchange(a.replica, b.replica);
    expect(project(a.replica).map(([id]) => id)).toEqual(["card-n1", "card-n2"]);
    expect(project(a.replica)).toEqual(project(b.replica));
    expect(stored(a.replica, "card-n1")?.["placement"]).toBe(stored(a.replica, "card-n2")?.["placement"]);
  });
  it("duplicate and out-of-order imports converge", () => {
    const { a, b } = seeded();
    moveCard(a.cards, "card-q", "doing");
    commitCardFields(b.cards, "card-q", { title: "T2" });
    const ua = a.replica.exportState();
    const ub = b.replica.exportState();
    const c = peer();
    const d = peer();
    c.replica.applyUpdate(ua);
    c.replica.applyUpdate(ub);
    c.replica.applyUpdate(ub);
    d.replica.applyUpdate(ub);
    d.replica.applyUpdate(ua);
    d.replica.applyUpdate(ua);
    expect(project(c.replica)).toEqual(project(d.replica));
  });
  it("a partial-adapter record becomes an invalidRecord with preserved fields", () => {
    const a = peer();
    a.replica.collection(probeAdapter).put("card-inv", { placement: "doing|00001024" });
    const r = a.cards.getResult("card-inv");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason === "invalidRecord" && r.fields).toEqual({ placement: "doing|00001024" });
  });
  it("a real schema mismatch error is recognized", () => {
    const a = peer();
    let caught: unknown;
    try {
      a.replica.collection({ ...cardAdapter, schema: { ...cardAdapter.schema, schemaVersion: 2 } });
    } catch (e) {
      caught = e;
    }
    expect(isSchemaMismatch(caught)).toBe(true);
  });
});