import type { QrSymbol } from "../src/symbol.js";

export interface Raster {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Test-side rasterizer (not the app's paintQr): black on white, 4-module quiet zone, integer scale. */
export function rasterize(symbol: QrSymbol, scale: number): Raster {
  const total = (symbol.size + 8) * scale;
  const data = new Uint8ClampedArray(total * total * 4).fill(255);
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      if (symbol.modules[y * symbol.size + x] !== 1) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = (x + 4) * scale + dx;
          const py = (y + 4) * scale + dy;
          const o = (py * total + px) * 4;
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
        }
      }
    }
  }
  return { data, width: total, height: total };
}
