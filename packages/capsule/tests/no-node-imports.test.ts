import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * STATIC check of NFR-CAP-001 (browser-safe src): no `node:` imports, no
 * Node-only globals, and no import of @ghostsync/persist in `src/**`. This is
 * NOT evidence of browser runtime behavior (that is the Chromium suite).
 */
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("NFR-CAP-001 browser-safe src (static scan)", () => {
  it("no src file imports node:, persist, or uses a Node-only global", () => {
    const files = tsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["']node:/.test(text) || /require\(\s*["']node:/.test(text)) offenders.push(`${file}: node: import`);
      if (/(?:from|import)\s*\(?\s*["']@ghostsync\/persist/.test(text)) offenders.push(`${file}: persist import`);
      if (/\bBuffer\b/.test(text)) offenders.push(`${file}: Buffer`);
      for (const g of [/\bprocess\./, /\b__dirname\b/, /\b__filename\b/, /\brequire\s*\(/]) {
        if (g.test(text)) offenders.push(`${file}: ${g}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("package.json declares kit as the only runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(["@ghostsync/kit"]);
    expect(Object.keys(pkg.devDependencies)).not.toContain("@ghostsync/persist");
  });
});
