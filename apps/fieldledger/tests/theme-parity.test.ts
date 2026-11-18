import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = (app: string): string => resolve(__dirname, "..", "..", app, "src", "styles", "ghostsync-theme.css");
const mine = readFileSync(here("fieldledger"));
const other = readFileSync(here("patchboard"));

describe("ghostsync-theme.css", () => {
  it("is byte-identical in fieldledger and patchboard", () => {
    expect(mine.equals(other)).toBe(true);
  });
  it("documents its single source in the header", () => {
    expect(mine.toString("utf8").startsWith("/*\n * GhostSync shared theme")).toBe(true);
    expect(mine.toString("utf8")).toContain("SINGLE SOURCE OF TRUTH");
  });
  it("disables animation and transitions under prefers-reduced-motion", () => {
    const css = mine.toString("utf8");
    const m = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
    expect(m).not.toBeNull();
    expect(m?.[1]).toMatch(/animation:\s*none\s*!important/);
    expect(m?.[1]).toMatch(/transition:\s*none\s*!important/);
  });
  it("keeps a 3px focus ring and a [hidden] rule", () => {
    const css = mine.toString("utf8");
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*3px solid/);
    expect(css).toContain("[hidden] { display: none !important; }");
    expect(css).not.toMatch(/outline:\s*none/);
  });
});
