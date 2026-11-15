import { decodeCapsule } from "@ghostsync/capsule";
import { buildQrSymbol, decodeFrame, encodeFrame, QR_MAX_CAPSULE_BYTES } from "@ghostsync/qr-transfer";
import { describe, expect, it } from "vitest";
// Test-only deep imports: the engine's chunk data and the test rasterizer are not public API.
import { decodeDetailed } from "../../../packages/qr-transfer/src/browser/jsqr-engine.js";
import { rasterize } from "../../../packages/qr-transfer/tests/raster.js";
import { qrCapsuleOfSize } from "./qr-seams.js";

describe("U-QR-04b real 1,232-byte capsule as a Version 25-L QR (G1)", () => {
  it("a real encodeCapsule output of exactly 1232 bytes: version 25, size 117, one alphanumeric chunk equal to the frame, exact round trip", async () => {
    const bytes = await qrCapsuleOfSize(QR_MAX_CAPSULE_BYTES);
    expect(bytes.length).toBe(1232);
    // Valid through the public capsule decoder, so this is not synthetic padding.
    expect((await decodeCapsule(bytes)).metadata.app).toBe("patchboard");

    const frame = encodeFrame(bytes);
    expect(frame.length).toBe(1853);
    const sym = buildQrSymbol(frame);
    expect(sym.version).toBe(25);
    expect(sym.size).toBe(117);

    const r = rasterize(sym, 4);
    const found = decodeDetailed(r.data, r.width, r.height);
    expect(found?.version).toBe(25);
    expect(found?.chunkTypes).toEqual(["alphanumeric"]);
    expect(found?.chunkTexts).toEqual([frame]);
    expect(found?.text).toBe(frame);
    expect(decodeFrame(found?.text ?? "")).toEqual(bytes);
  });
});
