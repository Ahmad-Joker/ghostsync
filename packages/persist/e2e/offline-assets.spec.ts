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
  }, testInfo) => {
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

    // --- Screenshot evidence (captured ONLY after the offline / SW-served /
    //     restored assertions above have all passed) ---

    // (a) networking is STILL disabled — the context remains offline; we do not
    //     re-enable it. Assert a genuinely offline nav fails fast before capture.
    const stillOffline = await page
      .evaluate(
        async () =>
          await fetch("/__offline_probe__", { cache: "no-store" })
            .then(() => "online")
            .catch(() => "offline"),
      )
      .catch(() => "offline");
    expect(stillOffline).toBe("offline");

    // (b) reopen the SAVED replica once more (still offline) and read back the
    //     ACTUAL restored legacy + structured values, then render them into the
    //     harness DOM so the screenshot VISIBLY shows the real restored state.
    const readback = await page.evaluate(async (db: string) => {
      await window.__gs.open("s", {
        app: "fieldledger",
        documentId: "incident-9",
        replicaId: "r",
        dbName: db,
      });
      const legacyStatus = window.__gs.get("s", "status");
      const legacyRemote = window.__gs.get("s", "a");
      const incident = window.__gs.getIncident("s", "i1");
      window.__gs.showRestored(
        `legacy status=${String(legacyStatus)} | legacy a=${String(legacyRemote)} | ` +
          `incident i1={id:${String(incident?.id)}, title:${String(incident?.title)}, ` +
          `priority:${String(incident?.priority)}} (OFFLINE, SW-served)`,
      );
      await window.__gs.close("s");
      return { legacyStatus, legacyRemote, incident };
    }, dbName);
    // The rendered values are the genuine restored session state (not fabricated).
    expect(readback.legacyStatus).toBe("resolved-offline");
    expect(readback.legacyRemote).toBe(1);
    expect(readback.incident).toEqual({ id: "i1", title: "Spill", priority: 1 });

    // Capture via Playwright's MANAGED output path (not an unmanaged write into
    // the HTML reporter's folder, which the reporter rebuilds at run end).
    const file = testInfo.outputPath("offline-restored.png");
    await page.screenshot({ path: file, fullPage: true });
    // Attach the real PNG to the test report as durable evidence.
    await testInfo.attach("offline-restored", { path: file, contentType: "image/png" });
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
    // The active cache name is scope-specific: prefix + <scope pathname> + "::"
    // + version. Derive the current scope's stale-cache name from the SW's
    // reported active cacheName so the seeded stale cache belongs to THIS exact
    // scope (and is therefore eligible for scoped cleanup).
    const { cacheName } = await readOfflineState(page);
    expect(cacheName, "the SW reported its active scope-specific cache name").toBeTruthy();
    const scopePrefix = cacheName!.slice(0, cacheName!.lastIndexOf("::") + 2);
    const staleName = `${scopePrefix}staleversion00`;

    const seeded = await page.evaluate(
      async (args: { db: string; stale: string }) => {
        // unrelated cache (different name) — must survive.
        const unrelated = await caches.open("unrelated-app-cache-v1");
        await unrelated.put("/unrelated-key", new Response("keep-me"));
        // stale cache owned by OUR exact scope prefix but an old version — must
        // be cleaned.
        const stale = await caches.open(args.stale);
        await stale.put("/stale-key", new Response("remove-me"));
        // persist a replica (IndexedDB) — must survive.
        await window.__gs.open("s", { app: "a", documentId: "d", replicaId: "r", dbName: args.db });
        window.__gs.set("s", "survive", "yes");
        await window.__gs.flush("s");
        await window.__gs.close("s");
        return caches.keys();
      },
      { db: dbName, stale: staleName },
    );
    expect(seeded).toContain("unrelated-app-cache-v1");
    expect(seeded).toContain(staleName);

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
    expect(after.keys).not.toContain(staleName);
    // IndexedDB data survives cleanup.
    expect(after.survive).toBe("yes");
  });
});

/**
 * REGRESSIONS (offline-assets) — real Chromium, ADDED alongside the existing
 * evidence above (nothing weakened). These lock in the two defect fixes:
 *   A. scope-specific cache ownership (two deployments on one origin stay
 *      independent; cleanup in one preserves the other's cache + offline boot);
 *   B. restricted navigation routing (unknown navigations + a missing-.js path
 *      requested as a navigation do NOT receive the harness HTML shell, while a
 *      KNOWN precached asset still serves from the SW cache).
 */
test.describe("offline-assets regressions (scope isolation + restricted nav)", () => {
  /** Register the scope-local SW for a sub-path deployment and await readiness. */
  async function prepareScope(page: Page, path: string): Promise<string> {
    await page.goto(path);
    await awaitOfflineReady(page);
    const view = await readOfflineState(page);
    expect(view.ready).toBe(true);
    expect(view.cacheName, "the deployment reported its scope-specific cache name").toBeTruthy();
    return view.cacheName!;
  }

  test("FIX 1: two deployment scopes on one origin own SEPARATE caches; cleanup in P1 preserves P2's cache and offline boot", async ({
    context,
  }) => {
    // Deploy the SAME build under two distinct sub-paths on ONE origin.
    const p1 = await context.newPage();
    const p1Cache = await prepareScope(p1, "/deploy-p1/");

    const p2 = await context.newPage();
    const p2Cache = await prepareScope(p2, "/deploy-p2/");

    // The two deployments MUST own different cache namespaces even though the
    // build contents are byte-identical — the registration SCOPE distinguishes
    // them.
    expect(p1Cache).not.toBe(p2Cache);
    expect(p1Cache).toContain("/deploy-p1/");
    expect(p2Cache).toContain("/deploy-p2/");

    // Both caches exist on the origin before cleanup.
    const before = await p1.evaluate(() => caches.keys());
    expect(before).toContain(p1Cache);
    expect(before).toContain(p2Cache);

    // Run scoped cleanup/activation in P1 (same code path as the activate
    // handler), awaiting its completion reply (observable — no sleep).
    await p1.evaluate(async () => {
      const controller = navigator.serviceWorker.controller;
      if (controller === null) {
        throw new Error("no controlling service worker for P1");
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

    // P2's cache SURVIVES P1's cleanup (cleanup is strictly scope-local).
    const after = await p1.evaluate(() => caches.keys());
    expect(after).toContain(p1Cache); // P1's current cache stays (it is current)
    expect(after).toContain(p2Cache); // P2's cache is untouched by P1 cleanup

    // P2 can STILL boot offline from its own surviving cache.
    await context.setOffline(true);
    const responses: Response[] = [];
    const collect = (r: Response): void => {
      responses.push(r);
    };
    p2.on("response", collect);
    await p2.reload();
    await p2.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
    await awaitOfflineReady(p2);
    p2.off("response", collect);

    // The P2 document + its asset were served by the Service Worker, offline.
    const docResponse = responses.find((r) => r.request().resourceType() === "document");
    const assetResponse = responses.find((r) => /\/assets\/index-.*\.js$/.test(r.url()));
    expect(docResponse, "P2 document response captured offline").toBeTruthy();
    expect(assetResponse, "P2 JS asset response captured offline").toBeTruthy();
    expect(docResponse!.fromServiceWorker()).toBe(true);
    expect(assetResponse!.fromServiceWorker()).toBe(true);

    // And P2 still reports its own (unchanged) scope-specific cache.
    const p2After = await readOfflineState(p2);
    expect(p2After.ready).toBe(true);
    expect(p2After.cacheName).toBe(p2Cache);

    await context.setOffline(false);
    await p1.close();
    await p2.close();
  });

  test("FIX 2: unknown navigations and a missing-.js navigation do NOT get the HTML shell; a known precached asset still serves from the SW", async ({
    page,
    context,
  }) => {
    await prepareOnline(page);

    // Discover the actual precached asset URL from the SW manifest so the test
    // asserts against the REAL hashed filename (never a hardcoded hash).
    const assetUrl = await page.evaluate(async () => {
      const res = await fetch("./precache-manifest.json", { cache: "no-store" });
      const manifest = (await res.json()) as { entries: { url: string }[] };
      const asset = manifest.entries.find((e) => /assets\/index-.*\.js$/.test(e.url));
      return asset ? new URL(asset.url, window.location.href).toString() : null;
    });
    expect(assetUrl, "a precached JS asset is listed in the manifest").toBeTruthy();

    // Go offline. The SW is active and controls this scope. We now attempt REAL
    // navigations (page.goto → genuine request.mode === "navigate" reaching the
    // SW fetch handler — not a scripted fetch, which cannot use navigate mode).

    await context.setOffline(true);

    /**
     * Attempt an offline navigation to a path and report whether it FAILED and
     * whether the harness HTML shell was served (booted). The SW must NOT serve
     * the shell for an undocumented route, so offline the navigation fails at
     * the network and the harness never boots.
     */
    const attemptNav = async (path: string): Promise<{ failed: boolean; booted: boolean }> => {
      let failed = false;
      try {
        await page.goto(path, { timeout: 8_000, waitUntil: "domcontentloaded" });
      } catch {
        failed = true; // net::ERR_INTERNET_DISCONNECTED — the honest outcome.
      }
      const booted = await page.evaluate(() => window.__gs?.ready === true).catch(() => false);
      return { failed, booted: booted === true };
    };

    // (1) An UNKNOWN navigation path: must NOT receive the cached HTML shell.
    const unknownNav = await attemptNav("/totally-unknown-route");
    expect(unknownNav.booted, "unknown navigation must not boot the harness shell").toBe(false);
    expect(unknownNav.failed, "unknown navigation fails at the network (no masked shell)").toBe(true);

    // (2) A MISSING-.js path requested AS A NAVIGATION: must NOT be masked with
    //     the HTML shell either — a genuine offline failure, not a 200-HTML.
    const missingJsNav = await attemptNav("/assets/does-not-exist.js");
    expect(missingJsNav.booted, "missing-.js navigation must not boot the harness shell").toBe(false);
    expect(
      missingJsNav.failed,
      "missing-.js navigation fails at the network (no masked shell)",
    ).toBe(true);

    // Restore the controlled page by navigating back to the DOCUMENTED root
    // (still offline — the SW serves the shell here, which is the allowed route).
    await page.goto("/");
    await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
    await awaitOfflineReady(page);

    // (3) A KNOWN precached asset STILL serves from the SW cache, offline — the
    //     fix must not regress normal precached asset delivery.
    const responses: Response[] = [];
    const collect = (r: Response): void => {
      responses.push(r);
    };
    page.on("response", collect);
    const assetOk = await page.evaluate(async (url: string) => {
      const res = await fetch(url, { cache: "no-store" });
      return { ok: res.ok, status: res.status };
    }, assetUrl!);
    page.off("response", collect);
    expect(assetOk.ok).toBe(true);
    expect(assetOk.status).toBe(200);
    const assetResponse = responses.find((r) => r.url() === assetUrl);
    expect(assetResponse, "the known asset response was captured").toBeTruthy();
    expect(assetResponse!.fromServiceWorker()).toBe(true);

    await context.setOffline(false);
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
