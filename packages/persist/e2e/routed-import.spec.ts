/**
 * REQ-BP-004 — a dependent (out-of-order) update returns ok with NO notification
 * yet still dirties the session and survives flush+reload; later delivering the
 * prerequisite integrates it. A rejected import leaves the record unchanged.
 * Real Chromium IndexedDB.
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

test.describe("routed import (REQ-BP-004)", () => {
  test("pending update survives save/reload and integrates when prerequisite arrives", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);

    const built = await page.evaluate(() => window.__gs.buildChained("doc"));

    const afterPending = await page.evaluate(
      async (args: { db: string; second: string }) => {
        await window.__gs.open("s", {
          app: "a",
          documentId: "doc",
          replicaId: "r",
          dbName: args.db,
        });
        const outcome = window.__gs.applyUpdate("s", "doc", args.second, "diff") as { ok: boolean };
        const state = window.__gs.state("s");
        const hasB = window.__gs.get("s", "b");
        await window.__gs.flush("s");
        await window.__gs.close("s");
        return { outcome, state, hasB };
      },
      { db: dbName, second: built.second },
    );

    expect(afterPending.outcome.ok).toBe(true);
    expect(afterPending.hasB).toBeUndefined();
    expect(["dirty", "saving", "saved"]).toContain(afterPending.state);

    await reloadHarnessOffline(page, context);

    const integrated = await page.evaluate(
      async (args: { db: string; first: string }) => {
        await window.__gs.open("s", {
          app: "a",
          documentId: "doc",
          replicaId: "r",
          dbName: args.db,
        });
        const bBefore = window.__gs.get("s", "b");
        window.__gs.applyUpdate("s", "doc", args.first, "full");
        const a = window.__gs.get("s", "a");
        const bAfter = window.__gs.get("s", "b");
        await window.__gs.close("s");
        return { bBefore, a, bAfter };
      },
      { db: dbName, first: built.first },
    );

    expect(integrated.bBefore).toBeUndefined();
    expect(integrated.a).toBe(1);
    expect(integrated.bAfter).toBe(2);
  });

  test("a rejected import does not dirty or write", async ({ page, context }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "doc", dbName: db });
      await window.__gs.flush("s");
      const before = window.__gs.state("s");
      const outcome = window.__gs.applyUpdate("s", "WRONG", "0102", "full") as { ok: boolean };
      const after = window.__gs.state("s");
      await window.__gs.close("s");
      return { outcome, before, after };
    }, dbName);
    expect(out.outcome.ok).toBe(false);
    expect(out.after).toBe(out.before);
  });
});
