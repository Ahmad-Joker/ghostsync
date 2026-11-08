/**
 * REQ-BP-005/006 — a visible save failure keeps live data (error state), a
 * FAILED close preserves exportBytes() and blocks every mutation route
 * (recovery-only), and a subsequent dispose releases ownership. The forced
 * failure uses a real pre-write maxBytes violation in Chromium (an honest,
 * observable save error) rather than a fabricated abort. Real Chromium.
 */
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

test.describe("errors + lifecycle (REQ-BP-006, REQ-BP-005)", () => {
  test("a transient save failure recovers on a SAME-SESSION retry (real aborted txn)", async ({
    page,
    context,
  }) => {
    // CORRECTED (fix 1): this used to dispose the failed session and open a NEW
    // one, which never proved the ORIGINAL session could retry. Now a single
    // session suffers a REAL mid-transaction IndexedDB abort (not a pre-write
    // maxBytes rejection), observes the error, then retries WITHOUT reopening and
    // reaches "saved" — the current bytes reach disk and survive a reload.
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "survives-the-abort");

      // Arm a one-shot real transaction abort, then flush → the write aborts.
      window.__gs.armWriteAbortOnce();
      const failed = (await window.__gs.flush("s")) as { ok?: boolean; code?: string };
      const stateAfterFail = window.__gs.state("s");
      const liveAfterFail = window.__gs.get("s", "k");

      // Retry on the SAME session (no reopen). The abort is disarmed → success.
      const retried = (await window.__gs.flush("s")) as { ok: boolean; state: string };
      const liveAfterRetry = window.__gs.get("s", "k");
      await window.__gs.close("s");
      return { failed, stateAfterFail, liveAfterFail, retried, liveAfterRetry };
    }, dbName);
    expect(out.failed.ok).toBe(false);
    expect(out.failed.code).toBe("TransactionAbortError");
    expect(out.stateAfterFail).toBe("error");
    expect(out.liveAfterFail).toBe("survives-the-abort");
    expect(out.retried.ok).toBe(true);
    expect(out.retried.state).toBe("saved");
    expect(out.liveAfterRetry).toBe("survives-the-abort");

    // The retried bytes are durable: a reload restores them.
    await reloadHarnessOffline(page, context);
    const restored = await page.evaluate(async (db: string) => {
      await window.__gs.open("s2", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      const v = window.__gs.get("s2", "k");
      await window.__gs.close("s2");
      return v;
    }, dbName);
    expect(restored).toBe("survives-the-abort");
  });

  test("repeated oversized flush rejects both times with no stranded waiter", async ({
    page,
    context,
  }) => {
    // fix 1: a save that fails SYNCHRONOUSLY (pre-write maxBytes) before its first
    // await must still settle every flush() — the second flush must not hang.
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
        maxBytes: 4,
      });
      window.__gs.set("s", "k", "an-oversized-value-that-cannot-fit");
      const first = (await window.__gs.flush("s")) as { ok?: boolean; code?: string };
      // Let the save routine fully settle, then flush AGAIN — must not hang.
      await new Promise((r) => setTimeout(r, 0));
      const second = (await window.__gs.flush("s")) as { ok?: boolean; code?: string };
      const live = window.__gs.get("s", "k");
      await window.__gs.dispose("s");
      return { first, second, live };
    }, dbName);
    expect(out.first.ok).toBe(false);
    expect(out.first.code).toBe("QuotaExceededError");
    expect(out.second.ok).toBe(false);
    expect(out.second.code).toBe("QuotaExceededError");
    expect(out.live).toBe("an-oversized-value-that-cannot-fit");
  });

  test("a failed close() preserves exportBytes() and blocks every mutation route", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
        maxBytes: 4,
      });
      window.__gs.set("s", "k", "unsaveable-oversized-value");
      const closed = (await window.__gs.close("s")) as { ok?: boolean; code?: string };

      const exported = window.__gs.exportHex("s");
      const exportOk = typeof exported === "string" && exported.length > 0;

      const setRes = window.__gs.set("s", "k2", 1) as { ok?: boolean; code?: string };
      const putRes = window.__gs.putIncident("s", "i", { id: "i", title: "t", priority: 1 }) as {
        ok?: boolean;
        code?: string;
      };
      const applyRes = window.__gs.applyUpdate("s", "d", "0102", "full") as {
        ok?: boolean;
        code?: string;
      };
      const flushRes = (await window.__gs.flush("s")) as { ok?: boolean; code?: string };

      await window.__gs.dispose("s");
      const reopen = (await window.__gs.open("s2", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok: boolean };
      await window.__gs.close("s2");

      return { closed, exportOk, setRes, putRes, applyRes, flushRes, reopen };
    }, dbName);

    expect(out.closed.ok).toBe(false);
    expect(out.closed.code).toBe("CloseFailedError");
    expect(out.exportOk).toBe(true);
    expect(out.setRes.code).toBe("ClosedError");
    expect(out.putRes.code).toBe("ClosedError");
    expect(out.applyRes.code).toBe("ClosedError");
    expect(out.flushRes.code).toBe("ClosedError");
    expect(out.reopen.ok).toBe(true);
  });
});
