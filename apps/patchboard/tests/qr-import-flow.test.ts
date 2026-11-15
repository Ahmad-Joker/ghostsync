import { QR_MAX_CAPSULE_BYTES, decodeFrame, encodeFrame } from "@ghostsync/qr-transfer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportView } from "../src/session/session-controller.js";
import { deferred, qrCapsule, qrCapsuleOfSize, qrRig, scanAndHold, waitUntil } from "./qr-seams.js";

const fileOf = (bytes: Uint8Array): File => new File([bytes as BlobPart], "peer.gscap");
const comparable = (v: ImportView | undefined): Omit<ImportView, "source"> | undefined => {
  if (v === undefined) return undefined;
  const { source: _source, ...rest } = v;
  return rest;
};

function flipByteInUpdate(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  out[out.length - 5] = (out[out.length - 5] as number) ^ 0xff;
  return out;
}

describe("U-QR-10 QR import flow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the shared pipeline: one applyUpdate with a full-state carrier, one flush, source qr", async () => {
    const rig = qrRig();
    const bytes = await qrCapsule();
    expect(await rig.c.importBytes(bytes, "qr")).toBe(true);
    expect(rig.calls.apply).toHaveLength(1);
    expect(rig.calls.apply[0]?.kind).toBe("full");
    expect(rig.calls.apply[0]?.documentId).toBe("test-board");
    expect(rig.calls.flush).toBe(1);
    expect(rig.c.importView?.state).toBe("applied-saved");
    expect(rig.c.importView?.source).toBe("qr");
    expect(rig.c.importView?.diff).toEqual(["Added: From peer in To do"]);
  });

  it("QR and file imports of the same bytes give the same view (6 byte arrays)", async () => {
    const good = await qrCapsule();
    const cases: Array<[string, Uint8Array]> = [
      ["valid", good],
      ["wrong board", await qrCapsule({ documentId: "other-board" })],
      ["wrong app", await qrCapsule({ app: "fieldledger" })],
      ["garbage", new Uint8Array([1, 2, 3])],
      ["bad checksum", flipByteInUpdate(good)],
      ["truncated", good.slice(0, good.length - 20)],
    ];
    for (const [name, bytes] of cases) {
      const a = qrRig();
      const b = qrRig();
      await a.c.importFile(fileOf(bytes));
      await b.c.importBytes(bytes, "qr");
      expect(comparable(b.c.importView), name).toEqual(comparable(a.c.importView));
      expect(b.c.importView?.source, name).toBe("qr");
      expect(a.c.importView?.source, name).toBe("file");
      expect(b.calls.apply.length, name).toBe(a.calls.apply.length);
    }
  });

  it("the file path is unchanged: an oversize file is still rejected before it is read", async () => {
    const rig = qrRig();
    let read = false;
    const big = { size: 16 * 1024 * 1024 + 1, arrayBuffer: () => ((read = true), Promise.resolve(new ArrayBuffer(0))) } as unknown as File;
    await rig.c.importFile(big);
    expect(rig.c.importView?.code).toBe("OversizedRaw");
    expect(read).toBe(false);
  });

  it("scanning only holds the capsule: nothing is applied, saved or notified to the import view", async () => {
    const rig = qrRig();
    await scanAndHold(rig, await qrCapsule());
    expect(rig.qr.scanState).toBe("scanned");
    expect(rig.calls.apply).toHaveLength(0);
    expect(rig.calls.flush).toBe(0);
    expect(rig.c.importView).toBeUndefined();
    expect(rig.qr.mode).toBe("qr-scan");
    expect(rig.qr.preview?.metadata.app).toBe("patchboard");
  });

  it("double activation in one task starts exactly one import", async () => {
    const rig = qrRig();
    await scanAndHold(rig, await qrCapsule());
    const first = rig.qr.importScanned();
    const second = rig.qr.importScanned();
    await Promise.all([first, second]);
    expect(rig.calls.apply).toHaveLength(1);
    expect(rig.qr.scanState).toBe("imported");
  });

  it("re-activation after the import settled does nothing", async () => {
    const rig = qrRig();
    await scanAndHold(rig, await qrCapsule());
    await rig.qr.importScanned();
    await rig.qr.importScanned();
    expect(rig.calls.apply).toHaveLength(1);
  });

  it("rescan of an applied capsule is already-imported, offers no import and applies nothing", async () => {
    const rig = qrRig();
    const bytes = await qrCapsule();
    await scanAndHold(rig, bytes);
    await rig.qr.importScanned();
    await scanAndHold(rig, bytes);
    expect(rig.qr.scanState).toBe("already-imported");
    expect(rig.qr.held).toBeUndefined();
    await rig.qr.importScanned();
    expect(rig.calls.apply).toHaveLength(1);
  });

  it("applied-unsaved by QR: the alert state is the file flow's, and a rescan is already-imported", async () => {
    const rig = qrRig();
    rig.flush.fail = true;
    const bytes = await qrCapsule();
    await scanAndHold(rig, bytes);
    await rig.qr.importScanned();
    expect(rig.c.importView?.state).toBe("applied-unsaved");
    expect(rig.c.importView?.code).toBe("TransactionAbortError");
    expect(rig.qr.scanState).toBe("imported");
    await scanAndHold(rig, bytes);
    expect(rig.qr.scanState).toBe("already-imported");
    expect(rig.calls.apply).toHaveLength(1);
  });

  it("a rejected capsule at the preview shows the file flow's message and offers no import", async () => {
    const rig = qrRig();
    await scanAndHold(rig, flipByteInUpdate(await qrCapsule()));
    expect(rig.qr.scanState).toBe("rejected");
    expect(rig.qr.scanMessage).toContain("checksum does not match");
    expect(rig.qr.held).toBeUndefined();
    expect(rig.calls.apply).toHaveLength(0);
  });

  it("a wrong-board capsule is rejected at import with the mapped message and no apply", async () => {
    const rig = qrRig();
    await scanAndHold(rig, await qrCapsule({ documentId: "other-board" }));
    await rig.qr.importScanned();
    expect(rig.c.importView?.code).toBe("DocumentIdentityMismatch");
    expect(rig.qr.scanState).toBe("rejected");
    expect(rig.calls.apply).toHaveLength(0);
  });

  it("applied-set re-check at import time: a capsule applied after it was held is not applied again", async () => {
    const rig = qrRig();
    const bytes = await qrCapsule();
    await scanAndHold(rig, bytes);
    const sha = rig.qr.held?.metadata.sha256 ?? "";
    // The same capsule is applied through the QR path by another route while the first copy is still held.
    await rig.c.importBytes(bytes, "qr", { sha256: sha });
    expect(rig.calls.apply).toHaveLength(1);
    await rig.qr.importScanned();
    expect(rig.calls.apply).toHaveLength(1);
    expect(rig.qr.scanState).toBe("already-imported");
    expect(rig.qr.held).toBeUndefined();
  });

  it("scan is disabled and startScan is a no-op while a QR import is pending", async () => {
    const rig = qrRig();
    rig.flush.hold = deferred<void>();
    await scanAndHold(rig, await qrCapsule());
    const running = rig.qr.importScanned();
    expect(rig.qr.scanState).toBe("importing");
    expect(rig.qr.scanDisabled).toBe(true);
    expect(rig.c.importPending).toBe(true);
    const starts = rig.scan.starts;
    await rig.qr.startScan(rig.video);
    expect(rig.scan.starts).toBe(starts);
    expect(rig.qr.scanState).toBe("importing");
    rig.flush.hold.resolve();
    await running;
    expect(rig.qr.scanDisabled).toBe(false);
  });

  it("a held capsule is kept, not consumed, while another import is pending", async () => {
    const rig = qrRig();
    await scanAndHold(rig, await qrCapsule());
    const file = deferred<ArrayBuffer>();
    const fileBytes = await qrCapsule({ id: "card-file", title: "From file" });
    const filePending = rig.c.importFile({ size: fileBytes.length, arrayBuffer: () => file.promise } as unknown as File);
    expect(rig.c.importPending).toBe(true);
    await rig.qr.importScanned();
    expect(rig.qr.scanState).toBe("scanned");
    expect(rig.qr.held).toBeDefined();
    expect(rig.calls.apply).toHaveLength(0);
    file.resolve(fileBytes.buffer.slice(0) as ArrayBuffer);
    await filePending;
    expect(rig.calls.apply).toHaveLength(1);
    await rig.qr.importScanned();
    expect(rig.calls.apply).toHaveLength(2);
    expect(rig.qr.scanState).toBe("imported");
  });

  it("DIRECTION 1: QR scanning is disabled while a FILE import is pending, in the controller and for a running scan", async () => {
    const rig = qrRig();
    const file = deferred<ArrayBuffer>();
    const fileBytes = await qrCapsule();
    const filePending = rig.c.importFile({ size: fileBytes.length, arrayBuffer: () => file.promise } as unknown as File);
    expect(rig.qr.scanDisabled).toBe(true);
    const starts = rig.scan.starts;
    await rig.qr.startScan(rig.video);
    expect(rig.scan.starts).toBe(starts);
    expect(rig.qr.scanState).toBe("idle");
    file.resolve(fileBytes.buffer.slice(0) as ArrayBuffer);
    await filePending;
    expect(rig.qr.scanDisabled).toBe(false);
    await rig.qr.startScan(rig.video);
    expect(rig.qr.scanState).toBe("scanning");
  });

  it("DIRECTION 1b: a scan that is already running is stopped when a file import starts", async () => {
    const rig = qrRig();
    await rig.qr.startScan(rig.video);
    expect(rig.qr.scanState).toBe("scanning");
    const file = deferred<ArrayBuffer>();
    const fileBytes = await qrCapsule();
    const filePending = rig.c.importFile({ size: fileBytes.length, arrayBuffer: () => file.promise } as unknown as File);
    expect(rig.scan.stops).toBe(1);
    expect(rig.qr.scanState).toBe("idle");
    file.resolve(fileBytes.buffer.slice(0) as ArrayBuffer);
    await filePending;
  });

  it("DIRECTION 2: a FILE import is refused while a QR import is pending, then works", async () => {
    const rig = qrRig();
    rig.flush.hold = deferred<void>();
    await scanAndHold(rig, await qrCapsule());
    const running = rig.qr.importScanned();
    expect(rig.c.importPending).toBe(true);
    await waitUntil(() => rig.calls.flush === 1, "the held flush");
    let read = false;
    const other = { size: 10, arrayBuffer: () => ((read = true), Promise.resolve(new ArrayBuffer(10))) } as unknown as File;
    await rig.c.importFile(other);
    expect(read).toBe(false);
    expect(rig.calls.apply).toHaveLength(1);
    expect(rig.c.importView?.state).toBe("importing");
    expect(rig.c.importView?.source).toBe("qr");
    rig.flush.hold.resolve();
    await running;
    const fileBytes = await qrCapsule({ id: "card-file", title: "From file" });
    await rig.c.importFile(fileOf(fileBytes));
    expect(rig.c.importView?.source).toBe("file");
    expect(rig.c.importView?.state).toBe("applied-saved");
  });

  it("DIRECTION 2b: a second QR byte import is refused while a file import is pending", async () => {
    const rig = qrRig();
    const file = deferred<ArrayBuffer>();
    const fileBytes = await qrCapsule();
    const filePending = rig.c.importFile({ size: fileBytes.length, arrayBuffer: () => file.promise } as unknown as File);
    expect(await rig.c.importBytes(await qrCapsule({ id: "x" }), "qr")).toBe(false);
    expect(rig.calls.apply).toHaveLength(0);
    file.resolve(fileBytes.buffer.slice(0) as ArrayBuffer);
    await filePending;
  });

  it("the duplicate scope: a capsule applied by FILE is not recorded by the QR set, so a later scan imports it again (idempotent merge)", async () => {
    const rig = qrRig();
    const bytes = await qrCapsule();
    await rig.c.importFile(fileOf(bytes));
    expect(rig.calls.apply).toHaveLength(1);
    await scanAndHold(rig, bytes);
    expect(rig.qr.scanState).toBe("scanned");
    await rig.qr.importScanned();
    expect(rig.calls.apply).toHaveLength(2);
    expect(rig.c.importView?.diff).toEqual([]);
    // Now the QR set has it.
    await scanAndHold(rig, bytes);
    expect(rig.qr.scanState).toBe("already-imported");
  });

  it("import did not run: no open session gives idle and the message, nothing lost silently", async () => {
    const rig = qrRig();
    await scanAndHold(rig, await qrCapsule());
    (rig.c as unknown as { session: unknown }).session = undefined;
    await rig.qr.importScanned();
    expect(rig.qr.scanState).toBe("idle");
    expect(rig.qr.scanMessage).toBe("The import did not run. Scan the code again.");
    expect(rig.calls.apply).toHaveLength(0);
  });

  it("session binding: a held scan is dropped when the session ends, and a running import cannot publish afterwards", async () => {
    vi.stubGlobal("history", { replaceState: () => undefined });
    vi.stubGlobal("location", { pathname: "/", search: "" });
    const held = qrRig();
    await scanAndHold(held, await qrCapsule());
    await held.c.discardAndSwitch();
    expect(held.qr.scanState).toBe("idle");
    expect(held.qr.held).toBeUndefined();
    expect(held.qr.mode).toBe("file");

    const rig = qrRig();
    rig.flush.hold = deferred<void>();
    await scanAndHold(rig, await qrCapsule());
    const running = rig.qr.importScanned();
    await rig.c.discardAndSwitch();
    const revision = rig.c.revision;
    rig.flush.hold.resolve();
    await running;
    expect(rig.c.importView).toBeUndefined();
    expect(rig.qr.scanState).toBe("idle");
    expect(rig.c.revision).toBe(revision);
    expect(rig.c.model).toBeUndefined();
    expect(rig.c.hasAppliedQr(rig.qr.preview?.metadata.sha256 ?? "x")).toBe(false);
  });

  it("session end stops a running scan and releases the camera session", async () => {
    vi.stubGlobal("history", { replaceState: () => undefined });
    vi.stubGlobal("location", { pathname: "/", search: "" });
    const rig = qrRig();
    await rig.qr.startScan(rig.video);
    await rig.c.discardAndSwitch();
    expect(rig.scan.stops).toBe(1);
    expect(rig.qr.scanState).toBe("idle");
  });

  it("limit through the QR import path: 1232 bytes is accepted and 1233 is rejected with zero apply calls", async () => {
    const at = await qrCapsuleOfSize(QR_MAX_CAPSULE_BYTES);
    const over = await qrCapsuleOfSize(QR_MAX_CAPSULE_BYTES + 1);
    expect(at.length).toBe(1232);
    expect(over.length).toBe(1233);

    const ok = qrRig();
    await ok.c.importBytes(at, "qr");
    expect(ok.c.importView?.state).toBe("applied-saved");
    expect(ok.calls.apply).toHaveLength(1);

    const no = qrRig();
    await no.c.importBytes(over, "qr");
    expect(no.c.importView?.state).toBe("rejected");
    expect(no.c.importView?.code).toBe("OversizedRaw");
    expect(no.calls.apply).toHaveLength(0);
    expect(no.calls.flush).toBe(0);

    // The file path has a larger limit: the same 1233 bytes import by file.
    const viaFile = qrRig();
    await viaFile.c.importFile(fileOf(over));
    expect(viaFile.c.importView?.state).toBe("applied-saved");
  });

  it("the exact-limit capsule travels the whole QR path: frame, scan result, preview, import", async () => {
    const at = await qrCapsuleOfSize(QR_MAX_CAPSULE_BYTES);
    expect(decodeFrame(encodeFrame(at))).toEqual(at);
    const rig = qrRig();
    await scanAndHold(rig, at);
    expect(rig.qr.scanState).toBe("scanned");
    expect(rig.qr.preview?.bytes).toBe(1232);
    await rig.qr.importScanned();
    expect(rig.qr.scanState).toBe("imported");
    expect(rig.calls.apply).toHaveLength(1);
    await waitUntil(() => rig.c.importView?.state === "applied-saved", "applied-saved");
  });
});
