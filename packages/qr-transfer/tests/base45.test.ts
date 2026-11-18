import { describe, expect, it } from "vitest";
import { base45Decode, base45Encode } from "../src/base45.js";
import { QrTransferError } from "../src/errors.js";

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof QrTransferError ? err.code : `other:${String(err)}`;
  }
}

describe("U-QR-01 base45", () => {
  it.each([
    ["AB", "BB8"],
    ["Hello!!", "%69 VD92EX0"],
    ["base-45", "UJCLQE7W581"],
    ["ietf!", "QED8WEX0"],
  ])("RFC 9285 vector %s", (text, encoded) => {
    expect(base45Encode(ascii(text))).toBe(encoded);
    expect(base45Decode(encoded)).toEqual(ascii(text));
  });

  it("encodes the group boundaries", () => {
    expect(base45Encode(Uint8Array.of(0xff, 0xff))).toBe("FGW");
    expect(base45Encode(Uint8Array.of(0xff))).toBe("U5");
    expect(base45Decode("FGW")).toEqual(Uint8Array.of(0xff, 0xff));
    expect(base45Decode("U5")).toEqual(Uint8Array.of(0xff));
  });

  it("rejects values one above the boundaries", () => {
    expect(codeOf(() => base45Decode("GGW"))).toBe("OutOfRange");
    expect(codeOf(() => base45Decode("V5"))).toBe("OutOfRange");
  });

  it("rejects a leftover single character and lowercase", () => {
    expect(codeOf(() => base45Decode("A"))).toBe("InvalidLength");
    expect(codeOf(() => base45Decode("BB8A"))).toBe("InvalidLength");
    expect(codeOf(() => base45Decode("a"))).toBe("InvalidLength");
    expect(codeOf(() => base45Decode("bb8"))).toBe("InvalidCharacter");
  });

  it("empty input encodes and decodes to empty", () => {
    expect(base45Encode(new Uint8Array(0))).toBe("");
    expect(base45Decode("")).toEqual(new Uint8Array(0));
  });
});
