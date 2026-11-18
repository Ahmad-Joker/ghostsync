/**
 * Correction 1 — schema compatibility is enforced BEFORE every public
 * Collection operation (put/get/getResult/list/listResults/delete/has), not
 * only put().
 *
 * The scenario is DETERMINISTIC: a v2 schema-meta value is written as a CAUSAL
 * SUCCESSOR of the v1 value (a raw source doc is seeded from the v1 replica's
 * full state, then overwrites the meta key, so the v2 write happens-after v1).
 * Delivered back to the original replica, the meta resolves to v2 with no
 * concurrent LWW coin-flip. Every operation on the still-held v1 handle must
 * then reject with the documented schema-mismatch error, while a freshly-opened
 * v2 handle works.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Doc as YDoc } from "yjs";

import { createKit, type EntityAdapter } from "../src/index.js";
import { collectionId, metaKey } from "../src/keys.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-schema-recheck-all-ops";

/** Same (app, entityType) as the incident adapter, but schemaVersion 2. */
const incidentAdapterV2: EntityAdapter<Incident> = {
  ...incidentAdapter,
  schema: { app: "fieldledger", schemaVersion: 2, entityType: "incident" },
};

const META_KEY = metaKey(collectionId("fieldledger", "incident"));

const sample = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 0,
  resolved: false,
  notes: null,
});

/**
 * Produce an update that overwrites the incident collection's schema-meta key
 * with `value`, as a CAUSAL SUCCESSOR of `baseBytes` (seed a raw doc from the
 * base state, then set the key — a happens-after overwrite, not a concurrent
 * write). Returns the full-state bytes of the mutated raw doc.
 */
function metaSuccessorBytes(baseBytes: Uint8Array, value: string): Uint8Array {
  const src = new YDoc();
  try {
    Y.applyUpdate(src, baseBytes);
    const rec = src.getMap<unknown>("ghostsync:records:v1");
    src.transact(() => rec.set(META_KEY, value));
    return Y.encodeStateAsUpdate(src);
  } finally {
    src.destroy();
  }
}

describe("Correction 1: schema recheck on EVERY collection operation", () => {
  it("a causally-newer v2 meta makes the held v1 handle reject every operation", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    try {
      // v1 handle, held across the incoming meta change.
      const v1 = a.collection(incidentAdapter);
      v1.put("E", sample("v1"));

      // Build a v2 meta value that CAUSALLY FOLLOWS v1, then deliver it.
      const v2Bytes = metaSuccessorBytes(
        a.exportState().bytes,
        JSON.stringify(incidentAdapterV2.schema),
      );
      expect(a.applyUpdate({ documentId: DOC, kind: "full", bytes: v2Bytes }).ok).toBe(true);

      // EVERY operation on the existing v1 handle rejects with schema mismatch.
      expect(() => v1.put("F", sample("x"))).toThrow(/schema mismatch/);
      expect(() => v1.get("E")).toThrow(/schema mismatch/);
      expect(() => v1.getResult("E")).toThrow(/schema mismatch/);
      expect(() => v1.list()).toThrow(/schema mismatch/);
      expect(() => v1.listResults()).toThrow(/schema mismatch/);
      expect(() => v1.has("E")).toThrow(/schema mismatch/);
      expect(() => v1.delete("E")).toThrow(/schema mismatch/);

      // A freshly-opened COMPATIBLE v2 handle works and sees the record.
      const v2 = a.collection(incidentAdapterV2);
      expect(v2.get("E")).toEqual(sample("v1"));
      expect(v2.list().map(([id]) => id)).toEqual(["E"]);
      expect(v2.has("E")).toBe(true);
      expect(v2.listResults().map(([id]) => id)).toEqual(["E"]);
    } finally {
      a.destroy();
    }
  });

  it("delete through an incompatible handle neither mutates nor notifies", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    try {
      const v1 = a.collection(incidentAdapter);
      v1.put("E", sample("keep"));

      const v2Bytes = metaSuccessorBytes(
        a.exportState().bytes,
        JSON.stringify(incidentAdapterV2.schema),
      );
      expect(a.applyUpdate({ documentId: DOC, kind: "full", bytes: v2Bytes }).ok).toBe(true);

      // Capture committed state via a compatible handle before the bad delete.
      const v2 = a.collection(incidentAdapterV2);
      const before = v2.get("E");
      expect(before).toEqual(sample("keep"));

      let notifications = 0;
      const unsub = a.subscribe(() => notifications++);

      // Delete through the incompatible v1 handle must throw and change nothing.
      expect(() => v1.delete("E")).toThrow(/schema mismatch/);
      expect(notifications).toBe(0);
      expect(v2.get("E")).toEqual(before); // record untouched
      unsub();
    } finally {
      a.destroy();
    }
  });

  it("a corrupt persisted meta value yields a controlled schema error, not a crash", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    try {
      const v1 = a.collection(incidentAdapter);
      v1.put("E", sample("v1"));

      // Overwrite the meta key with a parseable-but-malformed value (JSON null),
      // delivered as a causal successor of the valid v1 meta.
      const corruptBytes = metaSuccessorBytes(a.exportState().bytes, "null");
      expect(a.applyUpdate({ documentId: DOC, kind: "full", bytes: corruptBytes }).ok).toBe(true);

      // Reads/enumeration/mutation all surface a controlled schema error, never
      // a TypeError from comparing against a null meta.
      expect(() => v1.get("E")).toThrow(/schema mismatch/);
      expect(() => v1.list()).toThrow(/schema mismatch/);
      expect(() => v1.listResults()).toThrow(/schema mismatch/);
      expect(() => v1.has("E")).toThrow(/schema mismatch/);
      expect(() => v1.delete("E")).toThrow(/schema mismatch/);
      expect(() => v1.put("F", sample("x"))).toThrow(/schema mismatch/);
    } finally {
      a.destroy();
    }
  });

  it("a non-string (corrupt) meta value yields a controlled schema error", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const src = new YDoc();
    try {
      const v1 = a.collection(incidentAdapter);
      v1.put("E", sample("v1"));

      // Seed a raw doc from v1 state, then overwrite meta with a NUMBER value
      // (not a JSON string) as a causal successor — exercises the typeof guard.
      Y.applyUpdate(src, a.exportState().bytes);
      const rec = src.getMap<unknown>("ghostsync:records:v1");
      src.transact(() => rec.set(META_KEY, 42));
      const bytes = Y.encodeStateAsUpdate(src);
      expect(a.applyUpdate({ documentId: DOC, kind: "full", bytes }).ok).toBe(true);

      expect(() => v1.get("E")).toThrow(/schema mismatch/);
      expect(() => v1.has("E")).toThrow(/schema mismatch/);
    } finally {
      src.destroy();
      a.destroy();
    }
  });
});
