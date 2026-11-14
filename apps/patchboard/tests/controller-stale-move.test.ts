import type { Fields } from "@ghostsync/kit";
import { describe, expect, it } from "vitest";
import { cardAdapter, type Card } from "../src/model/adapters.js";
import { formatPlacement, type ColumnId } from "../src/model/placement.js";
import { readBoard } from "../src/model/read-model.js";
import { SessionController } from "../src/session/session-controller.js";
import type { WritableCards } from "../src/model/write.js";
import type { Seams } from "./controller-seams.js";
import { assertStaleSafe, kit, stored, writtenFields } from "./helpers.js";

/** STALE-CTRL-1: the controller's rendered model is OLDER than the store (design 13.3.1). */
function fixture() {
  const replica = kit.createReplica("stale-board");
  const a = replica.collection(cardAdapter);
  const b = replica.collection(cardAdapter);
  a.put("card-s1", { title: "Original title", notes: "Original notes", placement: "todo|00001024" });
  a.put("card-s2", { title: "Second", notes: "", placement: "todo|00002048" });
  const puts: Array<[string, Card]> = [];
  const wrapped = new Proxy(a, {
    get(target, prop, receiver) {
      if (prop === "put") {
        return (id: string, e: Card) => {
          puts.push([id, e]);
          target.put(id, e);
        };
      }
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(target) : v;
    },
  });
  const c = new SessionController({} as Storage, () => undefined, () => undefined);
  const seams = c as unknown as Seams;
  seams.phase = "ready";
  seams.replicaId = "replica-1";
  seams.cards = wrapped;
  c.model = readBoard(wrapped);
  // Someone else edits the stored card; no subscribe listener exists, so the model stays old.
  b.put("card-s1", { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement: "todo|00001024" });
  // PRECONDITIONS: the fixture is really stale.
  expect(c.model.columns.todo.find((p) => p.id === "card-s1")?.card.title).toBe("Original title");
  const cur = b.getResult("card-s1");
  expect(cur.ok && cur.entity.title).toBe("Edited elsewhere");
  const before = stored(replica, "card-s1") ?? {};
  puts.length = 0;
  return { c, replica, wrapped: wrapped as unknown as WritableCards, before, puts };
}

describe("U-PB-21 production controller path with an older rendered model", () => {
  it("controller.move writes only placement and keeps the newer title and notes", () => {
    const { c, replica, before, puts } = fixture();
    c.move("card-s1", "doing");
    const after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["placement"], { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement: "doing|00001024" });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[1].title).toBe("Edited elsewhere");
    expect(puts[0]?.[1].notes).toBe("Notes edited elsewhere");
    expect(c.editError).toBeUndefined();
    expect(c.model?.columns.doing.map((p) => [p.id, p.card.title])).toEqual([["card-s1", "Edited elsewhere"]]);
  });
  it("controller.reorder writes only placement and keeps the newer title and notes", () => {
    const { c, replica, before, puts } = fixture();
    c.reorder("card-s1", 1);
    const after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["placement"], { title: "Edited elsewhere", notes: "Notes edited elsewhere", placement: "todo|00003072" });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[1].title).toBe("Edited elsewhere");
    expect(c.editError).toBeUndefined();
  });
  it("controller.saveCard touches only the field it was given", () => {
    const { c, replica, before } = fixture();
    c.saveCard("card-s1", { notes: "My notes" });
    const after = stored(replica, "card-s1") ?? {};
    assertStaleSafe(before, after, ["notes"], { title: "Edited elsewhere", notes: "My notes", placement: "todo|00001024" });
  });
  it("NEGATIVE CONTROL: a writer that uses the whole cached card is caught", () => {
    const { c, replica, wrapped, before } = fixture();
    const naiveControllerMove = (ctl: SessionController, w: WritableCards, id: string, column: ColumnId): void => {
      const cached = ctl.model?.columns.todo.find((p) => p.id === id)?.card;
      if (cached === undefined) throw new Error("fixture lost the cached card");
      w.put(id, { ...cached, placement: formatPlacement(column, 1024) });
    };
    naiveControllerMove(c, wrapped, "card-s1", "doing");
    const after: Fields = stored(replica, "card-s1") ?? {};
    expect(writtenFields(before, after)).toEqual(["notes", "placement", "title"]);
    expect(after["title"]).toBe("Original title");
    expect(() => assertStaleSafe(before, after, ["placement"], { title: "Edited elsewhere", notes: "Notes edited elsewhere" })).toThrow();
  });
  it("a card that vanished behind the model: nothing is written and a notice is shown", () => {
    const { c, replica, wrapped } = fixture();
    wrapped.delete("card-s1");
    c.move("card-s1", "doing");
    expect(stored(replica, "card-s1")).toBeUndefined();
    expect(c.notice).toBeDefined();
  });
});