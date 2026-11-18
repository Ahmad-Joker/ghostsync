import { encode } from "uqr";
import type { QrCodeGenerateOptions, QrCodeGenerateResult } from "uqr";
import { QR_ECC_LEVEL, QR_MAX_FRAME_CHARS, QR_MAX_VERSION } from "./constants.js";
import { QrTransferError } from "./errors.js";

export interface QrSymbol {
  readonly version: number;
  /** Modules per side. */
  readonly size: number;
  /** size * size flags, row-major, 1 = dark. */
  readonly modules: Uint8Array;
}

/** The one version the bundled decoder cannot read at level L (see buildQrSymbolWith). */
export const JSQR_UNREADABLE_VERSION = 23;

export type QrEncodeFn = (data: string, options: QrCodeGenerateOptions) => QrCodeGenerateResult;

/** Internal seam: lets a test record the options passed to the encoder. */
export function buildQrSymbolWith(frameText: string, encodeFn: QrEncodeFn): QrSymbol {
  if (typeof frameText !== "string") throw new TypeError("frameText must be a string");
  if (frameText.length > QR_MAX_FRAME_CHARS) throw new QrTransferError("TooLarge", "the text does not fit a version 25 symbol");
  let result: QrCodeGenerateResult;
  try {
    result = encodeFn(frameText, { ecc: QR_ECC_LEVEL, minVersion: 1, maxVersion: QR_MAX_VERSION, boostEcc: false, border: 0 });
    // jsqr 1.4.0 decodes no version 23 symbol at level L (observed for every mask; M, Q and H at 23 decode). Whether the fault is
    // in jsqr or in uqr was not isolated. Use version 24 instead; the cap stays 25.
    if (result.version === JSQR_UNREADABLE_VERSION) {
      result = encodeFn(frameText, { ecc: QR_ECC_LEVEL, minVersion: JSQR_UNREADABLE_VERSION + 1, maxVersion: QR_MAX_VERSION, boostEcc: false, border: 0 });
    }
  } catch {
    throw new QrTransferError("TooLarge", "the text does not fit a version 25 symbol");
  }
  const size = result.size;
  const modules = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const row = result.data[y] as boolean[];
    for (let x = 0; x < size; x += 1) modules[y * size + x] = row[x] === true ? 1 : 0;
  }
  return { version: result.version, size, modules };
}

export function buildQrSymbol(frameText: string): QrSymbol {
  return buildQrSymbolWith(frameText, encode);
}
