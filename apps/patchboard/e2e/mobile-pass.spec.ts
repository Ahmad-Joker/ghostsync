/**
 * Kiroween mobile usability pass (PatchBoard): the review panel scrolls into view with focus on its heading,
 * board / size / warning / actions sit together at the top, and the first-visit hero keeps Open board reachable.
 * Real Chromium against the production build with the test-only fake camera. This is EV-FIXTURE evidence only:
 * it says nothing about Safari toolbars, the iOS keyboard or a physical camera (EV-PHYS stays pending).
 */
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { BOARD, addCardUi, awaitSaved, join, loadUntilOfflineReady, newProfile, press, readUiBoard } from "./helpers.js";
import { addFakeCamera, capsuleFrame, qrOnlineProfile } from "./camera.js";
import { expectScanState, peerCapsule, qrBtn, scanFrame, showPanel } from "./qr-fixtures.js";

interface ScrollCall {
  testid: string | null;
  tag: string;
  options: { block?: string | undefined; behavior?: string | undefined } | undefined;
}

/** Test-side spy: wraps Element.prototype.scrollIntoView and records its arguments. Not a production hook. */
function installScrollSpy(): void {
  const w = window as unknown as { __scrollCalls: ScrollCall[] };
  w.__scrollCalls = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions): void {
    w.__scrollCalls.push({ testid: this.getAttribute("data-testid"), tag: this.tagName, options: typeof arg === "object" ? { block: arg.block, behavior: arg.behavior } : undefined });
    original.call(this, arg as ScrollIntoViewOptions);
  };
}

const scrollCalls = (page: Page): Promise<ScrollCall[]> => page.evaluate(() => (window as unknown as { __scrollCalls: ScrollCall[] }).__scrollCalls);

async function spyProfile(browser: Browser, vp: { width: number; height: number }, reducedMotion?: "reduce") {
  const p = await newProfile(browser, { viewport: vp });
  await addFakeCamera(p.context);
  await p.context.addInitScript(installScrollSpy);
  if (reducedMotion !== undefined) await p.page.emulateMedia({ reducedMotion });
  await loadUntilOfflineReady(p.page);
  await join(p.page, BOARD);
  return p;
}

const rect = (page: Page, sel: string): Promise<{ top: number; bottom: number; left: number; right: number; inner: number }> =>
  page.evaluate((s) => {
    const r = (document.querySelector(s) as HTMLElement).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, inner: window.innerHeight };
  }, sel);

const SIZES = [
  { w: 390, h: 664 },
  { w: 320, h: 568 },
] as const;

test("E2E-MP-PB-01: scan to review brings the panel into view, focuses its heading, lists board, size, warning, actions in order, then imports once", async ({ browser }) => {
  for (const { w, h } of SIZES) {
    const p = await spyProfile(browser, { width: w, height: h });
    const page = p.page;
    const before = await readUiBoard(page);
    await scanFrame(page, capsuleFrame(await peerCapsule()));
    const heading = page.getByTestId("qr-review-heading");
    await expect(heading, `${w}x${h}`).toBeFocused();
    expect(await heading.evaluate((el) => el.tagName), "real heading").toBe("H5");
    await expect(heading).toHaveAttribute("tabindex", "-1");
    await expect(page.getByRole("heading", { name: "Capsule found. Not imported yet" })).toBeVisible();
    // The live region still says nothing has been applied.
    await expect(page.getByTestId("qr-scan-message")).toContainText("Nothing has been applied yet");
    // Smooth scrolling settles; poll the real geometry (the spy only records arguments).
    // Smooth scrolling settles; poll the real geometry (the spy only records arguments).
    const inView = async (): Promise<boolean> => {
      for (const sel of ['[data-testid="qr-review-heading"]', ".pb-review .gs-trust", '[data-testid="qr-import-btn"]', '[data-testid="qr-discard-btn"]']) {
        const r = await rect(page, sel);
        if (r.top < 0 || r.bottom > r.inner) return false;
      }
      return true;
    };
    await expect.poll(inView, { message: `${w}x${h} heading, warning, Import and Discard inside the viewport` }).toBe(true);
    const calls = (await scrollCalls(page)).filter((c) => c.testid === "qr-scan-panel");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ block: "start", behavior: "smooth" });
    // DOM order: board name, size, warning, Import, Discard.
    const order = await page.evaluate(() => {
      const q = (s: string): Element => document.querySelector(s) as Element;
      const els = [q('[data-testid="qr-review-board"]'), q('[data-testid="qr-preview-bytes"]'), q(".pb-review .gs-trust"), q('[data-testid="qr-import-btn"]'), q('[data-testid="qr-discard-btn"]')];
      return els.slice(1).every((el, i) => ((els[i] as Element).compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    });
    expect(order, "board -> size -> warning -> Import -> Discard").toBe(true);
    await expect(page.getByText("Only import capsules from people you trust: a scanned code does not prove who made it.", { exact: true })).toBeVisible();
    // Details: closed by default, opens from the keyboard, metadata is inside it.
    const details = page.locator(".pb-review-details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("qr-meta-checksum")).toBeHidden();
    await page.locator(".pb-review-details > summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(page.getByTestId("qr-meta-checksum")).toBeVisible();
    await expect(page.getByTestId("qr-meta-app")).toHaveText("patchboard");
    // The controller state did not change from opening Details, and no extra scroll happened.
    await expectScanState(page, "scanned");
    expect((await scrollCalls(page)).filter((c) => c.testid === "qr-scan-panel")).toHaveLength(1);
    // Import from the keyboard (Space), exactly once.
    await qrBtn(page, "qr-import-btn").focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("import-result")).toHaveAttribute("data-import-state", "applied-saved");
    await expect(page.getByTestId("merge-summary")).toContainText("Saved on this device.");
    await expect(qrBtn(page, "qr-import-btn")).toBeHidden();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    await expect(qrBtn(page, "qr-scan-btn")).toBeFocused();
    const after = await readUiBoard(page);
    expect(after.todo.length).toBe(before.todo.length + 1);
    expect(await page.locator("li[data-card-id]").count()).toBe(1);
    expect(await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => ["fixed", "sticky"].includes(getComputedStyle(e).position) && e.getBoundingClientRect().width > 0).length)).toBe(0);
    await p.context.close();
  }
});

test("E2E-MP-PB-02: Discard returns to idle, focuses Scan QR code, drops the held capsule and changes nothing", async ({ browser }) => {
  const p = await spyProfile(browser, { width: 390, height: 664 });
  const page = p.page;
  const before = await readUiBoard(page);
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await expect(page.getByTestId("qr-review-heading")).toBeFocused();
  await press(page, qrBtn(page, "qr-discard-btn"));
  await expectScanState(page, "idle");
  await expect(qrBtn(page, "qr-scan-btn")).toBeFocused();
  await expect(qrBtn(page, "qr-import-btn")).toBeHidden();
  await expect(page.getByTestId("qr-preview")).toBeHidden();
  await expect(page.getByTestId("import-result")).not.toHaveAttribute("data-import-state", /.+/);
  expect(await readUiBoard(page)).toEqual(before);
  expect(await page.locator("li[data-card-id]").count()).toBe(0);
  // The held capsule is gone: the hidden Import button cannot be activated.
  await qrBtn(page, "qr-import-btn").evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.getByTestId("import-result")).not.toHaveAttribute("data-import-state", /.+/);
  expect(await page.locator("li[data-card-id]").count()).toBe(0);
  // A second scan reveals again (once per transition into review).
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await expect(page.getByTestId("qr-review-heading")).toBeFocused();
  expect((await scrollCalls(page)).filter((c) => c.testid === "qr-scan-panel")).toHaveLength(2);
  await p.context.close();
});

test("E2E-MP-PB-03: with reduced motion the scroll uses behavior auto and nothing animates", async ({ browser }) => {
  const p = await spyProfile(browser, { width: 390, height: 664 }, "reduce");
  const page = p.page;
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await expect(page.getByTestId("qr-review-heading")).toBeFocused();
  const calls = (await scrollCalls(page)).filter((c) => c.testid === "qr-scan-panel");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.options).toEqual({ block: "start", behavior: "auto" });
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
  const r = await rect(page, '[data-testid="qr-import-btn"]');
  expect(r.bottom).toBeLessThanOrEqual(r.inner);
  await p.context.close();
});

test("E2E-MP-PB-04: the review heading is not focused on errors, and no sticky bar exists", async ({ browser }) => {
  const p = await spyProfile(browser, { width: 390, height: 664 });
  const page = p.page;
  await scanFrame(page, capsuleFrame(new Uint8Array([1, 2, 3, 4])), "rejected");
  await expect(page.getByTestId("qr-review-heading")).not.toBeFocused();
  await expect(qrBtn(page, "qr-scan-btn")).toBeFocused();
  expect((await scrollCalls(page)).filter((c) => c.testid === "qr-scan-panel")).toHaveLength(0);
  await p.context.close();
});

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

test("E2E-MP-PB-05: first-visit hero keeps Open board high on the screen at short phone viewports and keeps the offline warnings", async ({ browser }) => {
  const report: string[] = [];
  for (const { w, h, max } of HERO) {
    const p = await heldFirstVisit(browser, { width: w, height: h });
    const page = p.page;
    await expect(page.getByRole("button", { name: "Open board", exact: true })).toBeVisible();
    await expect(page.getByTestId("first-visit-notice")).toHaveCount(1);
    await expect(page.getByTestId("offline-indicator")).toHaveAttribute("data-offline-state", "registering");
    const r = await rect(page, "form.pb-join button[type=submit]");
    const inputSize = await page.locator("#board-id").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    report.push(`${w}x${h}: Open board bottom ${Math.round(r.bottom)} (limit ${max})`);
    expect(r.bottom, `${w}x${h}`).toBeLessThanOrEqual(max);
    expect(inputSize).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByText("See how it works", { exact: true })).toBeVisible();
    await expect(page.locator("#board-hint")).toBeVisible();
    await p.context.close();
  }
  test.info().annotations.push({ type: "hero-numbers", description: report.join("; ") });
  console.log(report.join("\n"));
  // The one-online-visit warning is on the first screen of a tall phone.
  const t = await heldFirstVisit(browser, { width: 390, height: 844 });
  await expect(t.page.getByTestId("offline-indicator")).toBeInViewport();
  await expect(t.page.getByTestId("first-visit-notice")).toBeInViewport();
  await t.context.close();
});

test("E2E-MP-PB-06: with the keyboard open (short visual viewport) Board ID and Open board are both reachable and Enter opens the board", async ({ browser }) => {
  for (const vp of [{ width: 390, height: 340 }, { width: 320, height: 300 }]) {
    const p = await heldFirstVisit(browser, vp);
    const page = p.page;
    const input = page.getByLabel("Board ID");
    await input.focus();
    const i = await rect(page, "#board-id");
    expect(i.top, `${vp.width}x${vp.height} input top`).toBeGreaterThanOrEqual(0);
    expect(i.bottom, `${vp.width}x${vp.height} input bottom`).toBeLessThanOrEqual(i.inner + 1);
    const open = page.getByRole("button", { name: "Open board", exact: true });
    await open.scrollIntoViewIfNeeded();
    const o = await rect(page, "form.pb-join button[type=submit]");
    expect(o.top).toBeGreaterThanOrEqual(0);
    expect(o.bottom).toBeLessThanOrEqual(o.inner + 1);
    // After that one scroll the field is still not covered by the button.
    const i2 = await rect(page, "#board-id");
    expect(i2.bottom <= o.top || i2.top >= o.bottom).toBe(true);
    await input.fill("sprint-board");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
    await p.context.close();
  }
});

test("E2E-MP-PB-07: the app padding accounts for the notch and home indicator", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  await loadUntilOfflineReady(p.page);
  expect(await p.page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
  const css = await p.page.evaluate(() => [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join("\n"));
  expect(css).toContain("safe-area-inset-bottom");
  await p.context.close();
});

test("E2E-MP-PB-08: when the screen is too narrow for a code, the file export is one adjacent control away", async ({ browser }) => {
  const p = await qrOnlineProfile(browser, BOARD, { width: 390, height: 844 });
  const page = p.page;
  await addCardUi(page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(page);
  await expect(page.getByTestId("qr-file-instead")).toBeHidden();
  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "too-narrow");
  await expect(page.getByTestId("qr-show-message")).toHaveText("This screen is too narrow to show a code a phone can read. Use a wider screen, or use Export capsule (.gscap).");
  const fallback = page.getByRole("button", { name: "Go to file export", exact: true });
  await expect(fallback).toBeVisible();
  // It sits in the same panel, right under the message, and is a full-size target.
  const m = await rect(page, '[data-testid="qr-show-message"]');
  const b = await rect(page, '[data-testid="qr-file-instead"]');
  expect(b.top - m.bottom).toBeLessThan(24);
  expect(b.bottom - b.top).toBeGreaterThanOrEqual(43.5);
  await fallback.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#export-btn")).toBeFocused();
  await expect(page.locator("#export-btn")).toBeInViewport();
  // Hiding the code removes the shortcut again.
  await press(page, qrBtn(page, "qr-hide-btn"));
  await expect(page.getByTestId("qr-file-instead")).toBeHidden();
  await p.context.close();
});
