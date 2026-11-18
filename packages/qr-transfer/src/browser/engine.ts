import type { FrameDecoder } from "./scan-session.js";

/** The decoder is a lazy import so that nothing is loaded until a scan starts. */
export async function loadJsqrEngine(): Promise<FrameDecoder> {
  const mod = await import("./jsqr-engine.js");
  return mod.jsqrDecoder;
}
