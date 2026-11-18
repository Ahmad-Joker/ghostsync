import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "..", "src", "styles", "ghostsync-theme.css"), "utf8");

function tokens(block: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of block.matchAll(/--gs-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6}\b|var\(--gs-[a-z0-9-]+\))/g)) m.set(x[1] as string, (x[2] as string).toLowerCase());
  return m;
}
const section = (start: string): string => {
  const i = css.indexOf(start);
  return css.slice(i, css.indexOf("\n}", i));
};
const ink = tokens(section(":root {"));
const paperOverrides = tokens(section(".gs-paper, li.card {"));
const paper = new Map([...ink, ...paperOverrides]);

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
const get = (m: Map<string, string>, k: string): string => {
  const v = m.get(k);
  if (v === undefined) throw new Error(`missing token --gs-${k}`);
  const alias = /^var\(--gs-([a-z0-9-]+)\)$/.exec(v);
  return alias === null ? v : get(m, alias[1] as string);
};

/** [label, surface map, foreground token, background token, minimum ratio] */
const PAIRS: Array<[string, "ink" | "paper", string, string, number]> = [
  ["body text on ink", "ink", "text", "bg", 4.5],
  ["body text on panels", "ink", "text", "surface", 4.5],
  ["muted text on ink", "ink", "text-muted", "bg", 4.5],
  ["muted text on panels", "ink", "text-muted", "surface", 4.5],
  ["muted text on sunken", "ink", "text-muted", "sunken", 4.5],
  ["text on inputs", "ink", "text", "sunken", 4.5],
  ["primary button text", "ink", "on-primary", "primary", 4.5],
  ["primary button hover text", "ink", "on-primary", "primary-hover", 4.5],
  ["violet link text on ink", "ink", "violet-soft", "bg", 4.5],
  ["amber accent text on ink", "ink", "amber", "bg", 4.5],
  ["offline banner text", "ink", "text", "amber-bg", 4.5],
  ["offline banner muted text", "ink", "text-muted", "amber-bg", 4.5],
  ["amber on its banner", "ink", "amber", "amber-bg", 4.5],
  ["chip ok", "ink", "ok", "ok-bg", 4.5],
  ["chip warn", "ink", "warn", "warn-bg", 4.5],
  ["chip bad", "ink", "bad", "bad-bg", 4.5],
  ["chip info", "ink", "info", "info-bg", 4.5],
  ["ok text on panels", "ink", "ok", "surface", 4.5],
  ["bad text on panels", "ink", "bad", "surface", 4.5],
  ["focus ring on ink", "ink", "focus", "bg", 3],
  ["focus ring on panels", "ink", "focus", "surface", 3],
  ["focus ring on the violet button", "ink", "focus", "primary", 3],
  ["input border on ink", "ink", "line-strong", "bg", 3],
  ["input border on inputs", "ink", "line-strong", "sunken", 3],
  ["body text on paper", "paper", "text", "surface", 4.5],
  ["muted text on paper", "paper", "text-muted", "surface", 4.5],
  ["text on paper buttons", "paper", "text", "surface-2", 4.5],
  ["muted text on paper inputs", "paper", "text-muted", "sunken", 4.5],
  ["text on paper inputs", "paper", "text", "sunken", 4.5],
  ["violet accent text on paper", "paper", "amber", "surface", 4.5],
  ["ok on paper", "paper", "ok", "surface", 4.5],
  ["warn on paper", "paper", "warn", "surface", 4.5],
  ["bad on paper", "paper", "bad", "surface", 4.5],
  ["info on paper", "paper", "info", "surface", 4.5],
  ["chip ok on paper", "paper", "ok", "ok-bg", 4.5],
  ["chip bad on paper", "paper", "bad", "bad-bg", 4.5],
  ["focus ring on paper", "paper", "focus", "surface", 3],
  ["focus ring on paper inputs", "paper", "focus", "sunken", 3],
  ["paper input border", "paper", "line-strong", "sunken", 3],
  ["primary button on paper", "paper", "primary", "surface", 3],
];

describe("shared palette contrast (KW-UNIT-CONTRAST)", () => {
  const rows: string[] = [];
  for (const [label, scope, fg, bg, min] of PAIRS) {
    it(`${label} is at least ${min}:1`, () => {
      const m = scope === "ink" ? ink : paper;
      const r = ratio(get(m, fg), get(m, bg));
      rows.push(`${label}: ${r.toFixed(2)}:1 (min ${min})`);
      expect(r).toBeGreaterThanOrEqual(min);
    });
  }
  it("prints the ratios", () => {
    // eslint-disable-next-line no-console
    console.log(`KW-UNIT-CONTRAST ratios\n${rows.join("\n")}`);
    expect(rows.length).toBeGreaterThan(0);
  });
  it("keeps the 3px focus ring first and never removes the outline", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*3px solid/);
    expect(css).not.toMatch(/outline:\s*none/);
    for (const k of ["bg", "paper", "violet", "amber"]) expect(ink.has(k), k).toBe(true);
  });
});
