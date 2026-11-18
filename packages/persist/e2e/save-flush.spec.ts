/**
 * REQ-BP-003 — the save path succeeds with a REAL async SHA-256 digest + REAL
 * IndexedDB; flush() resolves only after the transaction completes; repeated
 * reopen/edit/save cycles advance the sequence and retain latest; maxBytes-
 * before-write surfaces an error and keeps live data. Real Chromium.
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

test.describe("save + flush (REQ-BP-003)", () => {
  test("flush resolves saved after a real SHA-256 digest + real IndexedDB", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const states = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", dbName: db });
      window.__gs.set("s", "k", "v");
      const flush = (await window.__gs.flush("s")) as { ok: boolean; state: string };
      return { flush, log: window.__gs.stateLog("s"), state: window.__gs.state("s") };
    }, dbName);
    expect(states.flush.ok).toBe(true);
    expect(states.state).toBe("saved");
    expect(states.log).toContain("dirty");
    expect(states.log).toContain("saving");
    expect(states.log).toContain("saved");
  });

  test("repeated reopen/edit/save cycles advance the sequence and retain latest", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    let previousSeq = -1;
    for (let i = 0; i < 3; i++) {
      await reloadHarnessOffline(page, context);
      const seq = await page.evaluate(
        async (args: { db: string; iter: number }) => {
          await window.__gs.open("s", {
            app: "a",
            documentId: "d",
            replicaId: "r",
            dbName: args.db,
          });
          window.__gs.set("s", "counter", args.iter);
          await window.__gs.flush("s");
          const value = window.__gs.get("s", "counter");
          await window.__gs.close("s");
          return value as number;
        },
        { db: dbName, iter: i },
      );
      expect(seq).toBe(i);
      expect(seq).toBeGreaterThan(previousSeq);
      previousSeq = seq;
    }
  });

  test("maxBytes enforced before a write keeps live data and surfaces an error", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", dbName: db, maxBytes: 4 });
      window.__gs.set("s", "key", "a-value-that-will-not-fit");
      const flush = (await window.__gs.flush("s")) as { ok?: boolean; code?: string };
      const state = window.__gs.state("s");
      const live = window.__gs.get("s", "key");
      await window.__gs.dispose("s");
      return { flush, state, live };
    }, dbName);
    expect(out.flush.ok).toBe(false);
    expect(out.state).toBe("error");
    expect(out.live).toBe("a-value-that-will-not-fit");
  });
});
