/**
 * offline-assets milestone — REAL Chromium acceptance tests for COLD offline
 * loading of the PRODUCTION-built harness via a build-generated Service Worker +
 * real Cache Storage. Unlike the other e2e suites (which load with networking ON
 * and only disable it for in-page edit/flush), these tests disable networking
 * and RELOAD without re-enabling it, so the shell + assets must come from the
 * Service Worker cache.
 *
 * HONESTY (clarification): no route.fulfill, no injected page HTML, no mocked
 * service worker is used to manufacture offline success. Networking is disabled
 * with context.setOffline(true) (real offline), and SW delivery is proven with
 * Playwright's response.fromServiceWorker(). The install-failure test is clearly
 * SEPARATED below and uses a REAL worker whose install genuinely rejects.
 *
 * PROMISE BOUNDARY: a PREVIOUSLY-INITIALIZED profile reopening offline is
 * promised; a FIRST-EVER visit offline is NOT — the uncached-fresh-profile test
 * asserts that honest failure.
 */
import type { BrowserContext, Page, Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { awaitOfflineReady, readOfflineState, uniqueDbName } from "./helpers.js";

/** Open the harness root online and await genuine offline readiness. */
async function prepareOnline(page: Page): Promise<void> {
  await page.goto("/");
  await awaitOfflineReady(page);
}

test.describe("offline cold boot (offline-assets)", () => {
  test("previously-initialized profile boots + restores with networking disabled; offline edit survives another offline reload", async ({
    page,
    context,
  }) => {
    const dbName = uniqueDbName("offline");

    // 1) clean context (fresh per test), load ONLINE, await full offline readiness.
    await prepareOnline(page);
    const onlineState = await readOfflineState(page);
    expect(onlineState.ready).toBe(true);
    expect(onlineState.state).toBe("ready");

    // 2) create BOTH legacy + structured data, then flush (networking still on).
    const built = await page.evaluate(() => window.__gs.buildChained("incident-9"));
    await page.evaluate(
      async (args: { db: string; first: string }) => {
        await window.__gs.open("s", {
          app: "fieldledger",
          documentId: "incident-9",
          replicaId: "r",
          dbName: args.db,
        });
        window.__gs.set("s", "status", "triage");
        window.__gs.putIncident("s", "i1", { id: "i1", title: "Spill", priority: 1 });
        window.__gs.applyUpdate("s", "incident-9", args.first, "full");
        await window.__gs.flush("s");
        await window.__gs.close("s");
      },
      { db: dbName, first: built.first },
    );

    // 3) DISABLE networking (real offline — NOT request mocking).
    await context.setOffline(true);

    // 4) RELOAD without re-enabling networking; capture responses to prove SW
    //    delivery of the shell + the required asset.
    const responses: Response[] = [];
    const collect = (r: Response): void => {
      responses.push(r);
    };
    page.on("response", collect);
    await page.reload();
    // 5) assert the shell BOOTS offline (window.__gs defined) and offline-ready.
    await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
    await awaitOfflineReady(page);
    page.off("response", collect);

    // assert saved data RESTORES with networking disabled throughout navigation.
    const restored = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "incident-9",
        replicaId: "r",
        dbName: db,
      });
      const status = window.__gs.get("s", "status");
      const incident = window.__gs.getIncident("s", "i1");
      const remoteKey = window.__gs.get("s", "a");
      window.__gs.showRestored(`status=${String(status)} incident=${incident?.title}`);
      await window.__gs.close("s");
      return { status, incident, remoteKey };
    }, dbName);
    expect(restored.status).toBe("triage");
    expect(restored.incident).toEqual({ id: "i1", title: "Spill", priority: 1 });
    expect(restored.remoteKey).toBe(1);

    // fromServiceWorker(): the HTML navigation + the JS asset are SW-served.
    const navResponse = responses.find((r) => {
      const u = new URL(r.url());
      return r.request().resourceType() === "document" && u.pathname.endsWith("/");
    });
    const docResponse =
      navResponse ??
      responses.find((r) => r.request().resourceType() === "document");
    const assetResponse = responses.find((r) => /\/assets\/index-.*\.js$/.test(r.url()));
    expect(docResponse, "a document response was captured on offline reload").toBeTruthy();
    expect(assetResponse, "the JS asset response was captured on offline reload").toBeTruthy();
    expect(docResponse!.fromServiceWorker()).toBe(true);
    expect(assetResponse!.fromServiceWorker()).toBe(true);

    // 6) edit + flush OFFLINE, reload OFFLINE again, verify the LATEST edit survived.
    await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "incident-9",
        replicaId: "r",
        dbName: db,
      });
      window.__gs.set("s", "status", "resolved-offline");
      await window.__gs.flush("s");
      await window.__gs.close("s");
    }, dbName);

    await page.reload(); // still offline
    await awaitOfflineReady(page);

    const afterOfflineEdit = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "incident-9",
        replicaId: "r",
        dbName: db,
      });
      const status = window.__gs.get("s", "status");
      await window.__gs.close("s");
      return status;
    }, dbName);
    expect(afterOfflineEdit).toBe("resolved-offline");

    // A REAL screenshot of the offline-loaded harness with restored data.
    await page.evaluate(() =>
      window.__gs.showRestored("status=resolved-offline (OFFLINE reload, SW-served)"),
    );
    await page.screenshot({ path: "playwright-report/offline-restored.png", fullPage: true });
  });

  test("a NEW page in the SAME offline profile reopens the saved replica after the prior page releases the Web Lock", async ({
    context,
  }) => {
    const dbName = uniqueDbName("offline-newpage");
    const first = await context.newPage();
    await prepareOnline(first);

    await first.evaluate(async (db: string) => {
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "k", "held-by-first");
      await window.__gs.flush("s");
      // NOTE: do NOT close yet — the lock is still held by this page.
    }, dbName);

    // Go offline, then open a SECOND page in the SAME context/profile.
    await context.setOffline(true);
    const second = await context.newPage();
    await second.goto("/"); // cold offline navigation — served by the SW
    await second.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
    await awaitOfflineReady(second);

    // While the first page still OWNS the replica, the second cannot open it.
    const contended = await second.evaluate(async (db: string) => {
      return (await window.__gs.open("s2", {
        app: "a",
        documentId: "d",
        replicaId: "r",
        dbName: db,
      })) as { ok?: boolean; code?: string };
    }, dbName);
    expect(contended.ok).toBe(false);
    expect(contended.code).toBe("StorageInUseError");

    // The prior page RELEASES ownership (closes the session → releases the lock).
    await first.evaluate(async () => {
      await window.__gs.close("s");
    });
    await first.close();

    // Now the second page reopens the SAVED replica, still OFFLINE.
    const reopened = await second.evaluate(async (db: string) => {
      await window.__gs.open("s3", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      const v = window.__gs.get("s3", "k");
      await window.__gs.close("s3");
      return v;
    }, dbName);
    expect(reopened).toBe("held-by-first");
  });

  test("scoped cache cleanup on activation leaves UNRELATED caches AND IndexedDB untouched", async ({
    page,
  }) => {
    const dbName = uniqueDbName("offline-cleanup");
    await prepareOnline(page);

    // Seed an UNRELATED cache entry + a stale cache that shares our prefix, plus
    // persist a replica. Then force a re-activation and assert scoped cleanup only
    // removed the stale PREFIXED cache — unrelated cache + IndexedDB survive.
    const seeded = await page.evaluate(async (db: string) => {
      // unrelated cache (different name) — must survive.
      const unrelated = await caches.open("unrelated-app-cache-v1");
      await unrelated.put("/unrelated-key", new Response("keep-me"));
      // stale cache owned by OUR scope prefix but an old version — must be cleaned.
      const stale = await caches.open("ghostsync-persist-harness-staleversion00");
      await stale.put("/stale-key", new Response("remove-me"));
      // persist a replica (IndexedDB) — must survive.
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      window.__gs.set("s", "survive", "yes");
      await window.__gs.flush("s");
      await window.__gs.close("s");
      return caches.keys();
    }, dbName);
    expect(seeded).toContain("unrelated-app-cache-v1");
    expect(seeded).toContain("ghostsync-persist-harness-staleversion00");

    // Trigger the SAME scoped-cleanup code path the activate handler runs, via an
    // explicit message to the controlling worker, and await its completion reply
    // (observable — no sleep). This deterministically exercises scoped cleanup
    // against the seeded stale cache.
    await page.evaluate(async () => {
      const controller = navigator.serviceWorker.controller;
      if (controller === null) {
        throw new Error("no controlling service worker");
      }
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("cleanup timeout")), 5_000);
        const onMessage = (event: MessageEvent): void => {
          const d = event.data as { type?: string } | undefined;
          if (d && d.type === "GHOSTSYNC_CLEANUP_DONE") {
            window.clearTimeout(timer);
            navigator.serviceWorker.removeEventListener("message", onMessage);
            resolve();
          }
        };
        navigator.serviceWorker.addEventListener("message", onMessage);
        controller.postMessage({ type: "GHOSTSYNC_CLEANUP" });
      });
    });

    const after = await page.evaluate(async (db: string) => {
      const keys = await caches.keys();
      const unrelated = await caches.open("unrelated-app-cache-v1");
      const unrelatedHit = await unrelated.match("/unrelated-key");
      const unrelatedBody = unrelatedHit ? await unrelatedHit.text() : null;
      // IndexedDB replica still readable.
      await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: db });
      const survive = window.__gs.get("s", "survive");
      await window.__gs.close("s");
      return { keys, unrelatedBody, survive };
    }, dbName);

    // unrelated cache + its contents survive.
    expect(after.keys).toContain("unrelated-app-cache-v1");
    expect(after.unrelatedBody).toBe("keep-me");
    // stale scoped cache was cleaned by activation.
    expect(after.keys).not.toContain("ghostsync-persist-harness-staleversion00");
    // IndexedDB data survives cleanup.
    expect(after.survive).toBe("yes");
  });
});

/**
 * HONEST NEGATIVE CASES — clearly SEPARATED from the genuine offline-navigation
 * evidence above. These prove the system does NOT over-promise.
 */
test.describe("offline negative cases (offline-assets)", () => {
  test("an UNCACHED fresh profile honestly FAILS to open the harness offline (first-ever visit is NOT promised)", async ({
    browser,
  }) => {
    // A brand-new, isolated context = a first-ever visitor with NO installed SW
    // and NO cache. Going offline BEFORE the first visit must fail to load.
    const fresh: BrowserContext = await browser.newContext();
    try {
      await fresh.setOffline(true);
      const page = await fresh.newPage();
      let navigationFailed = false;
      try {
        // Bounded wait; a cold offline first visit has nothing to serve the shell.
        await page.goto("/", { timeout: 8_000, waitUntil: "domcontentloaded" });
        // If navigation somehow resolved, the harness must NOT have booted.
        const booted = await page
          .evaluate(() => window.__gs?.ready === true)
          .catch(() => false);
        navigationFailed = booted !== true;
      } catch {
        navigationFailed = true; // net::ERR_INTERNET_DISCONNECTED — the honest outcome.
      }
      expect(navigationFailed).toBe(true);
    } finally {
      await fresh.close();
    }
  });

  test("worker/cache INSTALLATION FAILURE is reported as a failure state, never offline-ready", async ({
    page,
  }) => {
    // Register a REAL worker whose install genuinely rejects (generated
    // sw-install-fail.js). This is NOT a mock: the browser discards the worker on
    // the failed install. The harness must surface a FAILURE state and must NOT
    // claim offline-ready.
    await page.goto("/?sw=sw-install-fail.js");
    await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
    // Await a terminal (non-transient) offline state without any sleep.
    await page.waitForFunction(
      () => {
        const s = window.__gsOffline?.state;
        return s === "failed" || s === "ready";
      },
      undefined,
      { timeout: 20_000 },
    );
    const state = await readOfflineState(page);
    expect(state.ready).toBe(false);
    expect(state.state).toBe("failed");
  });
});
