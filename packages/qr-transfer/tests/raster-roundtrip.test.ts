import { describe, expect, it } from "vitest";
import { QrTransferError } from "../src/errors.js";
import { decodeFrame, encodeFrame } from "../src/frame.js";
import { decodeDetailed, jsqrDecoder } from "../src/browser/jsqr-engine.js";
import { buildQrSymbol } from "../src/symbol.js";
import { rasterize } from "./raster.js";

const bytesOf = (n: number): Uint8Array => new Uint8Array(n).map((_, i) => (i * 131 + 17) & 255);

function scan(frame: string, scale = 4): ReturnType<typeof decodeDetailed> {
  const sym = buildQrSymbol(frame);
  const r = rasterize(sym, scale);
  return decodeDetailed(r.data, r.width, r.height);
}

describe("U-QR-04 raster round trip", () => {
  it.each([11, 328, 658, 988, 1231, 1232])("%i bytes round trip byte for byte", (n) => {
    const bytes = bytesOf(n);
    const frame = encodeFrame(bytes);
    const found = scan(frame);
    expect(found?.text).toBe(frame);
    expect(decodeFrame(found?.text ?? "")).toEqual(bytes);
  });

  it("1232 bytes: one alphanumeric segment, version 25, size 117, exact frame text (G1)", () => {
    const bytes = bytesOf(1232);
    const frame = encodeFrame(bytes);
    expect(frame.length).toBe(1853);
    const sym = buildQrSymbol(frame);
    expect(sym.version).toBe(25);
    expect(sym.size).toBe(117);
    const r = rasterize(sym, 4);
    const found = decodeDetailed(r.data, r.width, r.height);
    expect(found).toBeDefined();
    expect(found?.version).toBe(25);
    expect(found?.chunkTypes).toEqual(["alphanumeric"]);
    expect(found?.chunkTexts).toEqual([frame]);
    expect(found?.text).toBe(frame);
    // The 117-module symbol drawn with its quiet zone at scale 4.
    expect(r.width).toBe((117 + 8) * 4);
    expect(decodeFrame(found?.text ?? "")).toEqual(bytes);
  });

  it("the interior-space frame GSQ1: 0 (byte 0x24) round trips through raster, scan and decodeFrame", () => {
    const frame = encodeFrame(Uint8Array.of(0x24));
    expect(frame).toBe("GSQ1: 0");
    const sym = buildQrSymbol(frame);
    const r = rasterize(sym, 4);
    expect(jsqrDecoder(r.data, r.width, r.height)).toBe("GSQ1: 0");
    expect(decodeFrame(jsqrDecoder(r.data, r.width, r.height) ?? "")).toEqual(Uint8Array.of(0x24));
  });

  it("the synthetic frame 'GSQ1: 0 ' keeps its trailing space through the scan path and decodeFrame rejects it with OutOfRange", () => {
    const synthetic = "GSQ1: 0 ";
    const sym = buildQrSymbol(synthetic);
    const r = rasterize(sym, 4);
    const text = jsqrDecoder(r.data, r.width, r.height);
    expect(text).toBe(synthetic);
    try {
      decodeFrame(text ?? "");
      expect.fail("decodeFrame must reject");
    } catch (err) {
      expect(err).toBeInstanceOf(QrTransferError);
      expect((err as QrTransferError).code).toBe("OutOfRange");
    }
  });
});
