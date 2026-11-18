import { encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import type { ScanCallbacks, ScanSession, ScanState } from "@ghostsync/qr-transfer/browser";
import { cardAdapter } from "../src/model/adapters.js";
import { readBoard } from "../src/model/read-model.js";
import { SessionController } from "../src/session/session-controller.js";
import { QrTransferController } from "../src/transfer/qr/qr-controller.js";
import type { QrControllerDeps } from "../src/transfer/qr/qr-controller.js";
import { decodeCapsule } from "@ghostsync/capsule";
import type { Seams } from "./controller-seams.js";

export const QR_BOARD = "test-board";

/** A real capsule from a real Kit replica. `notes` pads the update, which pads the capsule, through public APIs only. */
export async function qrCapsule(opts: { app?: string; documentId?: string; title?: string; notes?: string; id?: string } = {}): Promise<Uint8Array> {
  const documentId = opts.documentId ?? QR_BOARD;
  const r = createKit().createReplica(documentId);
  try {
    r.collection(cardAdapter).put(opts.id ?? "card-peer", { title: opts.title ?? "From peer", notes: opts.notes ?? "", placement: "todo|00001024" });
    return await encodeCapsule({ app: opts.app ?? "patchboard", documentId, update: r.exportState() });
  } finally {
    r.destroy();
  }
}

/** A valid capsule of EXACTLY `target` bytes: notes length is searched, then the title length for fine tuning. */
export async function qrCapsuleOfSize(target: number): Promise<Uint8Array> {
  let notes = Math.max(0, target - 330);
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const bytes = await qrCapsule({ notes: "n".repeat(notes) });
    if (bytes.length === target) return bytes;
    notes = Math.max(0, notes + (target - bytes.length));
    if (notes > 2000) break;
  }
  for (let title = 1; title <= 120; title += 1) {
    for (let notes2 = Math.max(0, target - 450); notes2 <= Math.min(2000, target); notes2 += 1) {
      const bytes = await qrCapsule({ title: "t".repeat(title), notes: "n".repeat(notes2) });
      if (bytes.length === target) return bytes;
      if (bytes.length > target) break;
    }
  }
  throw new Error(`no public-API capsule of exactly ${target} bytes was found`);
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
export function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface Rig {
  readonly c: SessionController;
  readonly qr: QrTransferController;
  readonly calls: { apply: Array<{ documentId: string; kind: string; length: number }>; flush: number; close: number; dispose: number; notify: number };
  readonly flush: { fail: boolean; hold: Deferred<void> | undefined };
  /** Scan callbacks of the most recent createScan call. */
  readonly scan: { cb: ScanCallbacks | undefined; stops: number; starts: number };
  readonly video: HTMLVideoElement;
}

/** A SessionController over a fake persisted target, plus a QrTransferController over a fake scan session. */
export function qrRig(): Rig {
  const replica = createKit().createReplica(QR_BOARD);
  const cards = replica.collection(cardAdapter);
  const calls: Rig["calls"] = { apply: [], flush: 0, close: 0, dispose: 0, notify: 0 };
  const flush: Rig["flush"] = { fail: false, hold: undefined };
  const scan: Rig["scan"] = { cb: undefined, stops: 0, starts: 0 };
  const c = new SessionController({} as Storage, () => void (calls.notify += 1), () => undefined);
  const s = c as unknown as Seams;
  s.phase = "ready";
  s.boardId = QR_BOARD;
  s.cards = cards;
  c.model = readBoard(cards);
  s.session = {
    identity: { app: "patchboard", documentId: QR_BOARD, replicaId: "r1" },
    applyUpdate: (carrier: Parameters<typeof replica.applyUpdate>[0]) => {
      const k = carrier as { documentId: string; kind: string; bytes: Uint8Array };
      calls.apply.push({ documentId: k.documentId, kind: k.kind, length: k.bytes.length });
      return replica.applyUpdate(carrier);
    },
    flush: async () => {
      calls.flush += 1;
      if (flush.hold !== undefined) await flush.hold.promise;
      if (flush.fail) throw Object.assign(new Error("aborted"), { name: "PersistenceError", code: "TransactionAbortError" });
      s.onSaveState("saved", { sequence: calls.flush + 1 });
    },
    close: () => {
      calls.close += 1;
      return Promise.resolve();
    },
    dispose: () => {
      calls.dispose += 1;
      return Promise.resolve();
    },
  };
  const deps: QrControllerDeps = {
    createScan: (cb) => {
      scan.cb = cb;
      let state: ScanState = "idle";
      const session: ScanSession = {
        start: () => {
          scan.starts += 1;
          state = "requesting";
          cb.onState("requesting");
          state = "scanning";
          cb.onState("scanning");
          return Promise.resolve();
        },
        stop: () => {
          scan.stops += 1;
          state = "idle";
        },
        get state() {
          return state;
        },
      };
      return session;
    },
    decodeCapsule,
    chooseScale: () => 6,
  };
  const qr = new QrTransferController(c, deps, () => undefined);
  return { c, qr, calls, flush, scan, video: {} as HTMLVideoElement };
}

export async function waitUntil(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Start a scan and deliver `bytes` as the accepted result; resolves when the preview or rejection is shown. */
export async function scanAndHold(rig: Rig, bytes: Uint8Array): Promise<void> {
  await rig.qr.startScan(rig.video);
  rig.scan.cb?.onAccepted(bytes);
  await waitUntil(() => rig.qr.scanState !== "scanning", "the scan result");
}
