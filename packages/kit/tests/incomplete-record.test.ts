import { describe, expect, it } from "vitest";

import { createKit, IncompleteRecordError, type EntityAdapter } from "../src/index.js";
import { incidentAdapter, type Incident } from "./fixtures/adapters.js";

const DOC = "doc-incomplete-record";

/** Permissive adapter sharing the incident collection id (same app/entityType). */
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

const full = (): Incident => ({
  title: "t",
  severity: "low",
  reportedAt: 1,
  resolved: false,
  notes: null,
});

describe("REQ-SDK-001/007 incomplete-record controlled error (clarification 4)", () => {
  it("an incomplete record (e.g. from a field deleted concurrently with an edit) is a controlled outcome", () => {
    // Deterministically construct the incomplete state: a permissive adapter
    // (SAME app/entityType, so SAME collection id) writes only `title`; the
    // strict incident adapter then reads the under-populated record. This is
    // exactly the converged shape a field-level delete-concurrent-with-edit can
    // leave (one surviving field), reproduced deterministically.
    const r = createKit().createReplica(DOC);
    const strict = r.collection(incidentAdapter);
    // Seed a full record, then simulate a concurrent field deletion by deleting
    // all but `title` directly through a partial adapter view.
    strict.put("E", full());

    const partial = r.collection(partialIncidentAdapter);
    // Overwrite with only { title } — put deletes the omitted fields, leaving an
    // incomplete incident (missing severity/reportedAt/resolved/notes).
    partial.put("E", { title: "edited" });

    const res = strict.getResult("E");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("invalidRecord");
    if (res.reason !== "invalidRecord") throw new Error("unreachable");
    expect(res.fields["title"]).toBe("edited");

    // get() throws the controlled IncompleteRecordError (does not corrupt state).
    expect(() => strict.get("E")).toThrow(IncompleteRecordError);

    // The underlying field is PRESERVED (a failed read never deletes it).
    expect(partial.get("E")).toEqual({ title: "edited" });

    // list() skips the invalid record rather than throwing.
    expect(strict.list().some(([id]) => id === "E")).toBe(false);
    r.destroy();
  });

  it("a complete record reads normally", () => {
    const r = createKit().createReplica(DOC);
    const col = r.collection(incidentAdapter);
    col.put("E", full());
    expect(col.getResult("E")).toEqual({ ok: true, entity: full() });
    expect(col.getResult("absent")).toEqual({ ok: false, reason: "absent" });
    r.destroy();
  });
});
