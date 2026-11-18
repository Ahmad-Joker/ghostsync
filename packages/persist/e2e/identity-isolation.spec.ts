/**
 * REQ-BP-001 — same documentId, different replicaId stay isolated; reload
 * restores only each replica's own data. Real Chromium IndexedDB.
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

test.describe("identity isolation (REQ-BP-001)", () => {
  test("same document, different replicaIds persist and restore independently", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);

    const keyA = await page.evaluate(async (db: string) => {
      const r = (await window.__gs.open("A", {
        app: "app",
        documentId: "doc",
        replicaId: "rA",
        dbName: db,
      })) as { storageKey: string };
      window.__gs.set("A", "who", "A");
      await window.__gs.flush("A");
      await window.__gs.close("A");
      return r.storageKey;
    }, dbName);

    const keyB = await page.evaluate(async (db: string) => {
      const r = (await window.__gs.open("B", {
        app: "app",
        documentId: "doc",
        replicaId: "rB",
        dbName: db,
      })) as { storageKey: string };
      window.__gs.set("B", "who", "B");
      await window.__gs.flush("B");
      await window.__gs.close("B");
      return r.storageKey;
    }, dbName);

    expect(keyA).not.toBe(keyB);

    await reloadHarnessOffline(page, context);

    const values = await page.evaluate(async (db: string) => {
      await window.__gs.open("A", { app: "app", documentId: "doc", replicaId: "rA", dbName: db });
      await window.__gs.open("B", { app: "app", documentId: "doc", replicaId: "rB", dbName: db });
      const a = window.__gs.get("A", "who");
      const b = window.__gs.get("B", "who");
      await window.__gs.close("A");
      await window.__gs.close("B");
      return { a, b };
    }, dbName);

    expect(values).toEqual({ a: "A", b: "B" });
  });
});
