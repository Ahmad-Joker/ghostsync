import { encode } from "uqr";
import { describe, expect, it } from "vitest";
import { QrTransferError } from "../src/errors.js";
import { encodeFrame } from "../src/frame.js";
import { buildQrSymbol, buildQrSymbolWith } from "../src/symbol.js";
import type { QrEncodeFn } from "../src/symbol.js";

const frameOf = (n: number): string => encodeFrame(new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255));

describe("U-QR-03 symbol", () => {
  it.each([
    [328, 12],
    [658, 18],
    [988, 24],
    [1231, 25],
    [1232, 25],
  ])("%i bytes give version %i", (n, version) => {
    const sym = buildQrSymbol(frameOf(n));
    expect(sym.version).toBe(version);
    expect(sym.size).toBe(4 * version + 17);
    expect(sym.modules.length).toBe(sym.size * sym.size);
  });

  it("1232 bytes: version 25, 117 modules", () => {
    const sym = buildQrSymbol(frameOf(1232));
    expect(sym.version).toBe(25);
    expect(sym.size).toBe(117);
  });

  it("records the encoder options: level L, versions 1 to 25, no ECC boost", () => {
    const seen: Array<{ text: string; options: unknown }> = [];
    const recording: QrEncodeFn = (text, options) => {
      seen.push({ text, options });
      return encode(text, options);
    };
    const frame = frameOf(1232);
    buildQrSymbolWith(frame, recording);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.text).toBe(frame);
    expect(seen[0]?.options).toMatchObject({ ecc: "L", minVersion: 1, maxVersion: 25, boostEcc: false });
  });

  it("never emits version 23 (jsqr 1.4.0 cannot read 23-L); a text that fits 23 is re-encoded from version 24", () => {
    const seen: unknown[] = [];
    const recording: QrEncodeFn = (text, options) => {
      seen.push(options);
      return encode(text, options);
    };
    const sym = buildQrSymbolWith(frameOf(988), recording);
    expect(sym.version).toBe(24);
    expect(seen).toEqual([
      { ecc: "L", minVersion: 1, maxVersion: 25, boostEcc: false, border: 0 },
      { ecc: "L", minVersion: 24, maxVersion: 25, boostEcc: false, border: 0 },
    ]);
    for (let n = 900; n <= 1060; n += 8) expect(buildQrSymbol(frameOf(n)).version).not.toBe(23);
  });

  it("a 1854-character text throws TooLarge and never reaches the encoder", () => {
    let calls = 0;
    const counting: QrEncodeFn = (text, options) => {
      calls += 1;
      return encode(text, options);
    };
    expect(() => buildQrSymbolWith("GSQ1:" + "0".repeat(1849), counting)).toThrow(QrTransferError);
    expect(calls).toBe(0);
  });

  it("an encoder failure maps to TooLarge", () => {
    const failing: QrEncodeFn = () => {
      throw new Error("Data too long");
    };
    try {
      buildQrSymbolWith("GSQ1:BB8", failing);
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(QrTransferError);
      expect((err as QrTransferError).code).toBe("TooLarge");
    }
  });
});
