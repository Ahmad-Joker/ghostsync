import { describe, expect, it } from "vitest";

import { importCapsuleInto, importCapsuleIntoPersisted, isCapsuleError } from "../src/index.js";
import type { CapsuleErrorCode, DecodeCapsuleOptions } from "../src/index.js";
import { APP, DOC, capsuleOf, metaOf, persistedFake, rejection, replicaWith, sealedCapsule } from "./helpers.js";

interface Case {
  readonly name: string;
  readonly code: CapsuleErrorCode;
  readonly bytes: () => Promise<Uint8Array>;
  readonly opts?: DecodeCapsuleOptions;
  readonly app?: string;
}

const source = () => replicaWith(DOC, { incoming: "x" });

const cases: Case[] = [
  { name: "OversizedRaw", code: "OversizedRaw", bytes: () => capsuleOf(source()), opts: { maxCapsuleBytes: 20 } },
  { name: "bad magic", code: "Malformed", bytes: async () => { const c = await capsuleOf(source()); c[0] = 0; return c; } },
  { name: "version 9", code: "UnsupportedVersion", bytes: async () => { const c = await capsuleOf(source()); c[6] = 9; return c; } },
  { name: "OversizedDecoded", code: "OversizedDecoded", bytes: () => capsuleOf(source()), opts: { maxUpdateBytes: 1 } },
  { name: "ChecksumMismatch", code: "ChecksumMismatch", bytes: async () => { const c = await capsuleOf(source()); c[c.length - 1] = (c[c.length - 1] as number) ^ 1; return c; } },
  { name: "AppIdentityMismatch", code: "AppIdentityMismatch", bytes: () => capsuleOf(source(), "other-app") },
  { name: "DocumentIdentityMismatch", code: "DocumentIdentityMismatch", bytes: () => capsuleOf(replicaWith("other-doc", { incoming: "x" })) },
  { name: "SdkRejection", code: "SdkRejection", bytes: async () => { const g = new Uint8Array([255, 255, 255, 255, 1]); return sealedCapsule(metaOf(g.length), g); } },
];

describe("AC-CAP-008-1 rejected imports do not mutate the target", () => {
  it.each(cases)("replica path: $name", async (c) => {
    const target = replicaWith(DOC, { keep: 1, also: "here" });
    const before = target.getState();
    const bytesBefore = Array.from(target.exportState().bytes);
    const e = await rejection(importCapsuleInto(target, await c.bytes(), { app: APP }, c.opts));
    expect(isCapsuleError(e, c.code)).toBe(true);
    expect(target.getState()).toEqual(before);
    expect(Array.from(target.exportState().bytes)).toEqual(bytesBefore);
  });

  it.each(cases)("persisted path: $name (and flush is never called)", async (c) => {
    const replica = replicaWith(DOC, { keep: 1, also: "here" });
    const before = replica.getState();
    const fake = persistedFake(replica);
    const e = await rejection(importCapsuleIntoPersisted(fake.target, await c.bytes(), c.opts));
    expect(isCapsuleError(e, c.code)).toBe(true);
    expect(replica.getState()).toEqual(before);
    expect(fake.calls.flush).toBe(0);
  });
});
