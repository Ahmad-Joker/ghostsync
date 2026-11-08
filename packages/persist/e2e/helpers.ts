/**
 * Shared Playwright helpers for the acceptance suite. Encapsulates the honest
 * offline discipline: load the harness with networking ENABLED, then disable it
 * before edit/import/flush assertions; re-enable only to (re)load uncached
 * assets on a reload, then disable again.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** A unique db name per test, so parallel/sequential tests never share storage. */
let counter = 0;
export function uniqueDbName(prefix = "e2e"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** The observable offline-readiness shape mirrored from the harness. */
export interface OfflineReadinessView {
  state: string;
  ready: boolean;
  error: string | undefined;
  cacheVersion: string | undefined;
  cacheName: string | undefined;
  updateAvailable: boolean;
}

/**
 * Await GENUINE offline readiness (offline-assets milestone): the Service Worker
 * is registered, ACTIVE, controls this page, AND reports a COMPLETE precache.
 * This is the observable signal (`window.__gsOffline.ready === true`) the offline
 * acceptance tests await instead of any sleep. Networking stays ENABLED here —
 * the caller disables it afterwards to prove cold offline boot.
 */
export async function awaitOfflineReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => window.__gsOffline?.ready === true, undefined, {
    timeout: 20_000,
  });
}

/** Read the current offline-readiness view from the page (diagnostic/asserts). */
export async function readOfflineState(page: Page): Promise<OfflineReadinessView> {
  return page.evaluate(() => {
    const o = window.__gsOffline;
    return {
      state: o.state,
      ready: o.ready,
      error: o.error,
      cacheVersion: o.cacheVersion,
      cacheName: o.cacheName,
      updateAvailable: o.updateAvailable,
    };
  });
}

/**
 * Load the harness (networking ENABLED), wait for observable readiness
 * (`window.__gs.ready`), then DISABLE networking so subsequent persistence/edit
 * work is proven to need no network.
 */
export async function loadHarnessOffline(page: Page, context: BrowserContext): Promise<void> {
  await context.setOffline(false); // enable to fetch uncached assets
  await page.goto("/");
  await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
  await context.setOffline(true); // prove persistence/editing needs no network
}

/**
 * Reload the harness: re-enable networking to load uncached assets, wait for
 * readiness, then disable networking again. (Honest: this is NOT cold offline
 * loading — asset caching / service workers are the next milestone.)
 */
export async function reloadHarnessOffline(page: Page, context: BrowserContext): Promise<void> {
  await context.setOffline(false);
  await page.reload();
  await page.waitForFunction(() => window.__gs?.ready === true, undefined, { timeout: 15_000 });
  await context.setOffline(true);
}

/** Assert a harness call returned an `{ ok: true }` envelope. */
export function expectOk(result: unknown): void {
  expect(result).toMatchObject({ ok: true });
}
