import jsQRImport from "jsqr";
import type { FrameDecoder } from "./scan-session.js";

type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" }) => {
  readonly data: string;
  readonly version: number;
  readonly chunks: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
} | null;

/** jsqr is CommonJS: depending on the loader the function is the module or its `default` member. */
function resolveJsQr(mod: unknown): JsQr {
  if (typeof mod === "function") return mod as JsQr;
  const inner = (mod as { default?: unknown } | null)?.default;
  if (typeof inner === "function") return inner as JsQr;
  throw new Error("jsqr could not be loaded");
}

const jsQR = resolveJsQr(jsQRImport);

export interface DetailedDecode {
  readonly text: string;
  readonly version: number;
  readonly chunkTypes: ReadonlyArray<string>;
  readonly chunkTexts: ReadonlyArray<string | undefined>;
}

/** Internal, test-side seam (not exported from the package index): the text plus what jsqr reports about the segments. */
export function decodeDetailed(rgba: Uint8ClampedArray, width: number, height: number): DetailedDecode | undefined {
  const found = jsQR(rgba, width, height, { inversionAttempts: "dontInvert" });
  if (found === null) return undefined;
  return {
    text: found.data,
    version: found.version,
    chunkTypes: found.chunks.map((c) => c.type),
    chunkTexts: found.chunks.map((c) => c.text),
  };
}

/** One decode attempt per frame, no inversion. Returns the exact scanner text. */
export const jsqrDecoder: FrameDecoder = (rgba, width, height) => decodeDetailed(rgba, width, height)?.text;
