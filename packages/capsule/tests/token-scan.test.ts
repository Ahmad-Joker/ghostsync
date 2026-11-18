import { describe, expect, it } from "vitest";

import { decodeCapsule, encodeCapsule, isCapsuleError } from "../src/index.js";
import { scanMetadata } from "../src/token-scan.js";
import {
  APP,
  CREATED,
  DOC,
  MARK,
  bytesOf,
  metaOf,
  rawCapsule,
  rejection,
  replicaWith,
  sealedCapsule,
  standardUpdate,
} from "./helpers.js";

const ZEROS = "0".repeat(64);
const update = standardUpdate();
const N = update.length;

async function codeOf(bytes: Uint8Array): Promise<string | undefined> {
  const e = await rejection(decodeCapsule(bytes));
  return isCapsuleError(e) ? e.code : undefined;
}

describe("metadata token scan", () => {
  it("Unicode content before sha256 keeps byte offsets correct (round trip verifies)", async () => {
    const app = "ünï-💾";
    const documentId = "文書-1";
    const r = replicaWith(documentId, { k: "v" });
    const cap = await encodeCapsule({ app, documentId, update: r.exportState() });
    const decoded = await decodeCapsule(cap);
    expect(decoded.metadata.app).toBe(app);
    expect(decoded.metadata.documentId).toBe(documentId);

    const metaLength = new DataView(cap.buffer, cap.byteOffset).getUint32(7, false);
    const meta = cap.subarray(11, 11 + metaLength);
    const sha = scanMetadata(meta).members.find((m) => m.name === "sha256");
    expect(sha).toBeDefined();
    if (sha === undefined) return;
    expect(sha.end - sha.start).toBe(66);
    const token = new TextDecoder().decode(meta.subarray(sha.start, sha.end));
    expect(token).toBe(`"${decoded.metadata.sha256}"`);
    // The UTF-16 index of the token differs from its UTF-8 byte offset (multi-byte content precedes it).
    const text = new TextDecoder().decode(meta);
    expect(text.indexOf(token)).toBeLessThan(sha.start);
  });

  it("a key-looking string inside a value does not confuse span location", async () => {
    const app = '"sha256":"' + ZEROS;
    const r = replicaWith(DOC, { k: 1 });
    const cap = await encodeCapsule({ app, documentId: DOC, update: r.exportState() });
    expect((await decodeCapsule(cap)).metadata.app).toBe(app);
  });

  it("BOM-prefixed metadata is Malformed", async () => {
    const good = sealedCapsule(metaOf(N), update);
    const metaLength = new DataView(good.buffer).getUint32(7, false);
    const meta = good.slice(11, 11 + metaLength);
    const withBom = new Uint8Array(3 + meta.length);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(meta, 3);
    // metaLength is bumped by 3 so framing stays consistent.
    expect(await codeOf(rawCapsule(withBom, update))).toBe("Malformed");
  });

  it("a U+FEFF inside a string value is ordinary content", async () => {
    const cap = sealedCapsule(metaOf(N, { app: "a\uFEFFb" }), update);
    expect((await decodeCapsule(cap)).metadata.app).toBe("a\uFEFFb");
  });

  it("escaped-equivalent duplicate keys are Malformed", async () => {
    const dupSha = `{"formatVersion":1,"app":"${APP}","documentId":"${DOC}","updateByteLength":${N},"sha256":"${ZEROS}","\\u0073ha256":"${ZEROS}","createdAt":"${CREATED}"}`;
    expect(await codeOf(rawCapsule(bytesOf(dupSha), update))).toBe("Malformed");
    const dupApp = `{"formatVersion":1,"app":"${APP}","\\u0061pp":"x","documentId":"${DOC}","updateByteLength":${N},"sha256":"${ZEROS}","createdAt":"${CREATED}"}`;
    expect(await codeOf(rawCapsule(bytesOf(dupApp), update))).toBe("Malformed");
    const plainDup = `{"formatVersion":1,"app":"${APP}","app":"${APP}","documentId":"${DOC}","updateByteLength":${N},"sha256":"${ZEROS}","createdAt":"${CREATED}"}`;
    expect(await codeOf(rawCapsule(bytesOf(plainDup), update))).toBe("Malformed");
  });

  it("a single escaped spelling of the sha256 KEY is located by decoded name and verifies", async () => {
    const template = metaOf(N).replace('"sha256"', '"\\u0073ha256"');
    const cap = sealedCapsule(template, update);
    expect((await decodeCapsule(cap)).metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("escapes, wrong length, uppercase and non-hex inside the checksum token are Malformed", async () => {
    const variants: Record<string, string> = {
      escapedDigit: "\\u0061" + "0".repeat(63),
      tooShort: "0".repeat(63),
      tooLong: "0".repeat(65),
      uppercase: "A" + "0".repeat(63),
      nonHex: "g" + "0".repeat(63),
      escapedQuote: "\\\"" + "0".repeat(62),
    };
    for (const [name, value] of Object.entries(variants)) {
      const meta = `{"formatVersion":1,"app":"${APP}","documentId":"${DOC}","updateByteLength":${N},"sha256":"${value}","createdAt":"${CREATED}"}`;
      expect(await codeOf(rawCapsule(bytesOf(meta), update)), name).toBe("Malformed");
    }
    // A non-string sha256 token is Malformed too.
    const num = `{"formatVersion":1,"app":"${APP}","documentId":"${DOC}","updateByteLength":${N},"sha256":0,"createdAt":"${CREATED}"}`;
    expect(await codeOf(rawCapsule(bytesOf(num), update))).toBe("Malformed");
  });

  it("whitespace and key reordering verify when the bytes are internally consistent", async () => {
    const template =
      `{\n  "createdAt" : "${CREATED}" ,\t"sha256" :\r\n "${MARK}" , "documentId":"${DOC}",` +
      ` "updateByteLength": ${N}, "app":"${APP}", "formatVersion": 1 }\n`;
    const cap = sealedCapsule(template, update);
    const decoded = await decodeCapsule(cap);
    expect(decoded.metadata.app).toBe(APP);
    expect(decoded.metadata.updateByteLength).toBe(N);
  });

  it("invalid UTF-8 in the metadata is Malformed", async () => {
    const [head, tail] = metaOf(N).replace(MARK, ZEROS).split(APP) as [string, string];
    const h = bytesOf(head);
    const t = bytesOf(tail);
    const meta = new Uint8Array(h.length + 2 + t.length);
    meta.set(h, 0);
    meta.set([0xc3, 0x28], h.length); // invalid UTF-8 sequence inside the app value
    meta.set(t, h.length + 2);
    expect(await codeOf(rawCapsule(meta, update))).toBe("Malformed");
  });

  it("non-object metadata and trailing garbage are Malformed", async () => {
    for (const text of ["[]", "null", '"x"', "42", "{", "", `{"a":1} x`]) {
      expect(await codeOf(rawCapsule(bytesOf(text), update)), text).toBe("Malformed");
    }
  });
});
