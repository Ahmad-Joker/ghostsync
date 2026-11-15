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
      for (const name of ["armWriteAbortOnce", "holdNextFileRead", "releaseFileRead", "__ghostsyncTest", "sw-install-fail", "/__test/", "fail-asset", "request-log", "__ghostsyncCamera", "__ghostsyncFixture", "captureStream", "qr-fixture"]) {
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

  // D-QR-01: QR scanner assets (EV-DIST).
  const assetsDir = join(DIST, "assets");
  const assetFiles = (): string[] => files(assetsDir);
  const decoderChunks = (): string[] => assetFiles().filter((f) => f.endsWith(".js") && readFileSync(f, "utf8").includes("dontInvert"));

  it("D-QR-01a: the decoder is a separate lazy chunk, not part of the entry bundle, and the entry loads it by dynamic import", () => {
    const chunks = decoderChunks();
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0] as string;
    expect(/jsqr-engine-[^/\\]+\.js$/.test(chunk)).toBe(true);
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const entryName = /src="\.\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1] ?? "";
    const entry = readFileSync(join(assetsDir, entryName), "utf8");
    expect(entry.includes("dontInvert")).toBe(false);
    expect(entry.includes("attemptBoth")).toBe(false);
    expect(entry).toContain(chunk.split(/[/\\]/).pop() as string);
    expect(readFileSync(chunk, "utf8")).toContain("alphanumeric");
  });

  it("D-QR-01b: every emitted file under assets is in the precache manifest, including the decoder chunk", () => {
    const manifest = JSON.parse(readFileSync(join(DIST, "precache-manifest.json"), "utf8")) as { entries: Array<{ url: string }> };
    const urls = new Set(manifest.entries.map((e) => e.url));
    for (const f of assetFiles()) expect(urls.has(`assets/${f.split(/[/\\]/).pop()}`), f).toBe(true);
    expect([...urls].some((u) => /^assets\/jsqr-engine-.*\.js$/.test(u))).toBe(true);
  });

  it("D-QR-01c: no WebAssembly, Worker or external host in the build", () => {
    expect(all.filter((f) => f.endsWith(".wasm"))).toEqual([]);
    for (const f of assetFiles().filter((x) => x.endsWith(".js"))) {
      const text = readFileSync(f, "utf8");
      expect(/new\s+Worker\s*\(/.test(text), `${f} new Worker`).toBe(false);
      expect(/jsdelivr|unpkg|cdnjs/.test(text), `${f} cdn`).toBe(false);
      expect(text.includes("WebAssembly.instantiate"), `${f} wasm`).toBe(false);
    }
    // The decoder chunk holds no URL at all. The entry bundle's only https:// text is Yjs's own warning link (pre-existing).
    expect(readFileSync(decoderChunks()[0] as string, "utf8").includes("https://")).toBe(false);
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const entryName = /src="\.\/assets\/(index-[^"]+\.js)"/.exec(html)?.[1] ?? "";
    const entry = readFileSync(join(assetsDir, entryName), "utf8");
    const urls = [...entry.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
    expect(urls).toEqual(["https://github.com/yjs/yjs/issues/438"]);
  });

  it("D-QR-01d: the CSP meta is unchanged and has no unsafe-eval or wasm-unsafe-eval", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html).toContain("default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; img-src 'self' data:");
    expect(html.includes("unsafe-eval")).toBe(false);
    expect(html.includes("wasm-unsafe-eval")).toBe(false);
  });

  it("D-QR-01e: third-party notices ship with the build", () => {
    const text = readFileSync(join(DIST, "THIRD_PARTY_NOTICES.txt"), "utf8");
    expect(text).toContain("jsqr");
    expect(text).toContain("Apache License");
    expect(text).toContain("uqr");
  });
  it("D-QR-02: the phone-test tooling and fixtures (apps/patchboard/tools/phone-test) are not in dist", () => {
    const names = files(DIST).map((f) => f.replace(/\\/g, "/"));
    expect(names.some((n) => /phone-test|fixture-display|fixtures\.(js|json)|serve-https/.test(n))).toBe(false);
    for (const f of files(DIST)) {
      const text = readFileSync(f, "utf8");
      for (const name of ["GS_FIXTURES", "phone-test", "fixture-display", "__root-ca.crt"]) expect(text.includes(name), `${f} contains ${name}`).toBe(false);
    }
  });
});
