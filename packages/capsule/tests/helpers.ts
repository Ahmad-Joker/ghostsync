/** Shared test helpers (not a test file: no `.test.ts` suffix). */
import { createHash } from "node:crypto";

import { createKit } from "@ghostsync/kit";
import type { ApplyOutcome, EntityAdapter, Fields, Replica, Scalar, State } from "@ghostsync/kit";

import { encodeCapsule } from "../src/index.js";
import type { PersistTarget } from "../src/index.js";

export const APP = "fieldledger";
export const DOC = "doc-1";
export const CREATED = "2026-01-01T00:00:00.000Z";
export const MARK = "__SHA__";

const enc = new TextEncoder();

export function bytesOf(text: string): Uint8Array {
  return enc.encode(text);
}

export function replicaWith(doc: string, entries: Record<string, Scalar> = {}): Replica {
  const r = createKit().createReplica(doc);
  for (const [k, v] of Object.entries(entries)) r.set(k, v);
  return r;
}

export async function capsuleOf(replica: Replica, app: string = APP): Promise<Uint8Array> {
  return encodeCapsule({ app, documentId: replica.documentId, update: replica.exportState() });
}

/** Independent oracle: SHA-256 hex via node:crypto. */
export function nodeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface RawOptions {
  readonly version?: number;
  readonly metaLengthDelta?: number;
}

/** Assemble header + metadata + update with NO checksum logic. */
export function rawCapsule(meta: Uint8Array, update: Uint8Array, opts: RawOptions = {}): Uint8Array {
  const out = new Uint8Array(11 + meta.length + update.length);
  out.set([0x47, 0x53, 0x43, 0x41, 0x50, 0x00], 0);
  out[6] = opts.version ?? 1;
  new DataView(out.buffer).setUint32(7, meta.length + (opts.metaLengthDelta ?? 0), false);
  out.set(meta, 11);
  out.set(update, 11 + meta.length);
  return out;
}

/** Standard metadata template (key order fixed); `over` replaces/removes (undefined) keys. */
export function metaOf(updateLen: number, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    app: APP,
    documentId: DOC,
    updateByteLength: updateLen,
    sha256: MARK,
    createdAt: CREATED,
    ...over,
  });
}

/**
 * Build a capsule from a metadata TEMPLATE containing MARK exactly once inside
 * the sha256 string; the digest is computed with node:crypto over the received
 * layout rule (offset 7..end, placeholder zeros) and written in place.
 */
export function sealedCapsule(template: string, update: Uint8Array, opts: RawOptions = {}): Uint8Array {
  const zeroed = rawCapsule(bytesOf(template.replace(MARK, "0".repeat(64))), update, opts);
  const digest = nodeSha256Hex(zeroed.subarray(7));
  return rawCapsule(bytesOf(template.replace(MARK, digest)), update, opts);
}

export function standardUpdate(entries: Record<string, Scalar> = { k: "v" }): Uint8Array {
  const r = replicaWith(DOC, entries);
  const bytes = r.exportState().bytes;
  r.destroy();
  return bytes;
}

export interface Incident {
  title: string;
  priority: number;
}

export const incidentAdapter: EntityAdapter<Incident> = {
  schema: { app: APP, schemaVersion: 1, entityType: "incident" },
  validate(e: Incident): void {
    if (typeof e.title !== "string" || typeof e.priority !== "number") {
      throw new TypeError("invalid incident");
    }
  },
  toFields: (e): Fields => ({ title: e.title, priority: e.priority }),
  fromFields: (f: Fields): Incident => ({ title: String(f["title"]), priority: Number(f["priority"]) }),
};

export interface PersistedFake {
  readonly target: PersistTarget;
  readonly calls: { apply: number; flush: number };
}

export interface PersistedFakeOptions {
  readonly app?: string;
  readonly documentId?: string;
  readonly flushError?: Error;
  readonly applyThrows?: Error;
}

/** Structural PersistTarget backed by a real Kit replica; identity carries replicaId like a real session. */
export function persistedFake(replica: Replica, o: PersistedFakeOptions = {}): PersistedFake {
  const calls = { apply: 0, flush: 0 };
  const identity = { app: o.app ?? APP, documentId: o.documentId ?? replica.documentId, replicaId: "r-test" };
  const target: PersistTarget = {
    identity,
    applyUpdate(carrier: unknown): ApplyOutcome {
      calls.apply++;
      if (o.applyThrows !== undefined) throw o.applyThrows;
      return replica.applyUpdate(carrier);
    },
    async flush(): Promise<void> {
      calls.flush++;
      if (o.flushError !== undefined) throw o.flushError;
    },
    getState(): State {
      return replica.getState();
    },
  };
  return { target, calls };
}

/** Rejection helper: resolves to the thrown value so tests can assert on it. */
export async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}
