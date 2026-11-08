/**
 * Real-Chromium regressions for the four persistence-review findings that are
 * about CONCURRENCY and LIFECYCLE correctness — exercised against real
 * IndexedDB, real crypto.subtle SHA-256, and the real navigator.locks API:
 *
 *   fix 2 — a terminal dispose finishes/aborts an active write transaction and
 *           awaits real lock release BEFORE resolving: no late "saved", and an
 *           immediate SAME-KEY reopen acquires the lock; concurrent
 *           close()/dispose() settle consistently.
 *   fix 3 — a skipped stale write (a newer stored sequence already on disk) is
 *           surfaced as an error, never a false "saved"; the in-memory edit and
 *           the newer stored record both survive a reopen.
 *   fix 4 — a collection handle captured while OPEN returns a typed ClosedError
 *           on every read route after terminal close; subscribe is blocked after
 *           terminal disposal.
 *
 * The one-shot real transaction abort (window.__gs.armWriteAbortOnce) is TEST-
 * ONLY harness instrumentation; the shipped package exposes no such hook.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { loadHarnessOffline, uniqueDbName } from "./helpers.js";

async function ready(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
}

test.describe("lifecycle fixes (REQ-BP-003/005)", () => {
  test("dispose() DURING a real aborted write transaction settles with no late 'saved'", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "v");
      // Arm a real transaction abort and start a flush we will NOT await, so the
      // write transaction is live when we dispose.
      window.__gs.armWriteAbortOnce();
      const flushing = window.__gs.flush("s");
      await window.__gs.dispose("s");
      // The in-flight flush settles (does not hang) and no mutation is allowed.
      await flushing.catch(() => undefined);
      const afterSet = window.__gs.set("s", "x", 1) as { ok?: boolean; code?: string };
      const log = window.__gs.stateLog("s");
      return { afterSet, log };
    }, dbName);
    expect(out.afterSet.code).toBe("ClosedError");
    // dispose() makes no durability claim: no "saved" published after teardown.
    expect(out.log).not.toContain("saved");
  });

  test("dispose() during a real aborted write settles in order: tx terminal → lock release → dispose resolve", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const order = await page.evaluate(async (db: string) => {
      window.__gs.resetLifecycleLog();
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "v");
      // Arm a REAL transaction abort; the harness records tx:abort, lock:release,
      // and dispose:resolve in occurrence order across the instrumented dispose.
      window.__gs.armWriteAbortOnce();
      return window.__gs.flushThenDisposeOrdered("s");
    }, dbName);
    // The write transaction's TERMINAL abort event fires, THEN the Web Lock is
    // actually released, THEN dispose() resolves (fix 2).
    expect(order).toEqual(["tx:abort", "lock:release", "dispose:resolve"]);
  });

  test("onStateChange after terminal disposal returns a typed ClosedError", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const probe = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      await window.__gs.dispose("s");
      return window.__gs.onStateChangeProbe("s");
    }, dbName);
    expect(probe).toBe("ClosedError");
  });

  test("immediate SAME-KEY reopen after dispose acquires the lock (ownership released)", async ({
    context,
  }) => {
    const dbName = uniqueDbName();
    const page = await context.newPage();
    await ready(page);
    await context.setOffline(true);
    const reopened = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "v"); // a save may be in flight
      await window.__gs.dispose("s"); // must await ACTUAL lock release
      const r = (await window.__gs.open("s2", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok?: boolean; code?: string };
      await window.__gs.close("s2");
      return r;
    }, dbName);
    expect(reopened.ok).toBe(true);
    expect(reopened.code).toBeUndefined();
  });

  test("concurrent close() and dispose() settle consistently without hanging", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "v");
      // Fire both terminal operations at once; both must settle (no hang).
      const results = await Promise.all([window.__gs.close("s"), window.__gs.dispose("s")]);
      const afterSet = window.__gs.set("s", "x", 1) as { ok?: boolean; code?: string };
      // Ownership released exactly once: a reopen succeeds.
      const reopen = (await window.__gs.open("s2", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok: boolean };
      await window.__gs.close("s2");
      return { results, afterSet, reopen };
    }, dbName);
    expect(out.afterSet.code).toBe("ClosedError");
    expect(out.reopen.ok).toBe(true);
  });

  test("a skipped stale write is surfaced (never false 'saved'); edit + stored record survive", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      // Open to resolve the storage key, then PLANT a record whose sequence is
      // far ahead of anything this session will produce.
      const opened = (await window.__gs.open("s", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok: boolean; storageKey: string };
      await window.__gs.plantRecord(db, {
        storageKey: opened.storageKey,
        version: 1,
        app: "a",
        documentId: "d",
        replicaId: "r",
        bytes: new Uint8Array([9, 9, 9]),
        sequence: 1_000_000,
        checksum:
          "0000000000000000000000000000000000000000000000000000000000000000",
        savedAt: Date.now(),
      });

      window.__gs.set("s", "mine", "keep-me");
      const flushed = (await window.__gs.flush("s")) as { ok?: boolean; code?: string };
      const state = window.__gs.state("s");
      const live = window.__gs.get("s", "mine");
      await window.__gs.dispose("s");
      return { flushed, state, live, storageKey: opened.storageKey };
    }, dbName);
    // The current bytes never reached disk: flush is NOT a false success.
    expect(out.flushed.ok).toBe(false);
    expect(out.state).toBe("error");
    // The in-memory edit survives (not lost, not clobbered).
    expect(out.live).toBe("keep-me");

    // The newer stored record is intact: reopening fails validation (the planted
    // checksum is bogus) which PROVES the stale record was NOT overwritten by the
    // session's save — the edit did not clobber disk.
    const rereading = await page.evaluate(
      async (args: { db: string }) => {
        const r = (await window.__gs.open("s3", {
          app: "a",
          documentId: "d",
          replicaId: "r",
          dbName: args.db,
        })) as { ok?: boolean; code?: string };
        if (r.ok === true) {
          await window.__gs.close("s3");
        }
        return r;
      },
      { db: dbName },
    );
    expect(rereading.ok).toBe(false);
    expect(rereading.code).toBe("InvalidRecordError");
  });

  test("a collection handle captured while OPEN returns ClosedError on every read after close", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName();
    await loadHarnessOffline(page, context);
    const out = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.putIncident("s", "i1", { id: "i1", title: "t", priority: 1 });
      // Capture the handle WHILE OPEN.
      window.__gs.captureIncidentCollection("s");
      await window.__gs.flush("s");
      await window.__gs.close("s"); // terminal close
      const reads = window.__gs.probeCapturedReads("s");
      const subscribe = window.__gs.subscribeProbe("s");
      return { reads, subscribe };
    }, dbName);
    for (const route of ["get", "getResult", "list", "listResults", "has"]) {
      expect(out.reads[route]).toBe("ClosedError");
    }
    expect(out.subscribe).toBe("ClosedError");
  });
});
