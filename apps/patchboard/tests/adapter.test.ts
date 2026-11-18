import { describe, expect, it } from "vitest";
import { cardAdapter, type Card } from "../src/model/adapters.js";

const ok: Card = { title: "T", notes: "", placement: "todo|00001024" };

describe("U-PB-05 card adapter", () => {
  it("has the schema identity", () => {
    expect(cardAdapter.schema).toEqual({ app: "patchboard", entityType: "card", schemaVersion: 1 });
  });
  it("round trips through fields", () => {
    expect(cardAdapter.fromFields(cardAdapter.toFields(ok))).toEqual(ok);
  });
  it("toFields emits exactly title, notes, placement", () => {
    expect(Object.keys(cardAdapter.toFields(ok)).sort()).toEqual(["notes", "placement", "title"]);
  });
  it("validates boundaries 1/120 for title and 2000 for notes", () => {
    expect(() => cardAdapter.validate({ ...ok, title: "a" })).not.toThrow();
    expect(() => cardAdapter.validate({ ...ok, title: "a".repeat(120) })).not.toThrow();
    expect(() => cardAdapter.validate({ ...ok, title: "" })).toThrow(TypeError);
    expect(() => cardAdapter.validate({ ...ok, title: "a".repeat(121) })).toThrow(TypeError);
    expect(() => cardAdapter.validate({ ...ok, notes: "n".repeat(2000) })).not.toThrow();
    expect(() => cardAdapter.validate({ ...ok, notes: "n".repeat(2001) })).toThrow(TypeError);
  });
  it("rejects each invalid input", () => {
    expect(() => cardAdapter.validate({ ...ok, placement: "archive|00001024" })).toThrow(TypeError);
    expect(() => cardAdapter.validate({ ...ok, placement: "doing|00000000" })).toThrow(TypeError);
    expect(() => cardAdapter.validate({ ...ok, title: 5 as unknown as string })).toThrow(TypeError);
    expect(() => cardAdapter.validate({ ...ok, notes: null as unknown as string })).toThrow(TypeError);
    expect(() => cardAdapter.validate({ ...ok, placement: 1 as unknown as string })).toThrow(TypeError);
  });
  it("fromFields throws for each missing or mistyped field and ignores extras", () => {
    const f = { title: "T", notes: "", placement: "todo|00001024" };
    for (const k of ["title", "notes", "placement"] as const) {
      const missing: Record<string, string> = { ...f };
      delete missing[k];
      expect(() => cardAdapter.fromFields(missing)).toThrow(TypeError);
      expect(() => cardAdapter.fromFields({ ...f, [k]: 1 })).toThrow(TypeError);
    }
    expect(cardAdapter.fromFields({ ...f, legacy: "x" })).toEqual(ok);
  });
});