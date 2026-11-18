import type { Fields } from "@ghostsync/kit";
import { describe, expect, it } from "vitest";
import { cardAdapter } from "../src/model/adapters.js";
import { nextPosition } from "../src/model/position.js";
import { readBoard } from "../src/model/read-model.js";
import { deleteCard, restoreCard, type WritableCards } from "../src/model/write.js";
import { BOARD, kit, probeAdapter, stored } from "./helpers.js";

function setup(records: Record<string, Fields>) {
  const replica = kit.createReplica(BOARD);
  const probe = replica.collection(probeAdapter);
  for (const [id, f] of Object.entries(records)) probe.put(id, f);
  const cards = replica.collection(cardAdapter) as WritableCards;
  return { replica, cards, end: () => nextPosition(readBoard(cards).columns.todo.map((p) => p.position)) };
}

describe("U-PB-11 restore and discard", () => {
  it("card-inv1 style: only placement stored", () => {
    const { replica, cards, end } = setup({ "card-ok1": { title: "Valid card", notes: "", placement: "todo|00001024" }, "card-inv1": { placement: "doing|00001024" } });
    expect(restoreCard(cards, "card-inv1", end)).toBe("ok");
    expect(stored(replica, "card-inv1")).toEqual({ title: "Untitled card", notes: "", placement: "doing|00001024" });
  });
  it("card-inv2 style: malformed placement goes to the end of To do", () => {
    const { replica, cards, end } = setup({
      "card-ok1": { title: "Valid card", notes: "", placement: "todo|00001024" },
      "card-inv2": { title: "Bad placement", notes: "", placement: "archive|0001" },
    });
    expect(restoreCard(cards, "card-inv2", end)).toBe("ok");
    expect(stored(replica, "card-inv2")).toEqual({ title: "Bad placement", notes: "", placement: "todo|00002048" });
  });
  it("a missing title with other fields invalid gets every fallback", () => {
    const { replica, cards, end } = setup({ "card-inv3": { title: "<img src=x onerror=alert(1)>" } });
    expect(restoreCard(cards, "card-inv3", end)).toBe("ok");
    expect(stored(replica, "card-inv3")).toEqual({ title: "<img src=x onerror=alert(1)>", notes: "", placement: "todo|00001024" });
  });
  it("an already repaired card is a noop and an absent card is absent", () => {
    const { cards, end } = setup({ "card-a": { title: "A", notes: "", placement: "todo|00001024" } });
    expect(restoreCard(cards, "card-a", end)).toBe("noop");
    expect(restoreCard(cards, "card-zz", end)).toBe("absent");
  });
  it("Discard deletes the record", () => {
    const { replica, cards } = setup({ "card-inv1": { placement: "doing|00001024" } });
    deleteCard(cards, "card-inv1");
    expect(stored(replica, "card-inv1")).toBeUndefined();
  });
});