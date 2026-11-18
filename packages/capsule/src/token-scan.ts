/**
 * JSON-aware token scan for the metadata region.
 *
 * `JSON.parse` neither reports source offsets nor preserves repeated keys, so
 * it cannot locate the `sha256` value span or detect duplicates. This small
 * hand-written scanner walks the grammar of the single top-level object and
 * records, for every top-level member, the DECODED name (string escapes
 * resolved) and the RAW value span. Spans are returned as UTF-8 BYTE offsets
 * into the metadata region, never UTF-16 indices. Nested values are skipped
 * structurally. It is NOT a regex scan and does not re-serialize anything.
 *
 * The scanner locates tokens only; value validation is done afterwards with
 * `JSON.parse` of the same text.
 */
import { CapsuleError } from "./errors.js";

export interface ScannedMember {
  readonly name: string;
  /** Inclusive start of the raw value token, as a UTF-8 byte offset. */
  readonly start: number;
  /** Exclusive end of the raw value token, as a UTF-8 byte offset. */
  readonly end: number;
}

export interface ScanResult {
  /** The decoded metadata text (BOM kept; the caller rejects a leading BOM first). */
  readonly text: string;
  readonly members: readonly ScannedMember[];
}

function malformed(reason: string): CapsuleError {
  return new CapsuleError("Malformed", `capsule metadata is malformed: ${reason}`);
}

const BOM_0 = 0xef;
const BOM_1 = 0xbb;
const BOM_2 = 0xbf;

/** True when the bytes begin with a UTF-8 byte order mark. */
export function startsWithBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === BOM_0 && bytes[1] === BOM_1 && bytes[2] === BOM_2;
}

/**
 * Fatal UTF-8 decode. `ignoreBOM: true` KEEPS a leading U+FEFF in the output
 * (the default would strip it and silently shift every mapped offset by 3), so
 * the caller rejects a leading BOM explicitly before calling this.
 */
export function decodeMetadataText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw malformed("not valid UTF-8");
  }
}

function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

interface CharSpan {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

class Scanner {
  i = 0;
  constructor(private readonly s: string) {}

  skipWs(): void {
    while (this.i < this.s.length && isWhitespace(this.s.charCodeAt(this.i))) this.i++;
  }

  /** Read a JSON string starting at the opening quote; return the DECODED value. */
  readString(): string {
    const s = this.s;
    if (s.charCodeAt(this.i) !== 0x22) throw malformed("expected a string");
    this.i++;
    let out = "";
    for (;;) {
      if (this.i >= s.length) throw malformed("unterminated string");
      const c = s.charCodeAt(this.i);
      if (c === 0x22) {
        this.i++;
        return out;
      }
      if (c < 0x20) throw malformed("control character in string");
      if (c !== 0x5c) {
        out += s[this.i];
        this.i++;
        continue;
      }
      // Escape sequence.
      this.i++;
      if (this.i >= s.length) throw malformed("unterminated escape");
      const e = s[this.i];
      this.i++;
      switch (e) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          let code = 0;
          for (let k = 0; k < 4; k++) {
            const h = this.i < s.length ? hexValue(s.charCodeAt(this.i)) : -1;
            if (h < 0) throw malformed("invalid unicode escape");
            code = code * 16 + h;
            this.i++;
          }
          out += String.fromCharCode(code);
          break;
        }
        default:
          throw malformed("invalid escape");
      }
    }
  }

  /** Skip one value token starting at `i`; leaves `i` just past it. */
  skipValue(): void {
    const s = this.s;
    if (this.i >= s.length) throw malformed("missing value");
    const c = s.charCodeAt(this.i);
    if (c === 0x22) {
      this.readString();
      return;
    }
    if (c === 0x7b || c === 0x5b) {
      let depth = 0;
      while (this.i < s.length) {
        const ch = s.charCodeAt(this.i);
        if (ch === 0x22) {
          this.readString();
          continue;
        }
        if (ch === 0x7b || ch === 0x5b) depth++;
        else if (ch === 0x7d || ch === 0x5d) depth--;
        this.i++;
        if (depth === 0) return;
      }
      throw malformed("unterminated nested value");
    }
    const begin = this.i;
    while (this.i < s.length) {
      const ch = s.charCodeAt(this.i);
      if (isWhitespace(ch) || ch === 0x2c || ch === 0x7d || ch === 0x5d) break;
      this.i++;
    }
    if (this.i === begin) throw malformed("missing value");
  }

  scanObject(): CharSpan[] {
    const s = this.s;
    const members: CharSpan[] = [];
    this.skipWs();
    if (s.charCodeAt(this.i) !== 0x7b) throw malformed("metadata is not a JSON object");
    this.i++;
    this.skipWs();
    if (s.charCodeAt(this.i) === 0x7d) {
      this.i++;
    } else {
      for (;;) {
        this.skipWs();
        const name = this.readString();
        this.skipWs();
        if (s.charCodeAt(this.i) !== 0x3a) throw malformed("expected ':'");
        this.i++;
        this.skipWs();
        const start = this.i;
        this.skipValue();
        members.push({ name, start, end: this.i });
        this.skipWs();
        const sep = s.charCodeAt(this.i);
        this.i++;
        if (sep === 0x2c) continue;
        if (sep === 0x7d) break;
        throw malformed("expected ',' or '}'");
      }
    }
    this.skipWs();
    if (this.i !== s.length) throw malformed("trailing content after the object");
    return members;
  }
}

/** Map ascending UTF-16 positions to UTF-8 byte offsets (positions are token boundaries). */
function toByteOffsets(text: string, positions: readonly number[]): number[] {
  const out: number[] = [];
  let bytes = 0;
  let idx = 0;
  for (const p of positions) {
    while (idx < p) {
      const cp = text.charCodeAt(idx);
      if (cp < 0x80) {
        bytes += 1;
        idx += 1;
      } else if (cp < 0x800) {
        bytes += 2;
        idx += 1;
      } else if (cp >= 0xd800 && cp <= 0xdbff && idx + 1 < text.length) {
        bytes += 4;
        idx += 2;
      } else {
        bytes += 3;
        idx += 1;
      }
    }
    out.push(bytes);
  }
  return out;
}

/**
 * Scan the metadata bytes. Rejects (Malformed): a leading BOM (before any
 * scanning), invalid UTF-8, grammar errors, and duplicate DECODED top-level
 * names (including escaped equivalents such as "\u0073ha256").
 */
export function scanMetadata(meta: Uint8Array): ScanResult {
  if (startsWithBom(meta)) throw malformed("leading byte order mark");
  const text = decodeMetadataText(meta);
  const spans = new Scanner(text).scanObject();

  const seen = new Set<string>();
  for (const m of spans) {
    if (seen.has(m.name)) throw malformed("duplicate key");
    seen.add(m.name);
  }

  const positions: number[] = [];
  for (const m of spans) positions.push(m.start, m.end);
  const offsets = toByteOffsets(text, positions);
  const members: ScannedMember[] = spans.map((m, k) => ({
    name: m.name,
    start: offsets[2 * k] as number,
    end: offsets[2 * k + 1] as number,
  }));
  return { text, members };
}
