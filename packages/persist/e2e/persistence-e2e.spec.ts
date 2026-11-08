/**
 * REQ-BP-007 — the reload-survival matrix in real Chromium with real IndexedDB:
 *  (a) legacy + structured edits survive reload after flush;
 *  (c) a restored replica still converges through SDK updates;
 *  (e) accepted remote imports persist;
 *  (h) invalid records remain discoverable via listResults() after reload.
 * (b) isolation and (d) pending-dependent survival are covered in
 * identity-isolation / routed-import; (f) save-failure and (g) concurrency in
 * errors-lifecycle / concurrent-same-key.
 *
 * Offline discipline is explicit: load with networking ON, then OFF for
 * edit/import/flush; re-enable ONLY to (re)load uncached assets on reload. This
 * proves persistence + editing in an already-loaded page with networking
 * disabled — NOT cold offline loading.
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

test.describe("persistence survival matrix (REQ-BP-007)", () => {
  test("legacy + structured survive; remote import persists; converges after restore", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);

    const built = await page.evaluate(() => window.__gs.buildChained("incident-7"));

    await page.evaluate(
      async (args: { db: string; first: string }) => {
        await window.__gs.open("s", {
          app: "fieldledger",
          documentId: "incident-7",
          replicaId: "r",
          dbName: args.db,
        });
        window.__gs.set("s", "status", "triage");
        window.__gs.putIncident("s", "i1", { id: "i1", title: "Spill", priority: 1 });
        window.__gs.applyUpdate("s", "incident-7", args.first, "full");
        await window.__gs.flush("s");
        await window.__gs.close("s");
      },
      { db: dbName, first: built.first },
    );

    await reloadHarnessOffline(page, context);

    const restored = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "incident-7",
        replicaId: "r",
        dbName: db,
      });
      const status = window.__gs.get("s", "status");
      const incident = window.__gs.getIncident("s", "i1");
      const remoteKey = window.__gs.get("s", "a");
      const extra = window.__gs.buildChained("incident-7");
      window.__gs.applyUpdate("s", "incident-7", extra.first, "full");
      const convergedA = window.__gs.get("s", "a");
      await window.__gs.close("s");
      return { status, incident, remoteKey, convergedA };
    }, dbName);

    expect(restored.status).toBe("triage");
    expect(restored.incident).toEqual({ id: "i1", title: "Spill", priority: 1 });
    expect(restored.remoteKey).toBe(1);
    expect(restored.convergedA).toBe(1);
  });

  test("invalid records remain discoverable via listResults() after reload", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);

    await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "doc",
        replicaId: "r",
        dbName: db,
      });
      window.__gs.putIncident("s", "valid", { id: "valid", title: "OK", priority: 3 });
      window.__gs.putPartialIncident("s", "broken", "No priority");
      await window.__gs.flush("s");
      await window.__gs.close("s");
    }, dbName);

    await reloadHarnessOffline(page, context);

    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "doc",
        replicaId: "r",
        dbName: db,
      });
      const valid = window.__gs.listIncidentIds("s");
      const invalid = window.__gs.listInvalidIncidentIds("s");
      await window.__gs.close("s");
      return { valid, invalid };
    }, dbName);

    expect(out.valid).toEqual(["valid"]);
    expect(out.invalid).toEqual(["broken"]);
  });
});
