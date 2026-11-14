import { describe, expect, it } from "vitest";
import { cardAdapter } from "../src/model/adapters.js";
import { commitCardFields, moveCard, reorderCard, restoreCard, type WritableCards } from "../src/model/write.js";
import { BOARD, kit, probeAdapter, stored, writtenFields } from "./helpers.js";

const WITH_LEGACY = { title: "Keep me", notes: "", placement: "todo|00001024", legacy: "x" };

function setup(records: Record<string, Record<string, string>>) {
  const replica = kit.createReplica(BOARD);
  const probe = replica.collection(probeAdapter);
  for (const [id, f] of Object.entries(records)) probe.put(id, f);
  return { replica, cards: replica.collection(cardAdapter) as WritableCards };
}

describe("U-PB-22 unknown stored fields (characterization of real Kit behavior)", () => {
  it("a card with an extra field reads as ok", () => {
    const { cards } = setup({ "card-u1": WITH_LEGACY });
    const r = cards.getResult("card-u1");
    expect(r.ok).toBe(true);
  });
  it("move drops the unknown field", () => {
    const { replica, cards } = setup({ "card-u1": WITH_LEGACY });
    const before = stored(replica, "card-u1") ?? {};
    moveCard(cards, "card-u1", "doing");
    const after = stored(replica, "card-u1") ?? {};
    expect("legacy" in after).toBe(false);
    expect(writtenFields(before, after)).toEqual(["legacy", "placement"]);
  });
  it("a notes edit drops the unknown field", () => {
    const { replica, cards } = setup({ "card-u1": WITH_LEGACY });
    const before = stored(replica, "card-u1") ?? {};
    commitCardFields(cards, "card-u1", { notes: "n" });
    expect(writtenFields(before, stored(replica, "card-u1") ?? {})).toEqual(["legacy", "notes"]);
  });
  it("reorder drops the unknown field", () => {
    const { replica, cards } = setup({
      "card-u1": WITH_LEGACY,
      "card-u2": { title: "Two", notes: "", placement: "todo|00002048" },
    });
    reorderCard(cards, "card-u1", 1);
    expect("legacy" in (stored(replica, "card-u1") ?? {})).toBe(false);
  });
  it("restore drops the unknown field of an incomplete card", () => {
    const { replica, cards } = setup({ "card-u3": { title: "T", legacy: "x" } });
    restoreCard(cards, "card-u3", () => 1024);
    const after = stored(replica, "card-u3") ?? {};
    expect("legacy" in after).toBe(false);
    expect(after).toEqual({ title: "T", notes: "", placement: "todo|00001024" });
  });
});