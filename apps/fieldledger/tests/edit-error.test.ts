import { describe, expect, it } from "vitest";
import { createKit } from "@ghostsync/kit";
import { checklistItemAdapter, incidentAdapter } from "../src/model/adapters.js";
import { readModel } from "../src/model/read-model.js";
import { SessionController } from "../src/session/session-controller.js";
import { mapEditError } from "../src/state/errors.js";

/** The private slots a test must fill to drive guard() without a browser. */
interface Seams {
  phase: string;
  incidents: unknown;
  items: unknown;
  replicaId: string;
}

function controller(throwing: Error | undefined): { c: SessionController; notified: () => number } {
  const r = createKit().createReplica("inc-2026-0042");
  const incidents = r.collection(incidentAdapter);
  const items = r.collection(checklistItemAdapter);
  const wrap = <T extends object>(col: T): T =>
    new Proxy(col, {
      get(target, prop, receiver) {
        if (prop === "put" && throwing !== undefined) {
          return () => {
            throw throwing;
          };
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  let n = 0;
  const c = new SessionController({} as Storage, () => n++, () => undefined);
  const seams = c as unknown as Seams;
  seams.phase = "ready";
  seams.replicaId = "replica-1";
  seams.incidents = wrap(incidents);
  seams.items = wrap(items);
  c.model = readModel(incidents, items);
  return { c, notified: () => n };
}

describe("edit error mapping", () => {
  it("schema mismatch copy names the cause and the reload action; unexpected says the edit was not applied", () => {
    const s = mapEditError("schema-mismatch");
    expect(s.kind).toBe("schema-mismatch");
    expect(s.message).toContain("newer schema");
    expect(s.message).toContain("Reload the app");
    const u = mapEditError("unexpected");
    expect(u.kind).toBe("unexpected");
    expect(u.message).toContain("was not made");
    expect(u.message).toContain("try the edit again");
    for (const m of [s, u]) {
      expect(m.title).toContain("NOT applied");
      expect(`${m.title} ${m.message}`).not.toMatch(/saved locally|capsule applied/i);
    }
  });
});

describe("SessionController.guard edit errors", () => {
  it("an unexpected throw sets editError, keeps phase ready and save state, and does not set errorMessage", () => {
    const { c } = controller(new TypeError("text must be 1 to 200 characters"));
    const saveBefore = c.save;
    c.addChecklistItem("Close inlet");
    expect(c.editError?.kind).toBe("unexpected");
    expect(c.phase).toBe("ready");
    expect(c.save).toBe(saveBefore);
    expect(c.save.state).toBe("saved");
    expect(c.errorMessage).toBe("");
    expect(c.importView).toBeUndefined();
  });

  it("a Kit-style schema-mismatch error message maps to the schema-mismatch kind", () => {
    const { c } = controller(new Error("GhostSync Kit: schema mismatch for collection fieldledger/incident: stored x != adapter y"));
    c.createIncidentDetails("Spill");
    expect(c.editError?.kind).toBe("schema-mismatch");
    expect(c.phase).toBe("ready");
  });

  it("edit AND listResults both reject with a schema mismatch: alert state set, last good model kept, no re-read, no throw", () => {
    const mismatch = (): Error => new Error("GhostSync Kit: schema mismatch for collection fieldledger/checklistItem: stored x != adapter y");
    const r = createKit().createReplica("inc-2026-0042");
    const incidents = r.collection(incidentAdapter);
    const items = r.collection(checklistItemAdapter);
    incidents.put("incident", { title: "Pump leak", location: "", severity: "low", status: "open", notes: "" });
    items.put("ci-1", { text: "Close inlet", done: false, sortKey: 1024, createdBy: "t", createdAt: 1 });
    let broken = false;
    let listCallsWhileBroken = 0;
    const wrap = <T extends object>(col: T): T =>
      new Proxy(col, {
        get(target, prop, receiver) {
          // The real Kit re-checks the schema on EVERY collection operation, so all of them throw once broken.
          if (broken && prop === "listResults") return () => { listCallsWhileBroken++; throw mismatch(); };
          if (broken && typeof prop === "string" && ["put", "get", "getResult", "list", "has", "delete"].includes(prop)) return () => { throw mismatch(); };
          const v = Reflect.get(target, prop, receiver) as unknown;
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    let n = 0;
    const c = new SessionController({} as Storage, () => n++, () => undefined);
    const seams = c as unknown as Seams;
    seams.phase = "ready";
    seams.replicaId = "replica-1";
    seams.incidents = wrap(incidents);
    seams.items = wrap(items);
    c.model = readModel(wrap(incidents), wrap(items));
    const lastGood = c.model;
    const saveBefore = c.save;
    expect(lastGood.items.map(([, i]) => i.text)).toEqual(["Close inlet"]);

    broken = true;
    // createIncident only puts, so any listResults() call during it would be guard() re-reading.
    expect(() => c.createIncidentDetails("Spill")).not.toThrow();
    expect(listCallsWhileBroken).toBe(0);
    expect(() => c.setItemField("ci-1", "text", "Close outlet")).not.toThrow();
    expect(() => c.addChecklistItem("More")).not.toThrow();

    expect(c.phase).toBe("ready");
    expect(c.editError?.kind).toBe("schema-mismatch");
    expect(c.model).toBe(lastGood);
    expect(c.model?.incident.kind).toBe("ok");
    expect(c.model?.items.map(([, i]) => i.text)).toEqual(["Close inlet"]);
    expect(c.save).toBe(saveBefore);
    expect(c.errorMessage).toBe("");

    // A later refresh (for example a remote change) that throws keeps the last good model and the phase.
    const callsBefore = listCallsWhileBroken;
    expect(c.refresh()).toBe(false);
    expect(listCallsWhileBroken).toBeGreaterThan(callsBefore);
    expect(c.phase).toBe("ready");
    expect(c.model).toBe(lastGood);
  });

  it("dismiss clears the error and notifies", () => {
    const { c, notified } = controller(new TypeError("boom"));
    c.addChecklistItem("x");
    const before = notified();
    c.dismissEditError();
    expect(c.editError).toBeUndefined();
    expect(notified()).toBeGreaterThan(before);
  });

  it("a later successful edit clears the error", () => {
    const { c } = controller(new TypeError("boom"));
    c.addChecklistItem("x");
    expect(c.editError).toBeDefined();
    const { c: ok } = controller(undefined);
    ok.editError = c.editError;
    ok.addChecklistItem("Close inlet");
    expect(ok.editError).toBeUndefined();
    expect(ok.model?.items.map(([, i]) => i.text)).toEqual(["Close inlet"]);
  });
});
