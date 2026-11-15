import { QrTransferError } from "./errors.js";

/** RFC 9285 alphabet: value to character. */
export const BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const VALUE_OF = new Map<string, number>([...BASE45_ALPHABET].map((ch, i) => [ch, i]));

export function base45Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    const n = (bytes[i] as number) * 256 + (bytes[i + 1] as number);
    out += BASE45_ALPHABET[n % 45] as string;
    out += BASE45_ALPHABET[Math.floor(n / 45) % 45] as string;
    out += BASE45_ALPHABET[Math.floor(n / 2025)] as string;
  }
  if (i < bytes.length) {
    const n = bytes[i] as number;
    out += BASE45_ALPHABET[n % 45] as string;
    out += BASE45_ALPHABET[Math.floor(n / 45)] as string;
  }
  return out;
}

function valueAt(body: string, i: number): number {
  return VALUE_OF.get(body.charAt(i)) as number;
}

/**
 * Validate a Base45 body without producing output and return the decoded byte length.
 * Order: length (a single leftover character), alphabet over the whole body, then group ranges.
 */
export function base45ValidatedLength(body: string): number {
  if (body.length % 3 === 1) throw new QrTransferError("InvalidLength", "base45 body has a leftover character");
  for (let i = 0; i < body.length; i += 1) {
    if (!VALUE_OF.has(body.charAt(i))) throw new QrTransferError("InvalidCharacter", "base45 body has a character outside the alphabet");
  }
  for (let i = 0; i < body.length; i += 3) {
    const left = body.length - i;
    const n = left >= 3 ? valueAt(body, i) + valueAt(body, i + 1) * 45 + valueAt(body, i + 2) * 2025 : valueAt(body, i) + valueAt(body, i + 1) * 45;
    if (left >= 3 ? n > 65535 : n > 255) throw new QrTransferError("OutOfRange", "base45 group is out of range");
  }
  return Math.floor(body.length / 3) * 2 + (body.length % 3 === 2 ? 1 : 0);
}

/** Fill `out` (exactly the validated length) from a body that `base45ValidatedLength` accepted. */
export function base45FillValidated(body: string, out: Uint8Array): void {
  let o = 0;
  for (let i = 0; i < body.length; i += 3) {
    if (body.length - i >= 3) {
      const n = valueAt(body, i) + valueAt(body, i + 1) * 45 + valueAt(body, i + 2) * 2025;
      out[o] = n >> 8;
      out[o + 1] = n & 255;
      o += 2;
    } else {
      out[o] = valueAt(body, i) + valueAt(body, i + 1) * 45;
      o += 1;
    }
  }
}

export function base45Decode(body: string): Uint8Array {
  const out = new Uint8Array(base45ValidatedLength(body));
  base45FillValidated(body, out);
  return out;
}
