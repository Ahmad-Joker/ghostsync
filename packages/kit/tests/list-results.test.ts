/**
 * Correction 2 — listResults() exposes invalid/incomplete records during
 * enumeration using the EXISTING GetResult<T> shape, while list() keeps its
 * documented valid-record-only behavior.
 *
 * Invalid records are constructed deterministically the same way the baseline
 * incomplete-record test does: a permissive adapter sharing the SAME
 * (app, entityType) — hence the SAME collection id — writes only a subset of
 * fields, leaving the strict adapter unable to reconstruct a valid T. This is
 * exactly the converged shape a field-level delete-concurrent-with-edit leaves.
 */
import { describe, expect, it } from "vitest";

import { createKit, type EntityAdapter, type GetResult } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-list-results";

interface PartialIncident {
  title?: string | undefined;
}
const partialIncidentAdapter: EntityAdapter<PartialIncident> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "incident" },
  validate() {
    /* any subset is fine for this partial view */
  },
  toFields: (p) => (p.title !== undefined ? { title: p.title } : {}),
  fromFields: (f) => ({ title: f["title"] as string | undefined }),
};

const full = (title: string): Incident => ({
  title,
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

/** Narrowing helpers so the GetResult union is asserted precisely. */
function expectOk<T>(r: GetResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("expected ok result");
  return r.entity;
}
function expectInvalid<T>(r: GetResult<T>): { id: string; fields: Record<string, unknown> } {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected invalid result");
  expect(r.reason).toBe("invalidRecord");
  if (r.reason !== "invalidRecord") throw new Error("expected invalidRecord");
  return { id: r.id, fields: r.fields };
}

describe("Correction 2: listResults enumerates valid AND invalid records", () => {
  it("surfaces both a valid and an incomplete record; list() returns only the valid one", () => {
    const r = createKit().createReplica(DOC);
    try {
      const strict = r.collection(incidentAdapter);
      const partial = r.collection(partialIncidentAdapter);

      // "good" is a complete, valid incident.
      strict.put("good", full("complete"));
      // "bad" is seeded full, then reduced to only { title } via the partial
      // adapter — an incomplete record for the strict schema.
      strict.put("bad", full("seed"));
      partial.put("bad", { title: "only-title" });

      const results = new Map(strict.listResults());
      expect([...results.keys()].sort()).toEqual(["bad", "good"]);

      // Valid record reconstructs via GetResult.ok.
      expect(expectOk(results.get("good") as GetResult<Incident>)).toEqual(full("complete"));

      // Invalid record is surfaced with its preserved fields (NOT repaired,
      // deleted, or fabricated).
      const bad = expectInvalid(results.get("bad") as GetResult<Incident>);
      expect(bad.id).toBe("bad");
      expect(bad.fields).toEqual({ title: "only-title" });

      // list() still returns ONLY the valid record.
      expect(strict.list().map(([id]) => id)).toEqual(["good"]);

      // The invalid record's underlying field was never deleted by enumeration.
      expect(partial.get("bad")).toEqual({ title: "only-title" });
    } finally {
      r.destroy();
    }
  });

  it("listResults exposes invalid records AFTER synchronization (concurrent field deletion)", () => {
    const kit = createKit();
    const a = kit.createReplica(DOC);
    const b = kit.createReplica(DOC);
    try {
      const strictA = a.collection(incidentAdapter);
      const strictB = b.collection(incidentAdapter);
      const partialA = a.collection(partialIncidentAdapter);

      // Both replicas agree on two complete incidents.
      strictA.put("keep", full("keep"));
      strictA.put("wither", full("wither"));
      expect(b.applyUpdate(a.exportState()).ok).toBe(true);

      // Concurrently: A reduces "wither" to only { title } (deletes the other
      // fields) while B edits a DIFFERENT field of the same record. The merge
      // leaves "wither" incomplete for the strict schema on both replicas.
      partialA.put("wither", { title: "withered" });
      strictB.put("wither", { ...full("wither"), severity: "high" });

      expect(b.applyUpdate(a.exportState()).ok).toBe(true);
      expect(a.applyUpdate(b.exportState()).ok).toBe(true);
      expect(b.applyUpdate(a.exportState()).ok).toBe(true);

      // Converged: both replicas agree on the structured projection.
      const resA = new Map(strictA.listResults());
      const resB = new Map(strictB.listResults());
      expect([...resA.keys()].sort()).toEqual(["keep", "wither"]);
      expect([...resB.keys()].sort()).toEqual(["keep", "wither"]);

      // "keep" is valid on both; "wither" is an invalidRecord on both with its
      // surviving fields intact.
      expect(expectOk(resA.get("keep") as GetResult<Incident>).title).toBe("keep");
      expect(expectOk(resB.get("keep") as GetResult<Incident>).title).toBe("keep");

      const witherA = expectInvalid(resA.get("wither") as GetResult<Incident>);
      const witherB = expectInvalid(resB.get("wither") as GetResult<Incident>);
      expect(witherA.fields).toEqual(witherB.fields); // converged invalid fields
      // title survived (last writer among the concurrent title writes); severity
      // survived from B's concurrent different-field write.
      expect(witherA.fields["severity"]).toBe("high");

      // list() on both returns only the valid "keep".
      expect(strictA.list().map(([id]) => id)).toEqual(["keep"]);
      expect(strictB.list().map(([id]) => id)).toEqual(["keep"]);
    } finally {
      a.destroy();
      b.destroy();
    }
  });

  it("listResults on an empty collection is an empty array", () => {
    const r = createKit().createReplica(DOC);
    try {
      expect(r.collection(incidentAdapter).listResults()).toEqual([]);
    } finally {
      r.destroy();
    }
  });
});
