import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

/** Post-build scan (run after `build`): no failure-injection hooks ship, URLs are relative. */
describe("dist scan", () => {
  const all = files(DIST).filter((f) => !f.endsWith("sw.js") || true);
  it("contains no test-only injection names", () => {
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      for (const name of ["armWriteAbortOnce", "holdNextFileRead", "releaseFileRead", "__ghostsyncTest", "sw-install-fail", "/__test/", "fail-asset", "request-log"]) {
        expect(text.includes(name), `${f} contains ${name}`).toBe(false);
      }
    }
  });
  it("index.html has only relative asset URLs, no inline script, and a CSP meta", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(/src="\.\/assets\/index-[^"]+\.js"/.test(html)).toBe(true);
    expect(/href="\.\/assets\/index-[^"]+\.css"/.test(html)).toBe(true);
    expect(/(src|href)="\/(?!\/)/.test(html)).toBe(false);
    expect(/localhost|127\.0\.0\.1|:\d{4}/.test(html)).toBe(false);
    expect(/<script(?![^>]*\bsrc=)[^>]*>/.test(html)).toBe(false);
  });
  it("precache manifest entries are scope-relative and sw.js has no hardcoded host or absolute asset path", () => {
    const manifest = JSON.parse(readFileSync(join(DIST, "precache-manifest.json"), "utf8")) as { entries: Array<{ url: string }>; cachePrefix: string };
    expect(manifest.cachePrefix).toBe("ghostsync-patchboard-");
    for (const e of manifest.entries) expect(e.url.startsWith("/") || e.url.includes("://")).toBe(false);
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    expect(/localhost|127\.0\.0\.1/.test(sw)).toBe(false);
    expect(sw.includes('"/assets')).toBe(false);
  });
  it("the app registers the worker with scope-relative URL and scope", () => {
    const js = files(join(DIST, "assets")).filter((f) => f.endsWith(".js")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(js).toMatch(/register\(\s*[`"']\.\/sw\.js[`"']\s*,\s*\{\s*scope:\s*[`"']\.\/[`"']/);
  });
});
