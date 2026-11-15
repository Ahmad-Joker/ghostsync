import fc from "fast-check";
import { describe, expect } from "vitest";
import { base45Decode, base45Encode } from "../src/base45.js";
import { registerBatches } from "./batches.js";

const bytes = fc.uint8Array({ minLength: 1, maxLength: 1232 });
const edgeBytes = fc.oneof(
  bytes,
  fc.integer({ min: 1, max: 1232 }).map((n) => new Uint8Array(n)),
  fc.integer({ min: 1, max: 1232 }).map((n) => new Uint8Array(n).fill(255)),
);

describe("P-QR-01 base45 round trip", () => {
  registerBatches("qr-transfer", "P-QR-01", "decode(encode(bytes)) equals bytes", () =>
    fc.property(edgeBytes, (b) => {
      expect(base45Decode(base45Encode(b))).toEqual(b);
    }),
  );
});
