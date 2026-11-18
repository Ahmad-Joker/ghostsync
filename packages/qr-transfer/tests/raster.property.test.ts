import fc from "fast-check";
import { describe, expect } from "vitest";
import { decodeFrame, encodeFrame } from "../src/frame.js";
import { jsqrDecoder } from "../src/browser/jsqr-engine.js";
import { buildQrSymbol } from "../src/symbol.js";
import { registerBatches } from "./batches.js";
import { rasterize } from "./raster.js";

/** Bytes biased toward values whose Base45 text contains the space character (a % 45 === 36 for a final byte). */
const spaceByte = fc.constantFrom(36, 81, 126, 171, 216, 0x24);
const payload = fc
  .integer({ min: 11, max: 1232 })
  .chain((n) => fc.array(fc.oneof(fc.integer({ min: 0, max: 255 }), spaceByte), { minLength: n, maxLength: n }))
  .map((a) => Uint8Array.from(a));

describe("P-QR-03 raster round trip", () => {
  registerBatches("qr-transfer", "P-QR-03", "encode, raster, jsqr scan, decode gives the same bytes", () =>
    fc.property(payload, (b) => {
      const frame = encodeFrame(b);
      const r = rasterize(buildQrSymbol(frame), 4);
      const text = jsqrDecoder(r.data, r.width, r.height);
      expect(text).toBe(frame);
      expect(decodeFrame(text ?? "")).toEqual(b);
    }),
  );
});
