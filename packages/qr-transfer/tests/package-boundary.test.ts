import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

describe("U-QR-06 package boundary", () => {
  it("src has no workspace, yjs, node, network or storage names", () => {
    const banned = ["@ghostsync/", "yjs", "node:", "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "indexedDB", "localStorage", "sessionStorage"];
    const sources = files(join(ROOT, "src")).filter((f) => f.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(5);
    for (const f of sources) {
      const text = readFileSync(f, "utf8");
      for (const name of banned) expect(text.includes(name), `${f} contains ${name}`).toBe(false);
    }
  });

  it("package.json pins jsqr and uqr exactly and has no workspace dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies).toEqual({ jsqr: "1.4.0", uqr: "0.1.3" });
    for (const v of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)]) {
      expect(v.startsWith("workspace:")).toBe(false);
      expect(/^\d+\.\d+\.\d+$/.test(v)).toBe(true);
    }
  });

  it("THIRD_PARTY_NOTICES.md names both dependencies and their licenses", () => {
    const text = readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(text).toContain("jsqr");
    expect(text).toContain("1.4.0");
    expect(text).toContain("Apache License");
    expect(text).toContain("uqr");
    expect(text).toContain("0.1.3");
    expect(text).toContain("MIT");
  });
});
