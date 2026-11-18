import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (app: string, ...rest: string[]): string => readFileSync(resolve(__dirname, "..", "..", app, ...rest), "utf8");
const sprite = (html: string): string => {
  const a = html.indexOf("<!-- gs-sprite:start -->");
  const b = html.indexOf("<!-- gs-sprite:end -->");
  return a < 0 || b < 0 ? "" : html.slice(a, b);
};

describe("courier symbol set (KW-UNIT-SPRITE-PARITY)", () => {
  const pb = read("patchboard", "index.html");
  const fl = read("fieldledger", "index.html");
  it("is byte-identical in both apps", () => {
    expect(sprite(pb).length).toBeGreaterThan(500);
    expect(sprite(pb)).toBe(sprite(fl));
  });
  it("defines every symbol the views reference", () => {
    for (const id of ["gs-ghost", "gs-lantern", "gs-capsule", "gs-moon", "gs-phone", "gs-laptop", "gs-courier", "gs-courier-sm", "gs-courier-step-scan", "gs-courier-step-review", "gs-courier-step-import"]) {
      expect(sprite(pb), id).toContain(`<symbol id="${id}"`);
    }
  });
  it("is local and static: no images, no remote URLs, no inline style attributes", () => {
    const s = sprite(pb);
    expect(s).not.toMatch(/<img|https?:|xlink:href|\sstyle=/);
    expect(pb).not.toMatch(/<img/);
  });
  it("app code builds no SVG namespace strings", () => {
    const src = readFileSync(resolve(__dirname, "..", "src", "ui", "icon.ts"), "utf8");
    expect(src).not.toMatch(/createElementNS|w3\.org/);
  });
});
