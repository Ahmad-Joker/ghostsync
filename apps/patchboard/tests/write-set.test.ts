import type { Fields } from "@ghostsync/kit";
import { describe, expect, it } from "vitest";
import { cardAdapter, type Card } from "../src/model/adapters.js";
import { formatPlacement, type ColumnId } from "../src/model/placement.js";
import { addCard, commitCardFields, deleteCard, moveCard, reorderCard, type WritableCards } from "../src/model/write.js";
import { BOARD, assertStaleSafe, kit, probeAdapter, stored, writtenFields } from "./helpers.js";

function setup(records: Record<string, Fields>) {
  const replica = kit.createReplica(BOARD);
  const probe = replica.collection(probeAdapter);
  for (const [id, f] of Object.entries(records)) probe.put(id, f);
  return { replica, cards: replica.collection(cardAdapter) as WritableCards };
}
const S1: Fields = { title: "Original title", notes: "Original notes", placement: "todo|00001024" };

/** Wraps put so the entity it receives can be inspected. */
function spy(cards: WritableCards): { cards: WritableCards; puts: Array<[string, Card]> } {
  const puts: Array<[string, Card]> = [];
  return {
    puts,
    cards: {
      put: (id, e) => {
        puts.push([id, e]);
        cards.put(id, e);
      },
      getResult: (id) => cards.getResult(id),
      listResults: () => cards.listResults(),
      delete: (id) => cards.delete(id),
    },
  };
}

describe("U-PB-08 model-helper write sets (supported fields only)", () => {
  for (const column of ["doing", "done"] as const satisfies ColumnId[]) {
    it(`move to ${column} writes exactly placement`, () => {
      const { replica, cards } = setup({ "card-s1": S1 });
      const before = stored(replica, "card-s1") ?? {};
      expect(moveCard(cards, "card-s1", column)).toBe("ok");
      const after = stored(replica, "card-s1") ?? {};
      assertStaleSafe(before, after, ["placement"], { title: "Original title", notes: "Original notes", placement: `${column}|00001024` });
    });
  }
  it("move to the current column is a noop", () => {
    const { replica, cards } = setup({ "card-s1": S1 });
    const before = stored(replica, "card-s1") ?? {};
    expect(moveCard(cards, "card-s1", "todo")).toBe("noop");
    expect(writtenFields(before, stored(replica, "card-s1") ?? {})).toEqual([]);
  });
  it("move lands at the end of a populated column", () => {
    const { replica, cards } = setup({
      "card-s1": S1,
      "card-s2": { title: "Two", notes: "", placement: "doing|00001024" },
    });
    expect(moveCard(cards, "card-s1", "doing")).toBe("ok");
    expect(stored(replica, "card-s1")?.["placement"]).toBe("doing|00002048");
  });
  it("reorder down and up write exactly placement", () => {
    const { replica, cards } = setup({
      "card-s1": S1,
      "card-s2": { title: "Second", notes: "", placement: "todo|00002048" },
    });
    let before = stored(replica, "card-s1") ?? {};
    expect(reorderCard(cards, "card-s1", 1)).toBe("ok");
    let after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["placement"], { placement: "todo|00003072" });
    before = after;
    expect(reorderCard(cards, "card-s1", -1)).toBe("ok");
    after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["placement"], { placement: "todo|00001024" });
    expect(reorderCard(cards, "card-s1", -1)).toBe("noop");
  });
  it("STALE-FIX-1: a move after the store changed behind the model keeps the newer title and notes", () => {
    const { replica, cards } = setup({ "card-s1": S1 });
    const snapshot = cards.getResult("card-s1");
    cards.put("card-s1", { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement: "todo|00001024" });
    const before = stored(replica, "card-s1") ?? {};
    const s = spy(cards);
    expect(moveCard(s.cards, "card-s1", "doing")).toBe("ok");
    const after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["placement"], { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement: "doing|00001024" });
    expect(snapshot.ok && snapshot.entity.title).toBe("Original title");
    expect(s.puts).toHaveLength(1);
    expect(s.puts[0]?.[1].title).toBe("Edited elsewhere");
    expect(s.puts[0]?.[1].notes).toBe("Notes edited elsewhere");
  });
  it("negative control: a writer that uses the whole stale snapshot is flagged", () => {
    const { replica, cards } = setup({ "card-s1": S1 });
    const snapshot: Card = { title: "Original title", notes: "Original notes", placement: "todo|00001024" };
    cards.put("card-s1", { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement: "todo|00001024" });
    const before = stored(replica, "card-s1") ?? {};
    const naiveMove = (c: WritableCards, id: string, column: ColumnId): void => c.put(id, { ...snapshot, placement: formatPlacement(column, 1024) });
    naiveMove(cards, "card-s1", "doing");
    const after = stored(replica, "card-s1") ?? {};
    expect(writtenFields(before, after)).toEqual(["notes", "placement", "title"]);
    expect(after["title"]).toBe("Original title");
    expect(() => assertStaleSafe(before, after, ["placement"], { title: "Edited elsewhere" })).toThrow();
  });
  it("STALE-FIX-2: saving notes from a stale form touches only notes", () => {
    const { replica, cards } = setup({ "card-s1": S1 });
    cards.put("card-s1", { title: "Edited elsewhere", notes: "Original notes", placement: "todo|00001024" });
    const before = stored(replica, "card-s1") ?? {};
    expect(commitCardFields(cards, "card-s1", { notes: "My notes" })).toBe("ok");
    const after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["notes"], { title: "Edited elsewhere", notes: "My notes", placement: "todo|00001024" });
    // naive form writer from the OLD baseline
    const naive = (c: WritableCards): void => c.put("card-s1", { title: "Original title", notes: "Again", placement: "todo|00001024" });
    const b2 = stored(replica, "card-s1") ?? {};
    naive(cards);
    const a2 = stored(replica, "card-s1") ?? {};
    expect(writtenFields(b2, a2)).toEqual(["notes", "title"]);
    expect(() => assertStaleSafe(b2, a2, ["notes"], { title: "Edited elsewhere" })).toThrow();
  });
  it("title and notes edits preserve the current placement", () => {
    const { replica, cards } = setup({ "card-s1": { ...S1, placement: "doing|00007000" } });
    expect(commitCardFields(cards, "card-s1", { title: "New", notes: "N" })).toBe("ok");
    expect(stored(replica, "card-s1")?.["placement"]).toBe("doing|00007000");
    expect(commitCardFields(cards, "card-s1", {})).toBe("noop");
  });
  it("RN-FIX-1 renormalizes with placement-only writes", () => {
    const { replica, cards } = setup({
      "card-p1": { title: "One", notes: "", placement: "todo|00000001" },
      "card-p2": { title: "Two", notes: "", placement: "todo|00000002" },
      "card-p3": { title: "Three", notes: "", placement: "todo|00000003" },
    });
    const before = Object.fromEntries(["card-p1", "card-p2", "card-p3"].map((i) => [i, stored(replica, i) ?? {}]));
    expect(reorderCard(cards, "card-p3", -1)).toBe("ok");
    const want: Record<string, string> = { "card-p1": "todo|00001024", "card-p3": "todo|00002048", "card-p2": "todo|00003072" };
    for (const id of Object.keys(want)) {
      const after = stored(replica, id) ?? {};
      expect(after["placement"]).toBe(want[id]);
      expect(writtenFields(before[id] ?? {}, after)).toEqual(["placement"]);
    }
    expect(stored(replica, "card-p1")?.["title"]).toBe("One");
  });
  it("absent and invalid current records write nothing", () => {
    const { replica, cards } = setup({ "card-bad": { placement: "todo|00001024" } });
    const before = stored(replica, "card-bad") ?? {};
    expect(moveCard(cards, "card-bad", "doing")).toBe("invalid");
    expect(reorderCard(cards, "card-bad", 1)).toBe("invalid");
    expect(commitCardFields(cards, "card-bad", { title: "x" })).toBe("invalid");
    expect(moveCard(cards, "card-none", "doing")).toBe("absent");
    expect(commitCardFields(cards, "card-none", { title: "x" })).toBe("absent");
    expect(stored(replica, "card-bad")).toEqual(before);
    expect(stored(replica, "card-none")).toBeUndefined();
  });
  it("addCard appends to To do and writes a new record; delete removes it", () => {
    const { replica, cards } = setup({ "card-s1": S1 });
    expect(addCard(cards, "card-n1", "New", "")).toBe("ok");
    expect(stored(replica, "card-n1")).toEqual({ title: "New", notes: "", placement: "todo|00002048" });
    deleteCard(cards, "card-n1");
    expect(stored(replica, "card-n1")).toBeUndefined();
  });
});