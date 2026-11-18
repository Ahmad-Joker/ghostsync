/**
 * REQ-BP-005 — same-key contention via TWO PAGES in the SAME browser context +
 * origin (truly shared IndexedDB + Web Locks). A second same-key open rejects
 * with StorageInUseError (zero writes); a retry after the owner closes sees the
 * LATEST committed data; separate replicaIds both open; dispose releases
 * ownership. Real Chromium navigator.locks.
 *
 * NOTE: two pages in the SAME context share storage + locks (contention). Two
 * separate contexts would be an ISOLATION test, not contention — this suite
 * deliberately uses one context with two pages.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { uniqueDbName } from "./helpers.js";

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
}

test.describe("same-key contention (REQ-BP-005)", () => {
  test("second same-key session rejects StorageInUseError; retry sees latest", async ({
    context,
  }) => {
    const dbName = uniqueDbName();
    const owner = await context.newPage();
    const rival = await context.newPage();
    await ready(owner);
    await ready(rival);
    await context.setOffline(true);

    const ownerKey = await owner.evaluate(async (db: string) => {
      const r = (await window.__gs.open("o", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok: boolean; storageKey: string };
      window.__gs.set("o", "x", 42);
      await window.__gs.flush("o");
      return r.storageKey;
    }, dbName);
    expect(ownerKey).toBeTruthy();

    const contended = await rival.evaluate(async (db: string) => {
      return (await window.__gs.open("rv", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok?: boolean; code?: string };
    }, dbName);
    expect(contended.ok).toBe(false);
    expect(contended.code).toBe("StorageInUseError");

    await owner.evaluate(async () => {
      await window.__gs.close("o");
    });
    const retried = await rival.evaluate(async (db: string) => {
      await window.__gs.open("rv2", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      const x = window.__gs.get("rv2", "x");
      await window.__gs.close("rv2");
      return x;
    }, dbName);
    expect(retried).toBe(42);
  });

  test("separate replicaIds open concurrently in the same context", async ({ context }) => {
    const dbName = uniqueDbName();
    const p1 = await context.newPage();
    const p2 = await context.newPage();
    await ready(p1);
    await ready(p2);
    await context.setOffline(true);

    const a = await p1.evaluate(
      async (db: string) =>
        (await window.__gs.open("a", { app: "a", documentId: "d", replicaId: "rA", dbName: db })) as {
          ok: boolean;
        },
      dbName,
    );
    const b = await p2.evaluate(
      async (db: string) =>
        (await window.__gs.open("b", { app: "a", documentId: "d", replicaId: "rB", dbName: db })) as {
          ok: boolean;
        },
      dbName,
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  test("dispose releases ownership so a new session can open the same key", async ({ context }) => {
    const dbName = uniqueDbName();
    const page = await context.newPage();
    await ready(page);
    await context.setOffline(true);
    const result = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "unsaved", 1);
      await window.__gs.dispose("s");
      const reopen = (await window.__gs.open("s2", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok: boolean };
      await window.__gs.close("s2");
      return reopen;
    }, dbName);
    expect(result.ok).toBe(true);
  });
});
