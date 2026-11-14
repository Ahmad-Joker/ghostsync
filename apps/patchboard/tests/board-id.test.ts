import { describe, expect, it } from "vitest";
import { formatRoute, normalizeBoardId, parseRoute, validateBoardId } from "../src/identity/board-id.js";

describe("U-PB-01 board id", () => {
  it("normalizes by trimming and lowercasing", () => {
    expect(normalizeBoardId("  Sprint-Board ")).toBe("sprint-board");
  });
  it("accepts valid ids and rejects invalid ones", () => {
    for (const ok of ["abc", "sprint-board", "a.b_c-9", "9board", "a".repeat(64)]) expect(validateBoardId(ok)).toEqual({ ok: true, boardId: ok });
    for (const bad of ["", "ab", "-abc", "a b c", "a".repeat(65), "ab/c", "ünï"]) expect(validateBoardId(bad).ok).toBe(false);
    expect(validateBoardId("  ABC  ")).toEqual({ ok: true, boardId: "abc" });
  });
  it("parses and formats routes", () => {
    expect(parseRoute("#/b/sprint-board")).toBe("sprint-board");
    expect(parseRoute("#/b/Sprint-Board")).toBe("sprint-board");
    expect(parseRoute("#/b/%E0%A4%A")).toBeUndefined();
    expect(parseRoute("#/b/ab")).toBeUndefined();
    expect(parseRoute("#/i/sprint-board")).toBeUndefined();
    expect(parseRoute("")).toBeUndefined();
    expect(formatRoute("sprint-board")).toBe("#/b/sprint-board");
    expect(parseRoute(formatRoute("a.b_c-9"))).toBe("a.b_c-9");
  });
});