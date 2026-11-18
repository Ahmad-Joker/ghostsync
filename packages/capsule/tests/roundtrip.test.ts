import { describe, expect, it } from "vitest";

import {
  CAPSULE_EXTENSION,
  CAPSULE_MEDIA_TYPE,
  decodeCapsule,
  encodeCapsule,
  importCapsuleInto,
} from "../src/index.js";
import { APP, DOC, capsuleOf, incidentAdapter, replicaWith } from "./helpers.js";

describe("AC-CAP-001 round trips", () => {
  it("scalar data round-trips through encode, decode and import", async () => {
    const a = replicaWith(DOC, { title: "Spill", level: 3, open: true, note: null });
    const cap = await capsuleOf(a);
    const decoded = await decodeCapsule(cap);
    expect(decoded.metadata).toMatchObject({ formatVersion: 1, app: APP, documentId: DOC });
    expect(decoded.metadata.updateByteLength).toBe(decoded.update.length);
    expect(Array.from(decoded.update)).toEqual(Array.from(a.exportState().bytes));

    const b = replicaWith(DOC);
    const result = await importCapsuleInto(b, cap, { app: APP });
    expect(result.applied).toBe(true);
    expect("ok" in result).toBe(false);
    expect(b.getState()).toEqual(a.getState());
  });

  it("structured collection data round-trips", async () => {
    const a = replicaWith(DOC);
    a.collection(incidentAdapter).put("i1", { title: "Leak", priority: 2 });
    a.collection(incidentAdapter).put("i2", { title: "Fire", priority: 1 });
    const cap = await capsuleOf(a);

    const b = replicaWith(DOC);
    await importCapsuleInto(b, cap, { app: APP });
    expect(b.collection(incidentAdapter).get("i1")).toEqual({ title: "Leak", priority: 2 });
    expect(b.collection(incidentAdapter).get("i2")).toEqual({ title: "Fire", priority: 1 });
    expect(b.getState()).toEqual(a.getState());
  });

  it("file identity constants", () => {
    expect(CAPSULE_EXTENSION).toBe(".gscap");
    expect(CAPSULE_MEDIA_TYPE).toBe("application/vnd.ghostsync.capsule");
  });

  it("createdAt defaults to canonical ISO-8601 UTC and an explicit value is preserved", async () => {
    const a = replicaWith(DOC, { k: 1 });
    const def = await decodeCapsule(await capsuleOf(a));
    expect(new Date(def.metadata.createdAt).toISOString()).toBe(def.metadata.createdAt);
    const explicit = await decodeCapsule(
      await encodeCapsule({ app: APP, documentId: DOC, update: a.exportState().bytes, createdAt: "2020-02-03T04:05:06.007Z" }),
    );
    expect(explicit.metadata.createdAt).toBe("2020-02-03T04:05:06.007Z");
  });
});
