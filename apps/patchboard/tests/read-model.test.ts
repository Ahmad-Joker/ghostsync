import type { GetResult } from "@ghostsync/kit";
import { describe, expect, it } from "vitest";
import type { Card } from "../src/model/adapters.js";
import { diffBoards } from "../src/model/diff.js";
import { readBoard, type ReadSource } from "../src/model/read-model.js";

const ok = (title: string, placement: string, notes = ""): GetResult<Card> => ({ ok: true, entity: { title, notes, placement } });
const bad = (id: string, fields: Record<string, string>): GetResult<Card> => ({ ok: false, reason: "invalidRecord", id, fields, cause: new TypeError("x") });

function source(rows: Array<[string, GetResult<Card>]>): ReadSource & { list: () => never } {
  return {
    listResults: () => rows,
    list: () => {
      throw new Error("list() must never be used");
    },
  };
}

describe("U-PB-10 read model", () => {
  it("reads through listResults only, groups and sorts valid cards, keeps invalid rows apart", () => {
    const m = readBoard(
      source([
        ["card-z", bad("card-z", { title: "<img src=x onerror=alert(1)>" })],
        ["card-b", ok("B", "doing|00002048")],
        ["card-a", ok("A", "doing|00001024")],
        ["card-y", bad("card-y", { placement: "doing|00001024" })],
      ]),
    );
    expect(m.columns.doing.map((p) => p.id)).toEqual(["card-a", "card-b"]);
    expect(m.columns.todo).toEqual([]);
    expect(m.invalid.map((r) => r.id)).toEqual(["card-y", "card-z"]);
    expect(m.invalid[1]?.fields["title"]).toBe("<img src=x onerror=alert(1)>");
    const inColumns = [...m.columns.todo, ...m.columns.doing, ...m.columns.done].map((p) => p.id);
    expect(inColumns).not.toContain("card-y");
  });
});

describe("U-PB-10 diffBoards", () => {
  const board = (rows: Array<[string, GetResult<Card>]>) => readBoard(source(rows));
  it("is empty for equal boards", () => {
    const b = board([["card-a", ok("A", "todo|00001024")]]);
    expect(diffBoards(b, b)).toEqual([]);
  });
  it("describes title, notes, move, reorder, add, remove and incomplete", () => {
    const before = board([
      ["card-a", ok("Draft spec", "todo|00001024", "Outline")],
      ["card-b", ok("Write tests", "todo|00002048")],
      ["card-c", ok("Gone", "done|00001024")],
      ["card-d", ok("Soon bad", "done|00002048")],
    ]);
    const after = board([
      ["card-a", ok("Draft spec v2", "doing|00001024", "Outline plus risks")],
      ["card-b", ok("Write tests", "todo|00003072")],
      ["card-e", ok("New", "todo|00004096")],
      ["card-d", bad("card-d", { title: "Soon bad" })],
    ]);
    expect(diffBoards(before, after)).toEqual([
      "Reordered: Write tests in To do",
      "Added: New in To do",
      "Title changed: Draft spec to Draft spec v2",
      "Notes changed: Draft spec v2",
      "Moved: Draft spec v2, To do to Doing",
      "Removed: Gone",
      "Now incomplete: card-d",
    ]);
  });
});