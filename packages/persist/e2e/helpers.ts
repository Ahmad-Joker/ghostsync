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
