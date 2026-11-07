import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Doc as YDoc } from "yjs";

import { createKit, type EntityAdapter } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-schema-identity";

/** Read the converged schema meta value for the incident collection. */
function readMeta(r: ReturnType<ReturnType<typeof createKit>["createReplica"]>): string {
  const doc = new YDoc();
  Y.applyUpdate(doc, r.exportState().bytes);
  const rec = doc.getMap<unknown>("ghostsync:records:v1");
  let value: string | undefined;
  for (const [k, v] of rec.entries()) {
    // meta key = SENTINEL + "m" + SEP + esc(collection)
    if (k.startsWith("\u0001m\u001f")) {
      value = v as string;
    }
  }
  doc.destroy();
  if (value === undefined) throw new Error("no meta key found");
  return value;
}

/** An adapter for the same (app, entityType) but a DIFFERENT schemaVersion. */
const incidentAdapterV2: EntityAdapter<Incident> = {
  ...incidentAdapter,
  schema: { app: "fieldledger", schemaVersion: 2, entityType: "incident" },
};

describe("REQ-SDK-003 schema identity travels + recheck (AC-SDK-003-2, AC-SDK-007-2)", () => {
  it("schema identity survives export/restore; incompatible adapter rejected after restore", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    a.collection(incidentAdapter).put("E", {
      title: "t",
      severity: "low",
      reportedAt: 0,
      resolved: false,
      notes: null,
    });
    const saved = a.exportState();
    a.destroy();

    // Restore into a fresh replica; the recorded identity came with the bytes.
    const b = kit.createReplica(saved.documentId, saved.bytes);
    expect(() => b.collection(incidentAdapter)).not.toThrow();
    expect(() => b.collection(incidentAdapterV2)).toThrow(/schema mismatch/);
    b.destroy();
  });

  it("schema identity re-derivable on remote import; mismatch rejected, state unmutated", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    a.collection(incidentAdapter).put("E", {
      title: "t",
      severity: "low",
      reportedAt: 0,
      resolved: false,
      notes: null,
    });

    const b = kit.createReplica(DOC);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    // Opening with an incompatible version after import is rejected.
    expect(() => b.collection(incidentAdapterV2)).toThrow(/schema mismatch/);
    // The import itself remains intact (compatible adapter still opens + reads).
    expect(b.collection(incidentAdapter).get("E")?.title).toBe("t");
    a.destroy();
    b.destroy();
  });

  it("clarification 5: a schema-version conflict arriving AFTER a handle exists is caught", () => {
    const kit = createKit();
    // b opens the collection at v1 FIRST and holds a handle (meta key = v1).
    const b = kit.createReplica(DOC);
    const handleB = b.collection(incidentAdapter);
    handleB.put("E", { title: "v1", severity: "low", reportedAt: 0, resolved: false, notes: null });

    // A peer independently opened the SAME collection at v2 and wrote its own
    // meta value, then an import delivers that conflicting meta.
    const a = kit.createReplica(DOC);
    a.collection(incidentAdapterV2).put("F", {
      title: "v2",
      severity: "high",
      reportedAt: 1,
      resolved: false,
      notes: null,
    });
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);
    // Also apply b's own state back into a so the single meta key resolves to
    // ONE value on both by LWW.
    expect(a.applyUpdate(b.exportState()).ok).toBe(true);
    expect(b.applyUpdate(a.exportState()).ok).toBe(true);

    // After convergence the meta is exactly one of {v1, v2}, identical on both.
    // Read the converged meta deterministically, then assert the EXISTING v1
    // handle rechecks and behaves correctly (never a silent mix).
    const metaV1 = JSON.stringify(incidentAdapter.schema);
    const converged = readMeta(b);
    expect([metaV1, JSON.stringify(incidentAdapterV2.schema)]).toContain(converged);

    const put = (): void =>
      handleB.put("G", { title: "x", severity: "low", reportedAt: 0, resolved: false, notes: null });
    if (converged === metaV1) {
      // meta is v1: the v1 handle continues to work; a v2 open is rejected.
      expect(put).not.toThrow();
      expect(() => a.collection(incidentAdapterV2)).toThrow(/schema mismatch/);
    } else {
      // meta became v2: the v1 handle now rejects on its next op — no silent mix.
      expect(put).toThrow(/schema mismatch/);
    }
    a.destroy();
    b.destroy();
  });
});
