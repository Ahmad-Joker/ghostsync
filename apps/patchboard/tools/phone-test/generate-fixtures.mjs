/**
 * Phone-test tooling (NOT shipped: lives outside src/ and public/, never reaches dist). Support material for the human
 * iPhone test of QR transfer. The fixtures are NOT physical-camera evidence (EV-PHYS stays NOT RUN until a person signs it).
 *
 * Builds REAL PatchBoard capsules (Kit replica + public encodeCapsule) of exact byte sizes for the two size classes of the
 * active rung (limit 1232, design 14.2), turns each into the app's frame (encodeFrame) and symbol (buildQrSymbol: uqr,
 * level L, version cap 25), and writes:
 *   generated/fixtures.json   everything, including frame text and capsule bytes (used by verify-fixtures.mjs)
 *   generated/fixtures.js     the data the display page needs (modules only), loadable from file://
 *
 * Run from the repo root after building the workspace packages:
 *   node apps/patchboard/tools/phone-test/generate-fixtures.mjs
 * Each run makes NEW capsules (the Kit picks a random replica id), so checksums change per run. Synthetic data only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeCapsule, encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import { buildQrSymbol, decodeFrame, encodeFrame, QR_MAX_CAPSULE_BYTES } from "@ghostsync/qr-transfer";

export const BOARD = "sprint-board";
export const APP = "patchboard";
/** Class S: 600 to 700 bytes; class L: 1150 to 1232 bytes (design 14.2, rung limit 1232). */
export const CLASSES = {
  S: { target: 650, min: 600, max: 700, count: 10 },
  L: { target: QR_MAX_CAPSULE_BYTES, min: 1150, max: 1232, count: 10 },
};

/** Same shape as apps/patchboard/src/model/adapters.ts cardAdapter (schema app/entityType/version and the three string fields). */
const cardAdapter = {
  schema: { app: APP, entityType: "card", schemaVersion: 1 },
  validate() {},
  toFields: (e) => ({ title: e.title, notes: e.notes, placement: e.placement }),
  fromFields: (f) => ({ title: String(f.title), notes: String(f.notes), placement: String(f.placement) }),
};

/** Deterministic lowercase text so each fixture differs but is realistic, not a repeated letter. */
function words(seed, length) {
  let x = (seed * 2654435761) >>> 0 || 1;
  const next = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
  let out = "";
  while (out.length < length) {
    const wl = 2 + (next() % 7);
    for (let i = 0; i < wl; i += 1) out += String.fromCharCode(97 + (next() % 26));
    out += " ";
  }
  return out.slice(0, length).trimEnd().padEnd(length, "x");
}

async function build(id, title, notes) {
  const r = createKit().createReplica(BOARD);
  try {
    r.collection(cardAdapter).put(id, { title, notes, placement: "todo|00001024" });
    return await encodeCapsule({ app: APP, documentId: BOARD, update: r.exportState() });
  } finally {
    r.destroy();
  }
}

/** A valid capsule of EXACTLY `target` bytes. The replica id is random, so the size is searched with retries. */
async function capsuleOfSize(target, id, title, seed) {
  const text = words(seed, 2000);
  let n = Math.max(0, target - 330);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const bytes = await build(id, title, text.slice(0, n));
    if (bytes.length === target) return bytes;
    n = Math.max(0, Math.min(2000, n + (target - bytes.length)));
  }
  throw new Error(`no capsule of exactly ${target} bytes was found`);
}

function packBits(symbol) {
  const out = new Uint8Array(Math.ceil((symbol.size * symbol.size) / 8));
  for (let i = 0; i < symbol.modules.length; i += 1) if (symbol.modules[i] === 1) out[i >> 3] |= 0x80 >> (i & 7);
  return Buffer.from(out).toString("base64");
}

export async function buildFixtures() {
  const fixtures = [];
  for (const [cls, spec] of Object.entries(CLASSES)) {
    for (let i = 1; i <= spec.count; i += 1) {
      const nn = String(i).padStart(2, "0");
      const seed = (cls === "S" ? 1000 : 2000) + i;
      const bytes = await capsuleOfSize(spec.target, `fx-${cls.toLowerCase()}-${nn}`, `Phone test ${cls}${nn}`, seed);
      const decoded = await decodeCapsule(bytes);
      if (decoded.metadata.app !== APP || decoded.metadata.documentId !== BOARD) throw new Error("capsule identity mismatch");
      const frame = encodeFrame(bytes);
      if (Buffer.compare(Buffer.from(decodeFrame(frame)), Buffer.from(bytes)) !== 0) throw new Error("frame round trip failed");
      const symbol = buildQrSymbol(frame);
      fixtures.push({
        id: `${cls}${nn}`,
        cls,
        index: i,
        board: BOARD,
        app: APP,
        capsuleBytes: bytes.length,
        frameChars: frame.length,
        version: symbol.version,
        modules: symbol.size,
        checksum12: decoded.metadata.sha256.slice(0, 12),
        sha256: decoded.metadata.sha256,
        frame,
        capsuleB64: Buffer.from(bytes).toString("base64"),
        bits: packBits(symbol),
      });
    }
  }
  return fixtures;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixtures = await buildFixtures();
  const meta = { board: BOARD, app: APP, limit: QR_MAX_CAPSULE_BYTES, eccLevel: "L", classes: CLASSES };
  const outDir = join(here, "generated");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "fixtures.json"), `${JSON.stringify({ meta, fixtures }, null, 2)}\n`);
  const lean = fixtures.map(({ frame: _f, capsuleB64: _c, sha256: _s, ...rest }) => rest);
  writeFileSync(join(outDir, "fixtures.js"), `// GENERATED by generate-fixtures.mjs. Synthetic data. Not physical-camera evidence.\nwindow.GS_FIXTURES = ${JSON.stringify({ meta, fixtures: lean })};\n`);
  for (const f of fixtures) {
    process.stdout.write(`${f.id}: capsule ${f.capsuleBytes} bytes, frame ${f.frameChars} chars, version ${f.version}, modules ${f.modules}, checksum ${f.checksum12}\n`);
  }
}
