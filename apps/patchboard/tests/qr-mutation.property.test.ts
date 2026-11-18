import { decodeCapsule, isCapsuleError } from "@ghostsync/capsule";
import { QrTransferError, decodeFrame, encodeFrame } from "@ghostsync/qr-transfer";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { BATCH_SEEDS, RUNS_PER_BATCH } from "./batches.js";
import { reportRun } from "./fc-report.js";
import { qrCapsule } from "./qr-seams.js";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

let original: Uint8Array;
let frame: string;

beforeAll(async () => {
  original = await qrCapsule({ notes: "n".repeat(300) });
  frame = encodeFrame(original);
});

/** Four separately named 50-case batches of an ASYNC property (the capsule checksum is checked with SubtleCrypto). */
function registerAsyncBatches(label: string, title: string, make: () => fc.IAsyncProperty<[number, string]>): void {
  BATCH_SEEDS.forEach((seed, i) => {
    it(`${label}: ${title} [batch ${i + 1}/${BATCH_SEEDS.length}, seed ${seed}, ${RUNS_PER_BATCH} runs]`, async () => {
      const result = await fc.check(make(), { numRuns: RUNS_PER_BATCH, seed });
      reportRun(`qr-mutation ${label} batch ${i + 1}/${BATCH_SEEDS.length}`, result, expect.fail);
      expect(result.numRuns).toBe(RUNS_PER_BATCH);
      expect(result.numSkips).toBe(0);
    });
  });
}

describe("P-QR-04 single-character mutations never yield different accepted bytes", () => {
  registerAsyncBatches("P-QR-04", "a mutated frame is rejected by the frame decoder or by decodeCapsule, or equals the original", () =>
    fc.asyncProperty(fc.integer({ min: 5, max: 10_000 }), fc.constantFrom(...ALPHABET), async (rawIndex, ch) => {
      const index = 5 + ((rawIndex - 5) % (frame.length - 5));
      const mutated = frame.slice(0, index) + ch + frame.slice(index + 1);
      let bytes: Uint8Array;
      try {
        bytes = decodeFrame(mutated);
      } catch (err) {
        expect(err).toBeInstanceOf(QrTransferError);
        return;
      }
      if (bytes.length === original.length && bytes.every((b, k) => b === original[k])) return;
      try {
        await decodeCapsule(bytes);
      } catch (err) {
        expect(isCapsuleError(err)).toBe(true);
        return;
      }
      throw new Error("a mutated frame produced different bytes that decodeCapsule accepted");
    }),
  );
});