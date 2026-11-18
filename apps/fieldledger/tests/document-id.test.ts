import { describe, expect, it } from "vitest";
import { formatRoute, normalizeDocumentId, parseRoute, previewDocumentId, validateDocumentId } from "../src/identity/document-id.js";

describe("document id", () => {
  it("normalizes by trim + lowercase", () => {
    expect(normalizeDocumentId(" INC-2026-0042 ")).toBe("inc-2026-0042");
  });
  it("accepts valid and rejects invalid IDs with an actionable message", () => {
    expect(validateDocumentId(" INC-2026-0042 ")).toEqual({ ok: true, documentId: "inc-2026-0042" });
    for (const bad of ["", "ab", "-abc", "a b c", "inc/1", "x".repeat(65), "inc\u0000"]) {
      const r = validateDocumentId(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("3 to 64 characters");
    }
    expect(validateDocumentId("a".repeat(64)).ok).toBe(true);
  });
  it("previews the normalized value, empty for empty input", () => {
    expect(previewDocumentId(" INC-1 ")).toBe("Will open: inc-1");
    expect(previewDocumentId("  ")).toBe("");
  });
  it("round-trips routes and rejects invalid ones", () => {
    expect(parseRoute(formatRoute("inc-2026-0042"))).toBe("inc-2026-0042");
    expect(parseRoute("#/i/AB")).toBeUndefined();
    expect(parseRoute("#/i/%E0%A4%A")).toBeUndefined();
    expect(parseRoute("")).toBeUndefined();
    expect(parseRoute("#/x/inc-1234")).toBeUndefined();
  });
});