import type { QrSymbol } from "../symbol.js";

export const QUIET_ZONE_MODULES = 4;
export const MIN_SCALE = 4;
export const MAX_SCALE = 8;

/** Largest integer scale from 4 to 8 at which the symbol plus its quiet zone fits `availableCssPx`; else undefined. */
export function chooseScale(availableCssPx: number, symbol: QrSymbol): number | undefined {
  if (!Number.isFinite(availableCssPx)) return undefined;
  const modules = symbol.size + 2 * QUIET_ZONE_MODULES;
  for (let scale = MAX_SCALE; scale >= MIN_SCALE; scale -= 1) {
    if (modules * scale <= availableCssPx) return scale;
  }
  return undefined;
}

/** Black modules on white, with a 4-module quiet zone, at an integer scale. The canvas is sized modules x scale. */
export function paintQr(canvas: HTMLCanvasElement, symbol: QrSymbol, scale: number): void {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError("scale must be a positive integer");
  const total = (symbol.size + 2 * QUIET_ZONE_MODULES) * scale;
  canvas.width = total;
  canvas.height = total;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("a 2d canvas context is not available");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, total, total);
  ctx.fillStyle = "#000";
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      if (symbol.modules[y * symbol.size + x] === 1) {
        ctx.fillRect((x + QUIET_ZONE_MODULES) * scale, (y + QUIET_ZONE_MODULES) * scale, scale, scale);
      }
    }
  }
}
