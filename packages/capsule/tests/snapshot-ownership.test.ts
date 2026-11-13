import { describe, expect, it } from "vitest";

import {
  decodeCapsule,
  encodeCapsule,
  importCapsuleInto,
  importCapsuleIntoPersisted,
} from "../src/index.js";
import { APP, DOC, capsuleOf, persistedFake, rejection, replicaWith } from "./helpers.js";

const sab = (n = 64): Uint8Array => new Uint8Array(new SharedArrayBuffer(n));

describe("NFR-CAP-003 (a) mutation during an asynchronous operation cannot change verified/applied data", () => {
  it("encodeCapsule: mutating the update right after invoking, before awaiting, does not change the capsule", async () => {
    const src = replicaWith(DOC, { k: "original" });
    const bytes = src.exportState().bytes.slice();
    const expected = Array.from(bytes);
    const pending = encodeCapsule({ app: APP, documentId: DOC, update: bytes });
    bytes.fill(0); // in-flight mutation
    const cap = await pending;
    expect(Array.from((await decodeCapsule(cap)).update)).toEqual(expected);
  });

  it("encodeCapsule: mutating a TransportUpdate's bytes in flight does not change the capsule", async () => {
    const src = replicaWith(DOC, { k: "original" });
    const update = { documentId: DOC, kind: "full" as const, bytes: src.exportState().bytes.slice() };
    const expected = Array.from(update.bytes);
    const pending = encodeCapsule({ app: APP, documentId: DOC, update });
    update.bytes.fill(7);
    expect(Array.from((await decodeCapsule(await pending)).update)).toEqual(expected);
  });

  it("decodeCapsule: mutating the capsule in flight does not turn a valid capsule into a failure or change the result", async () => {
    const src = replicaWith(DOC, { k: "original" });
    const cap = await capsuleOf(src);
    const expected = Array.from(src.exportState().bytes);
    const pending = decodeCapsule(cap);
    cap.fill(0); // would be Malformed if the caller buffer were re-read
    const decoded = await pending;
    expect(Array.from(decoded.update)).toEqual(expected);
  });

  it("decodeCapsule: a payload flip in flight cannot make a verified payload differ", async () => {
    const src = replicaWith(DOC, { k: "original" });
    const cap = await capsuleOf(src);
    const expected = Array.from(src.exportState().bytes);
    const pending = decodeCapsule(cap);
    cap[cap.length - 1] = (cap[cap.length - 1] as number) ^ 0xff; // would be ChecksumMismatch if re-read
    expect(Array.from((await pending).update)).toEqual(expected);
  });

  it("importCapsuleInto: the applied payload is the validated payload", async () => {
    const src = replicaWith(DOC, { k: "original", n: 1 });
    const cap = await capsuleOf(src);
    const target = replicaWith(DOC);
    const pending = importCapsuleInto(target, cap, { app: APP });
    cap.fill(0xaa);
    await expect(pending).resolves.toMatchObject({ applied: true });
    expect(target.getState()).toEqual(src.getState());
  });

  it("importCapsuleIntoPersisted: the applied payload is the validated payload", async () => {
    const src = replicaWith(DOC, { k: "original", n: 1 });
    const cap = await capsuleOf(src);
    const replica = replicaWith(DOC);
    const fake = persistedFake(replica);
    const pending = importCapsuleIntoPersisted(fake.target, cap);
    cap.fill(0xaa);
    await expect(pending).resolves.toMatchObject({ applied: true, persisted: true });
    expect(replica.getState()).toEqual(src.getState());
  });
});

describe("NFR-CAP-003 (b) returned buffers do not alias caller input after completion", () => {
  it("encodeCapsule: input mutation after completion does not change the capsule; mutating the capsule does not change the input", async () => {
    const src = replicaWith(DOC, { k: "v" });
    const input = src.exportState().bytes.slice();
    const inputCopy = Array.from(input);
    const cap = await encodeCapsule({ app: APP, documentId: DOC, update: input });
    const capCopy = Array.from(cap);

    input.fill(0);
    expect(Array.from(cap)).toEqual(capCopy);

    const input2 = src.exportState().bytes.slice();
    const cap2 = await encodeCapsule({ app: APP, documentId: DOC, update: input2 });
    cap2.fill(0);
    expect(Array.from(input2)).toEqual(inputCopy);
  });

  it("decodeCapsule: decoded update is independent of the input capsule in both directions", async () => {
    const src = replicaWith(DOC, { k: "v" });
    const cap = await capsuleOf(src);
    const decoded = await decodeCapsule(cap);
    const updateCopy = Array.from(decoded.update);

    expect(decoded.update.buffer).not.toBe(cap.buffer);
    cap.fill(0);
    expect(Array.from(decoded.update)).toEqual(updateCopy);

    const cap2 = await capsuleOf(src);
    const cap2Copy = Array.from(cap2);
    const decoded2 = await decodeCapsule(cap2);
    decoded2.update.fill(0);
    expect(Array.from(cap2)).toEqual(cap2Copy);
    // The capsule can still be decoded: the input was not changed by mutating the result.
    await expect(decodeCapsule(cap2)).resolves.toBeDefined();
  });

  it("Buffer (Uint8Array subclass) input: results are plain, independent Uint8Arrays (Buffer#slice would alias)", async () => {
    const src = replicaWith(DOC, { k: "from-buffer" });
    const buf = Buffer.from(await capsuleOf(src));
    expect(Buffer.isBuffer(buf)).toBe(true);

    const pending = decodeCapsule(buf);
    buf.fill(0); // in-flight mutation of a Buffer
    const decoded = await pending;
    expect(Object.getPrototypeOf(decoded.update)).toBe(Uint8Array.prototype);
    expect(decoded.update.buffer).not.toBe(buf.buffer);
    expect(decoded.update.byteLength).toBe(decoded.update.buffer.byteLength);
    expect(Array.from(decoded.update)).toEqual(Array.from(src.exportState().bytes));

    const bufUpdate = Buffer.from(src.exportState().bytes);
    const cap = await encodeCapsule({ app: APP, documentId: DOC, update: bufUpdate });
    expect(Object.getPrototypeOf(cap)).toBe(Uint8Array.prototype);
    expect(cap.buffer).not.toBe(bufUpdate.buffer);
    const before = Array.from(cap);
    bufUpdate.fill(0);
    expect(Array.from(cap)).toEqual(before);
    await expect(decodeCapsule(cap)).resolves.toBeDefined();

    const capBuf = Buffer.from(cap);
    const target = replicaWith(DOC);
    const importing = importCapsuleInto(target, capBuf, { app: APP });
    capBuf.fill(0);
    await importing;
    expect(target.getState()).toEqual(src.getState());
  });
});

describe("NFR-CAP-003 SharedArrayBuffer-backed input is a documented TypeError", () => {
  it("rejects with TypeError for encode, decode and both imports", async () => {
    const src = replicaWith(DOC, { k: 1 });
    expect(await rejection(encodeCapsule({ app: APP, documentId: DOC, update: sab() }))).toBeInstanceOf(TypeError);
    expect(
      await rejection(
        encodeCapsule({ app: APP, documentId: DOC, update: { documentId: DOC, kind: "full", bytes: sab() } }),
      ),
    ).toBeInstanceOf(TypeError);
    expect(await rejection(decodeCapsule(sab()))).toBeInstanceOf(TypeError);
    expect(await rejection(importCapsuleInto(src, sab(), { app: APP }))).toBeInstanceOf(TypeError);
    const fake = persistedFake(src);
    expect(await rejection(importCapsuleIntoPersisted(fake.target, sab()))).toBeInstanceOf(TypeError);
    expect(fake.calls).toEqual({ apply: 0, flush: 0 });
  });
});
