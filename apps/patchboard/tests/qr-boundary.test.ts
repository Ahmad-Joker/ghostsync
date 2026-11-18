import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

describe("U-QR-13 app boundary", () => {
  const qrFiles = files(join(SRC, "transfer", "qr")).filter((f) => f.endsWith(".ts"));
  it("the QR modules import no kit, yjs or persist and no package internals", () => {
    expect(qrFiles.length).toBeGreaterThanOrEqual(4);
    for (const f of qrFiles) {
      const text = readFileSync(f, "utf8");
      expect(/from "@ghostsync\/kit|from "yjs|from "@ghostsync\/persist/.test(text), f).toBe(false);
      for (const m of text.matchAll(/from "(@ghostsync\/[^"]+)"/g)) {
        expect(["@ghostsync/capsule", "@ghostsync/qr-transfer", "@ghostsync/qr-transfer/browser"], f).toContain(m[1]);
      }
      expect(/qr-transfer\/(src|dist)/.test(text), f).toBe(false);
    }
  });
  it("the QR modules do no storage, network or capsule parsing of their own", () => {
    for (const f of qrFiles) {
      const text = readFileSync(f, "utf8");
      for (const banned of ["indexedDB", "localStorage", "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "applyUpdate", "importCapsuleIntoPersisted", "encodeCapsule"]) {
        expect(text.includes(banned), `${f} contains ${banned}`).toBe(false);
      }
    }
  });
  it("the session controller applies QR bytes only through importCapsuleIntoPersisted", () => {
    const text = readFileSync(join(SRC, "session", "session-controller.ts"), "utf8");
    expect(text.match(/importCapsuleIntoPersisted\(/g)?.length).toBe(2);
    expect(text).not.toMatch(/\.applyUpdate\(/);
  });
});