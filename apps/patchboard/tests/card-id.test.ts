import { describe, expect, it } from "vitest";
import { newCardId } from "../src/model/ids.js";

describe("U-PB-03 card id", () => {
  it("has the card- prefix and the UUID it was given", () => {
    expect(newCardId(() => "abc")).toBe("card-abc");
  });
  it("yields 10,000 unique ids from real randomUUID", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(newCardId(() => crypto.randomUUID()));
    expect(ids.size).toBe(10_000);
  });
});