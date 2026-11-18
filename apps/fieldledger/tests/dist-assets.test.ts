import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/** KW-DIST-ASSETS: the redesign adds no remote fonts or images and every emitted asset is precached. */
describe("dist assets (KW-DIST-ASSETS)", () => {
  const all = walk(DIST);
  const css = all.filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n");
  it("has one stylesheet with no @font-face, font data URIs or remote URLs", () => {
    expect(all.filter((f) => f.endsWith(".css"))).toHaveLength(1);
    expect(css).not.toMatch(/@font-face|@import|data:(font|application\/font)/i);
    // the only URL-like text in CSS is the SVG namespace inside inline data: icons
    const urls = [...css.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    expect(urls.filter((u) => u !== "http://www.w3.org/2000/svg")).toEqual([]);
  });
  it("lists every emitted asset (SVG files, if any, included) in the precache manifest", () => {
    const manifest = JSON.parse(readFileSync(join(DIST, "precache-manifest.json"), "utf8")) as { entries: Array<{ url: string }> };
    const urls = new Set(manifest.entries.map((e) => e.url));
    const assets = all.filter((f) => /[\\/]assets[\\/]/.test(f));
    expect(assets.length).toBeGreaterThan(0);
    for (const f of assets) expect(urls.has(`assets/${f.split(/[/\\]/).pop()}`), f).toBe(true);
    expect(all.filter((f) => f.endsWith(".svg")).length).toBeGreaterThanOrEqual(0);
  });
  it("ships the courier sprite inline in index.html with no images or remote URLs", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    for (const id of ["gs-courier", "gs-courier-sm", "gs-courier-step-scan", "gs-courier-step-review", "gs-courier-step-import", "gs-moon", "gs-phone", "gs-laptop"]) expect(html).toContain(`id="${id}"`);
    expect(html).not.toMatch(/<img|https?:\/\//);
    expect(html).toContain("viewport-fit=cover");
  });
  it("the entry bundle still holds only the Yjs URL and builds no SVG namespace", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const entry = /src="\.\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1] ?? "";
    const js = readFileSync(join(DIST, "assets", entry), "utf8");
    expect([...js.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0])).toEqual(["https://github.com/yjs/yjs/issues/438"]);
    expect(js).not.toContain("createElementNS");
  });
});
