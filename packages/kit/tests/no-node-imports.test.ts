import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * STATIC build-time check of NFR-SDK-001 (browser compatibility): no `node:`
 * imports or Node-only globals in `src/**`. This is explicitly NOT evidence of
 * browser runtime behavior, which remains pending.
 */
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("NFR-SDK-001 no node: imports in src (static scan)", () => {
  it("no src file imports a node: builtin or uses a Node-only global", () => {
    const files = tsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["']node:/.test(text) || /require\(\s*["']node:/.test(text)) {
        offenders.push(`${file}: node: import`);
      }
      // Node-only globals that would break a browser bundle.
      for (const g of [/\bprocess\./, /\b__dirname\b/, /\b__filename\b/, /\brequire\s*\(/]) {
        if (g.test(text)) {
          offenders.push(`${file}: ${g}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
