import { describe, expect, it } from "vitest";
import { QR_FRAME_PREFIX, QR_MAX_CAPSULE_BYTES, QR_MAX_FRAME_CHARS } from "../src/constants.js";
import { QrTransferError } from "../src/errors.js";
import type { QrTransferErrorCode } from "../src/errors.js";
import { decodeFrame, decodeFrameWith, encodeFrame } from "../src/frame.js";

function codeOf(fn: () => unknown): QrTransferErrorCode | "TypeError" | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    if (err instanceof QrTransferError) return err.code;
    if (err instanceof TypeError) return "TypeError";
    throw err;
  }
}

function spy(): { allocate: (n: number) => Uint8Array; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    allocate: (n) => {
      calls.push(n);
      return new Uint8Array(n);
    },
  };
}

const rejects = (text: string): { code: QrTransferErrorCode | "TypeError" | undefined; calls: number[] } => {
  const s = spy();
  return { code: codeOf(() => decodeFrameWith(text, s.allocate)), calls: s.calls };
};

describe("U-QR-02 frame", () => {
  it("encodes with the prefix and decodes back", () => {
    const bytes = Uint8Array.of(0x41, 0x42);
    expect(encodeFrame(bytes)).toBe("GSQ1:BB8");
    expect(decodeFrame("GSQ1:BB8")).toEqual(bytes);
  });

  it("limits: 0 is Empty, 1232 fits at exactly 1853 characters, 1233 is TooLarge", () => {
    expect(codeOf(() => encodeFrame(new Uint8Array(0)))).toBe("Empty");
    expect(encodeFrame(new Uint8Array(QR_MAX_CAPSULE_BYTES)).length).toBe(QR_MAX_FRAME_CHARS);
    expect(encodeFrame(new Uint8Array(QR_MAX_CAPSULE_BYTES)).length).toBe(1853);
    expect(codeOf(() => encodeFrame(new Uint8Array(QR_MAX_CAPSULE_BYTES + 1)))).toBe("TooLarge");
    // The frame for 1233 bytes would be 1855 characters.
    expect(5 + 3 * Math.floor(1233 / 2) + 2 * (1233 % 2)).toBe(1855);
  });

  it("a non-Uint8Array is a TypeError", () => {
    expect(codeOf(() => encodeFrame([1, 2] as unknown as Uint8Array))).toBe("TypeError");
    expect(codeOf(() => decodeFrame(5 as unknown as string))).toBe("TypeError");
  });

  it("a 1232-byte frame decodes with exactly one allocation of the exact length", () => {
    const bytes = new Uint8Array(1232).map((_, i) => (i * 7) & 255);
    const s = spy();
    const out = decodeFrameWith(encodeFrame(bytes), s.allocate);
    expect(s.calls).toEqual([1232]);
    expect(out).toEqual(bytes);
  });

  it("rejection matrix: every rejection allocates nothing", () => {
    const matrix: Array<[string, string, QrTransferErrorCode]> = [
      ["1855 characters", "GSQ1:" + "0".repeat(1850), "TooLarge"],
      ["1854 characters", "GSQ1:" + "0".repeat(1849), "TooLarge"],
      ["empty text", "", "NotGhostSync"],
      ["foreign url", "HTTPS://EXAMPLE.INVALID/", "NotGhostSync"],
      ["lowercase prefix", "gsq1:BB8", "NotGhostSync"],
      ["leading space", " GSQ1:BB8", "NotGhostSync"],
      ["future version", "GSQ2:BB8", "UnsupportedVersion"],
      ["animated", "GSA1:BB8", "AnimatedNotSupported"],
      ["empty payload", "GSQ1:", "InvalidLength"],
      ["leftover character", "GSQ1:BB8A", "InvalidLength"],
      ["lowercase payload", "GSQ1:bb8", "InvalidCharacter"],
      ["outside alphabet", "GSQ1:BB!", "InvalidCharacter"],
      ["group above 65535", "GSQ1:GGW", "OutOfRange"],
      ["two-character group above 255", "GSQ1:V5", "OutOfRange"],
    ];
    for (const [name, text, code] of matrix) {
      const r = rejects(text);
      expect(r.code, name).toBe(code);
      expect(r.calls, name).toEqual([]);
    }
  });

  it("a 1855-character text is TooLarge with 0 allocate calls (G3)", () => {
    const r = rejects("GSQ1:" + "0".repeat(1850));
    expect(r.code).toBe("TooLarge");
    expect(r.calls).toHaveLength(0);
  });

  it("check order: length bound before prefix, prefix before payload", () => {
    expect(rejects("x".repeat(1854)).code).toBe("TooLarge");
    expect(rejects("zz" + "0".repeat(10)).code).toBe("NotGhostSync");
    expect(rejects("GSQ1:a").code).toBe("InvalidLength");
  });

  it("never trims or repairs", () => {
    expect(rejects("GSQ1:BB8 ").code).toBe("InvalidLength");
    expect(rejects("GSQ1:BB8\n").code).toBe("InvalidLength");
    expect(rejects("\uFEFFGSQ1:BB8").code).toBe("NotGhostSync");
  });

  it("interior space frame GSQ1: 0 decodes to [0x24] and is what encodeFrame produces", () => {
    expect(encodeFrame(Uint8Array.of(0x24))).toBe("GSQ1: 0");
    expect(decodeFrame("GSQ1: 0")).toEqual(Uint8Array.of(0x24));
  });

  it("appended space: odd byte count is OutOfRange, even byte count is InvalidLength", () => {
    expect(encodeFrame(Uint8Array.of(0x41))).toBe("GSQ1:K1");
    expect(rejects("GSQ1:K1 ")).toEqual({ code: "OutOfRange", calls: [] });
    expect(rejects("GSQ1: 0 ")).toEqual({ code: "OutOfRange", calls: [] });
    expect(encodeFrame(Uint8Array.of(0x41, 0x42))).toBe("GSQ1:BB8");
    expect(rejects("GSQ1:BB8 ")).toEqual({ code: "InvalidLength", calls: [] });
    // No parity returns bytes.
    for (const n of [1, 2, 3, 10, 11]) {
      const frame = encodeFrame(new Uint8Array(n).fill(0x41));
      expect(() => decodeFrame(frame + " ")).toThrow(QrTransferError);
    }
  });

  it("the frame prefix constant", () => {
    expect(QR_FRAME_PREFIX).toBe("GSQ1:");
  });
});
