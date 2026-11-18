import { expect, test } from "@playwright/test";
import {
  BASE,
  BOARD,
  addCardUi,
  awaitSaved,
  btn,
  join,
  loadUntilOfflineReady,
  newProfile,
  press,
  readManifestUrls,
  readStoredRecords,
  recordedOfflineStates,
  saveIndicator,
  saveSequence,
  serverFailAsset,
  serverRequestLog,
  serverReset,
  storedState,
  validCard,
} from "./helpers.js";

test("E2E-PB-11 leg 1: a first visit while offline fails honestly; readiness gates ready", async ({ browser }) => {
  const p = await newProfile(browser, { recordOffline: true });
  await p.context.setOffline(true);
  await expect(p.page.goto("/")).rejects.toThrow();
  await p.context.setOffline(false);
  await p.page.goto("/");
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  // Before readiness the notice was shown; the first observation is never ready.
  const seen = await recordedOfflineStates(p.page);
  expect(seen[0]?.ready).not.toBe("true");
  expect(seen.some((s) => s.state !== "ready" && s.notice)).toBe(true);
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-state", "ready");
  await expect(p.page.getByTestId("first-visit-notice")).toBeHidden();
  await expect(p.page.getByTestId("offline-indicator")).toHaveText("Ready to work offline.");
  await p.context.close();
});

test("E2E-PB-11 leg 2: a precache asset the test server answers with 404 never yields offline readiness", async ({ browser }, testInfo) => {
  const css = readManifestUrls().find((u) => /^assets\/.+\.css$/.test(u));
  if (css === undefined) throw new Error("dist/precache-manifest.json lists no assets/*.css entry; run the build first");
  await serverReset();
  try {
    await serverFailAsset(css, 1);
    // A FRESH context: no earlier service worker, no caches.
    const p = await newProfile(browser, { recordOffline: true });
    const page = p.page;
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-offline-state", "failed");
    await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "false");
    const seen = await recordedOfflineStates(page);
    expect(seen.length).toBeGreaterThan(1);
    for (const s of seen) {
      expect(s.state).not.toBe("ready");
      expect(s.ready).not.toBe("true");
    }
    await expect(page.getByTestId("offline-indicator")).not.toContainText("Ready to work offline.");
    await expect(page.getByTestId("offline-indicator")).toContainText("Offline use is not available");
    await expect(page.getByTestId("first-visit-notice")).toBeVisible();
    expect(seen.every((s) => s.notice)).toBe(true);

    // The server really served a 404 to the install fetch of that URL.
    const log = await serverRequestLog();
    const forAsset = log.filter((e) => e.path === `/${css}`);
    expect(forAsset.length).toBeGreaterThanOrEqual(2);
    expect(forAsset[0]?.status).toBe(200); // the page's own load
    const failed = forAsset.find((e) => e.status === 404);
    expect(failed).toBeDefined();
    const swIndex = log.findIndex((e) => e.path === "/sw.js");
    expect(swIndex).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(failed as (typeof log)[number])).toBeGreaterThan(swIndex);
    testInfo.annotations.push({ type: "failed-asset-request-cache-control", description: `${failed?.cacheControl ?? ""}` });

    // No active controller; every app cache is empty.
    expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
    const sizes = await page.evaluate(async () => {
      const out: Array<[string, number]> = [];
      for (const k of await caches.keys()) if (k.startsWith("ghostsync-patchboard-")) out.push([k, (await (await caches.open(k)).keys()).length]);
      return out;
    });
    for (const [, n] of sizes) expect(n).toBe(0);

    // The app still works online.
    await join(page, "fail-board");
    const id = await addCardUi(page, "Online only");
    await awaitSaved(page);
    expect(validCard((await storedState(page)).cards, id)?.title).toBe("Online only");

    // And a fresh profile does not boot offline from a half-installed cache.
    await p.context.setOffline(true);
    await expect(page.reload()).rejects.toThrow();
    await p.context.close();
  } finally {
    await serverReset();
  }
});

test("E2E-PB-12: a new worker waits; Update now activates it by keyboard after settling", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, BOARD);
  await addCardUi(page, "Saved card");
  await awaitSaved(page);
  const before = await storedState(page);

  const bump = await page.request.post("/__test/sw-bump");
  expect(bump.status()).toBe(204);
  await page.reload();
  const t0 = await page.evaluate(() => performance.timeOrigin);
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "waiting");
  const banner = page.getByTestId("update-banner");
  await expect(banner).toContainText("A new version is ready. Save your work, then update.");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null)).toBe(true);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(t0);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");

  await press(page, banner.getByRole("button", { name: "Update now", exact: true }));
  await expect.poll(() => page.evaluate(() => performance.timeOrigin).catch(() => t0)).not.toBe(t0);
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "ready");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).toBeNull();
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  expect((await storedState(page)).cards).toEqual(before.cards);
  await p.context.close();
});

test("E2E-PB-17: join validation, route, replica identity, labels, network chip, same-origin requests", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await loadUntilOfflineReady(page);
  await expect(page.getByTestId("transfer-mode")).toHaveText("Transfer: file (.gscap)");
  await expect(page.getByTestId("network-chip")).toHaveText("Network: online");

  // Invalid ID: message, nothing stored.
  await page.getByLabel("Board ID").fill("ab");
  await press(page, btn(page, "Open board"));
  await expect(page.locator("#board-error")).toContainText("not valid");
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  expect(await readStoredRecords(page)).toEqual([]);
  await page.getByLabel("Board ID").fill("  Sprint-Board ");
  await expect(page.locator("#board-preview")).toHaveText("Will open: sprint-board");
  await press(page, btn(page, "Open board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator("main")).toHaveAttribute("data-board-id", "sprint-board");
  expect(page.url()).toContain("#/b/sprint-board");
  const rid = (await page.locator("main").getAttribute("data-replica-id")) ?? "";
  expect(rid).toMatch(/^[0-9a-f-]{36}$/);

  // Save labels come from real state.
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  const firstSeq = await saveSequence(page);
  await expect(saveIndicator(page)).toHaveText(firstSeq > 0 ? /Saved locally/ : /Nothing to save yet/);
  const id = await addCardUi(page, "Label card");
  await awaitSaved(page);
  await expect(saveIndicator(page)).toHaveText(/Saved locally/);

  // Offline: chip, reload from the worker, same replica id, route kept.
  await p.context.setOffline(true);
  await expect(page.getByTestId("network-chip")).toHaveText("Network: offline");
  const res = await page.reload();
  expect(res?.fromServiceWorker()).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await expect(page.locator("main")).toHaveAttribute("data-replica-id", rid);
  expect(page.url()).toContain("#/b/sprint-board");
  const s = await storedState(page);
  expect(s.record.replicaId).toBe(rid);
  expect(validCard(s.cards, id)?.title).toBe("Label card");

  // Remembered board: open "/" with no hash while offline.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator("main")).toHaveAttribute("data-replica-id", rid);

  const names = await page.evaluate(() => caches.keys());
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n.startsWith("ghostsync-patchboard-")).toBe(true);
  for (const u of requests) expect(new URL(u).origin).toBe(BASE);
  await p.context.close();
});
