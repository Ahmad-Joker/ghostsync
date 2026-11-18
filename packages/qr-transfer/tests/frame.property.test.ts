import fc from "fast-check";
import { describe, expect } from "vitest";
import { BASE45_ALPHABET } from "../src/base45.js";
import { decodeFrame, encodeFrame } from "../src/frame.js";
import { registerBatches } from "./batches.js";

describe("P-QR-02 frame shape", () => {
  registerBatches("qr-transfer", "P-QR-02", "length formula, alphabet, bound, prefix, round trip", () =>
    fc.property(fc.uint8Array({ minLength: 1, maxLength: 1232 }), (b) => {
      const frame = encodeFrame(b);
      expect(frame.length).toBe(5 + 3 * Math.floor(b.length / 2) + 2 * (b.length % 2));
      expect(frame.length).toBeLessThanOrEqual(1853);
      expect(frame.startsWith("GSQ1:")).toBe(true);
      for (const ch of frame.slice(5)) expect(BASE45_ALPHABET.includes(ch)).toBe(true);
      expect(frame.endsWith(" ")).toBe(false);
      expect(decodeFrame(frame)).toEqual(b);
    }),
  );
});
