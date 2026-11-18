/**
 * Kiroween mobile usability pass (FieldLedger): the first-visit hero keeps Open incident high on short phone viewports,
 * with the keyboard emulated by a short viewport. Real Chromium against the production build.
 * EV-FIXTURE evidence only: nothing here speaks for Safari toolbars or the iOS keyboard (EV-PHYS stays pending).
 */
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { DOC, newProfile } from "./helpers.js";

const HERO = [
  { w: 390, h: 664, max: 540 },
  { w: 430, h: 739, max: 600 },
  { w: 320, h: 568, max: 460 },
  { w: 320, h: 480, max: 480 },
] as const;

async function heldFirstVisit(browser: Browser, vp: { width: number; height: number }) {
  const p = await newProfile(browser, { viewport: vp });
  await p.page.addInitScript(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register = (): Promise<ServiceWorkerRegistration> => new Promise(() => undefined);
  });
  await p.page.goto("/");
  return p;
}

const rect = (page: Page, sel: string): Promise<{ top: number; bottom: number; inner: number }> =>
  page.evaluate((s) => {
    const r = (document.querySelector(s) as HTMLElement).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, inner: window.innerHeight };
  }, sel);

test("E2E-MP-FL-01: first-visit hero keeps Open incident high on short phone viewports and keeps the offline warnings", async ({ browser }) => {
  const report: string[] = [];
  for (const { w, h, max } of HERO) {
    const p = await heldFirstVisit(browser, { width: w, height: h });
    const page = p.page;
    await expect(page.getByRole("button", { name: "Open incident", exact: true })).toBeVisible();
    await expect(page.getByTestId("first-visit-notice")).toHaveCount(1);
    await expect(page.getByTestId("offline-indicator")).toHaveAttribute("data-offline-state", "registering");
    const r = await rect(page, "form.fl-join button[type=submit]");
    const inputSize = await page.locator("#incident-id").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    report.push(`${w}x${h}: Open incident bottom ${Math.round(r.bottom)} (limit ${max})`);
    expect(r.bottom, `${w}x${h}`).toBeLessThanOrEqual(max);
    expect(inputSize).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await p.context.close();
  }
  console.log(report.join("\n"));
  const t = await heldFirstVisit(browser, { width: 390, height: 844 });
  await expect(t.page.getByTestId("offline-indicator")).toBeInViewport();
  await expect(t.page.getByTestId("first-visit-notice")).toBeInViewport();
  await t.context.close();
});

test("E2E-MP-FL-02: with the keyboard open (short visual viewport) Incident ID and Open incident are both reachable and Enter opens the incident", async ({ browser }) => {
  for (const vp of [{ width: 390, height: 340 }, { width: 320, height: 300 }]) {
    const p = await heldFirstVisit(browser, vp);
    const page = p.page;
    const input = page.getByLabel("Incident ID");
    await input.focus();
    const i = await rect(page, "#incident-id");
    expect(i.top, `${vp.width}x${vp.height} input top`).toBeGreaterThanOrEqual(0);
    expect(i.bottom, `${vp.width}x${vp.height} input bottom`).toBeLessThanOrEqual(i.inner + 1);
    await page.getByRole("button", { name: "Open incident", exact: true }).scrollIntoViewIfNeeded();
    const o = await rect(page, "form.fl-join button[type=submit]");
    expect(o.top).toBeGreaterThanOrEqual(0);
    expect(o.bottom).toBeLessThanOrEqual(o.inner + 1);
    const i2 = await rect(page, "#incident-id");
    expect(i2.bottom <= o.top || i2.top >= o.bottom).toBe(true);
    await input.fill(DOC);
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
    await p.context.close();
  }
});
