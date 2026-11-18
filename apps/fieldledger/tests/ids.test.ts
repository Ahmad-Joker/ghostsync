import { describe, expect, it } from "vitest";
import { newItemId } from "../src/model/ids.js";

describe("item ids", () => {
  it("prefixes ci- and is unique over 10,000 real UUIDs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newItemId(() => crypto.randomUUID()));
    expect(seen.size).toBe(10_000);
    for (const id of seen) expect(id).toMatch(/^ci-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});