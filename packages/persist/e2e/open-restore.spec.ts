/**
 * REQ-BP-002 — fresh open; seeded open (legacy + structured survive flush+reload);
 * corrupt-record open rejects with a typed error and leaves bytes byte-identical.
 * Real Chromium IndexedDB + SHA-256.
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

test.describe("open / restore (REQ-BP-002)", () => {
  test("legacy + structured edits survive flush and reload", async ({ page, context }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);

    const first = await page.evaluate(async (db: string) => {
      const r = (await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "doc",
        replicaId: "r",
        dbName: db,
      })) as { restored: boolean };
      window.__gs.set("s", "status", "open");
      window.__gs.putIncident("s", "i1", { id: "i1", title: "Leak", priority: 2 });
      await window.__gs.flush("s");
      await window.__gs.close("s");
      return r.restored;
    }, dbName);
    expect(first).toBe(false);

    await reloadHarnessOffline(page, context);

    const restored = await page.evaluate(async (db: string) => {
      const r = (await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "doc",
        replicaId: "r",
        dbName: db,
      })) as { restored: boolean };
      const status = window.__gs.get("s", "status");
      const incident = window.__gs.getIncident("s", "i1");
      await window.__gs.close("s");
      return { restored: r.restored, status, incident };
    }, dbName);

    expect(restored.restored).toBe(true);
    expect(restored.status).toBe("open");
    expect(restored.incident).toEqual({ id: "i1", title: "Leak", priority: 2 });
  });

  test("a corrupt record rejects InvalidRecordError and is preserved byte-identical", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);

    // Save a valid record, read its bytes, then corrupt the checksum in place.
    const before = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "v");
      await window.__gs.flush("s");
      await window.__gs.close("s");
      const key = "a\u001fd\u001fr";
      return { key, hex: await window.__gs.readRecordHex(db, key) };
    }, dbName);

    expect(before.hex).not.toBeNull();

    const check = await page.evaluate(
      async (args: { db: string; key: string; hex: string }) => {
        const bytes = new Uint8Array(args.hex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));
        await window.__gs.plantRecord(args.db, {
          storageKey: args.key,
          version: 1,
          app: "a",
          documentId: "d",
          replicaId: "r",
          bytes,
          sequence: 1,
          checksum: "0".repeat(64),
          savedAt: Date.now(),
        });
        const open = (await window.__gs.open("c", {
          app: "a",
          documentId: "d",
          replicaId: "r",
          dbName: args.db,
        })) as { ok?: boolean; code?: string };
        const after = await window.__gs.readRecordHex(args.db, args.key);
        return { open, after };
      },
      { db: dbName, key: before.key, hex: before.hex as string },
    );

    expect(check.open.ok).toBe(false);
    expect(check.open.code).toBe("InvalidRecordError");
    expect(check.after).toBe(before.hex); // byte-identical, preserved
  });
});
