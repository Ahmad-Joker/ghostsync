/**
 * Kiroween redesign (hero-led) checks for FieldLedger. Real Chromium against the production build.
 * iPhone-sized runs use Chromium emulation (isMobile, hasTouch, deviceScaleFactor 3, iPhone user agent).
 * That is EV-FIXTURE evidence only: it says nothing about Safari, its toolbars or its keyboard.
 */
import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { BASE, DOC, addItemUi, awaitSaved, createDetails, join, loadUntilOfflineReady, newProfile } from "./helpers.js";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONES = [
  { w: 320, h: 568 },
  { w: 390, h: 664 },
  { w: 430, h: 739 },
  { w: 430, h: 932 },
] as const;

async function iphone(browser: Browser, w: number, h: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: IPHONE_UA });
  const page = await context.newPage();
  return { context, page };
}

/** Which readiness elements are actually visible (not clipped to a 1px box, not hidden). */
function visibleCues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vis = (el: Element | null): boolean => {
      if (el === null) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.visibility === "visible" && cs.display !== "none" && cs.clipPath === "none" && !el.closest("[hidden]");
    };
    return ["network-chip", "offline-indicator", "offline-banner"].filter((id) => vis(document.querySelector(`[data-testid="${id}"]`)));
  });
}

const box = async (page: Page, sel: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await page.locator(sel).first().boundingBox();
  if (b === null) throw new Error(`no box for ${sel}`);
  return b;
};

test("E2E-KW-FL-01: hero composition, copy, Incident ID field and one-h1 structure (desktop and phone)", async ({ browser }) => {
  for (const [vp, desktop] of [[{ width: 1280, height: 800 }, true], [{ width: 390, height: 664 }, false]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    const page = p.page;
    await page.goto("/");
    await expect(page.getByText("The checklist survives the dead zone.", { exact: true })).toBeVisible();
    await expect(page.getByText("Open an incident, work offline, share a file.", { exact: true })).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("FieldLedger");
    const field = page.getByLabel("Incident ID");
    await expect(field).toHaveCount(1);
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("placeholder", "e.g. pump-station-7");
    await expect(page.getByText("Use the same incident ID on both devices.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open incident", exact: true })).toHaveCount(1);
    await expect(page.locator("#incident-rules")).toHaveText("Both people enter the same incident ID.");
    await expect(page.locator("#incident-format")).toContainText("characters");
    await expect(page.getByTestId("transfer-mode")).toHaveText("Transfer: file (.gscap)");
    expect(await page.locator("[data-testid^=qr-]").count()).toBe(0);
    const fonts = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector(".gs-hero-title") as Element).fontFamily,
      body: getComputedStyle(document.querySelector("label[for=incident-id]") as Element).fontFamily,
      input: parseFloat(getComputedStyle(document.getElementById("incident-id") as Element).fontSize),
    }));
    expect(fonts.title).toMatch(/Iowan|Palatino|Georgia|serif/);
    expect(fonts.body).not.toMatch(/Iowan|Palatino|Georgia/);
    expect(fonts.input).toBeGreaterThanOrEqual(16);
    const art = page.locator("#hero-art");
    for (const id of ["gs-courier", "gs-phone", "gs-laptop", "gs-moon"]) await expect(art.locator(`use[href="#${id}"]`)).toHaveCount(1);
    expect(await art.locator("path[stroke-dasharray]").count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => [...document.querySelectorAll("svg")].filter((s) => s.id !== "gs-sprite" && s.getAttribute("aria-hidden") !== "true" && s.closest("[aria-hidden=true]") === null && s.querySelector("title") === null).length)).toBe(0);
    const a = await box(page, "#hero-art");
    const c = await box(page, ".fl-hero-copy");
    if (desktop) expect(c.x + c.width).toBeLessThanOrEqual(a.x + 1);
    else expect(a.y + a.height).toBeLessThanOrEqual(c.y + 1);
    await expect(page.locator("main")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    expect(await page.locator("[aria-modal], dialog[open]").count()).toBe(0);
    // Validation text still appears for a bad ID.
    await field.fill("a b");
    await page.getByRole("button", { name: "Open incident", exact: true }).click();
    await expect(page.locator("#incident-error")).not.toBeEmpty();
    await p.context.close();
  }
});

test("E2E-KW-FL-02: at iPhone sizes Incident ID and Open incident are inside the first screen; short viewport keeps the button reachable (Chromium emulation)", async ({ browser }) => {
  const report: string[] = [];
  for (const { w, h } of IPHONES) {
    const p = await iphone(browser, w, h);
    await p.page.goto("/");
    await expect(p.page.getByRole("button", { name: "Open incident", exact: true })).toBeVisible();
    const r = await p.page.evaluate(() => {
      const el = document.querySelector("form.fl-join button[type=submit]") as HTMLElement;
      const fixed = [...document.querySelectorAll("body *")].filter((e) => ["fixed", "sticky"].includes(getComputedStyle(e).position) && e.getBoundingClientRect().width > 0).map((e) => e.tagName);
      return { bottom: el.getBoundingClientRect().bottom, innerHeight: window.innerHeight, scrollY: window.scrollY, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, fixed };
    });
    report.push(`${w}x${h}: Open incident bottom ${Math.round(r.bottom)} of ${r.innerHeight}`);
    expect(r.bottom, `${w}x${h} Open incident bottom`).toBeLessThanOrEqual(r.innerHeight);
    expect(r.scrollY).toBe(0);
    expect(r.overflow, `${w}x${h} overflow`).toBeLessThanOrEqual(0);
    expect(r.fixed, `${w}x${h} fixed or sticky`).toEqual([]);
    await p.context.close();
  }
  const k = await iphone(browser, 390, 340);
  await k.page.goto("/");
  await k.page.getByLabel("Incident ID").focus();
  const open = k.page.getByRole("button", { name: "Open incident", exact: true });
  await open.scrollIntoViewIfNeeded();
  await expect(open).toBeInViewport();
  expect(await open.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top);
  })).toBe(true);
  await k.context.close();
  console.log(`E2E-KW-FL-02 report (Chromium emulation): ${report.join(" | ")}`);
});

test("E2E-KW-FL-03: See how it works reveals three illustrated steps by keyboard without stealing focus; the credit is in the guide", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  await page.goto("/");
  const see = page.getByRole("button", { name: "See how it works", exact: true });
  const guide = page.locator("#guidance");
  await expect(see).toHaveAttribute("aria-expanded", "false");
  await expect(guide).toBeHidden();
  await see.click();
  await expect(guide).toBeVisible();
  await expect(page.getByRole("button", { name: "Help", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(guide.getByRole("listitem")).toHaveCount(3);
  for (const id of ["scan", "review", "import"]) await expect(guide.locator(`use[href="#gs-courier-step-${id}"]`)).toHaveCount(1);
  await expect(guide.getByText("Built with Kiro for Kiroween", { exact: true })).toBeVisible();
  await expect(see).toBeFocused();
  await expect(page.getByLabel("Incident ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open incident", exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Close help", exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(see).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Close help", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(see).toBeFocused();
  await p.context.close();
});

test("E2E-KW-FL-04: small header, one visible readiness cue, and one offline banner driven by the real network state", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  await loadUntilOfflineReady(page);
  expect((await box(page, "header.gs-header")).height).toBeLessThanOrEqual(64);
  await expect(page.getByTestId("offline-indicator")).toHaveText("Ready to work offline.");
  await expect(page.getByTestId("network-chip")).toHaveText("Network: online");
  await expect(page.locator("#status-note")).toContainText("Online · Open an incident to start working.");
  await expect(page.getByTestId("first-visit-notice")).toBeHidden();
  expect(await visibleCues(page)).toEqual(["offline-indicator"]);
  await join(page, DOC);
  const banner = page.getByTestId("offline-banner");
  await expect(banner).toBeHidden();
  const yBefore = (await box(page, "main")).y;
  const barBefore = (await box(page, ".gs-statusbar")).height;
  await page.evaluate(() => {
    const w = window as unknown as { __lantern: Array<{ name: string; duration: string; iterations: string }> };
    w.__lantern = [];
    document.addEventListener("animationstart", (e) => {
      const cs = getComputedStyle(e.target as Element);
      w.__lantern.push({ name: e.animationName, duration: cs.animationDuration, iterations: cs.animationIterationCount });
    });
  });
  await p.context.setOffline(true);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The network vanished. Your work didn't.");
  await expect(banner).toContainText("Changes still save on this device.");
  await expect(banner.locator('use[href="#gs-courier-sm"]')).toHaveCount(1);
  expect(await banner.locator("[aria-live], [role=status], [role=alert]").count()).toBe(0);
  expect(await visibleCues(page)).toEqual(["offline-banner"]);
  await expect(page.locator("#status-note")).toContainText("Offline · Changes still save on this device");
  expect(Math.abs((await box(page, "main")).y - yBefore)).toBeLessThan(1);
  expect(Math.abs((await box(page, ".gs-statusbar")).height - barBefore)).toBeLessThan(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lantern: unknown[] }).__lantern.length)).toBe(1);
  const anim = await page.evaluate(() => (window as unknown as { __lantern: Array<{ name: string; duration: string; iterations: string }> }).__lantern[0]);
  expect(anim?.name).toBe("gs-lantern");
  expect(anim?.iterations).toBe("1");
  const seconds = Number.parseFloat(anim?.duration ?? "0");
  expect(seconds).toBeGreaterThanOrEqual(0.6);
  expect(seconds).toBeLessThanOrEqual(0.9);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await addItemUi(page, "Keep working");
  await awaitSaved(page);
  await expect(banner).toBeVisible();
  await p.context.setOffline(false);
  await expect(banner).toBeHidden();
  await p.context.close();
  // Reduced motion: the banner appears, nothing animates.
  const r = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  await r.page.emulateMedia({ reducedMotion: "reduce" });
  await loadUntilOfflineReady(r.page);
  await join(r.page, DOC);
  await r.context.setOffline(true);
  await expect(r.page.getByTestId("offline-banner")).toBeVisible();
  expect(await r.page.evaluate(() => document.getAnimations().length)).toBe(0);
  await r.page.getByRole("button", { name: "Help", exact: true }).click();
  expect(await r.page.evaluate(() => document.getAnimations().length)).toBe(0);
  await r.context.close();
  // Not ready yet: the first-visit notice shows, the indicator is the cue.
  const q = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  await q.page.addInitScript(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register = (): Promise<ServiceWorkerRegistration> => new Promise(() => undefined);
  });
  await q.page.goto("/");
  await expect(q.page.getByTestId("first-visit-notice")).toBeVisible();
  await expect(q.page.getByTestId("first-visit-notice")).toHaveText("Opening FieldLedger offline for the very first time will not work. Open it once while online.");
  expect(await visibleCues(q.page)).toEqual(["offline-indicator"]);
  await q.context.close();
});

test("E2E-KW-FL-05: the checklist is the focal point, with a text marker per row and strong completion states", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 844 } });
  const page = p.page;
  await page.goto("/");
  await join(page, DOC);
  await createDetails(page, "Burst main on Elm Street");
  await addItemUi(page, "Close the valve");
  await addItemUi(page, "Call the crew");
  const rows = page.locator('[data-testid="checklist"] > li[data-item-id]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator(".fl-record-state")).toHaveText("Open");
  await page.getByLabel("Done: Close the valve").check();
  const done = page.locator('li[data-item-id][data-done="true"]');
  await expect(done).toHaveCount(1);
  await expect(done.locator(".fl-record-state")).toHaveText("Completed");
  await expect(done.locator('input[type="text"]')).toHaveCSS("text-decoration-line", "line-through");
  await expect(page.locator('li[data-done="false"] input[type="text"]')).not.toHaveCSS("text-decoration-line", "line-through");
  expect(await page.locator('li[data-item-id]').evaluateAll((els) => els.map((e) => (e.querySelector("input[type=checkbox]") as HTMLInputElement).getAttribute("aria-label")))).toEqual(["Done: Close the valve", "Done: Call the crew"]);
  // The checklist is the largest region in view of the workspace sections.
  const areas = await page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => ({ id: s.getAttribute("aria-labelledby") ?? s.getAttribute("aria-label") ?? "", area: s.getBoundingClientRect().width * s.getBoundingClientRect().height })));
  const list = areas.find((a) => a.id === "list-h");
  expect(list).toBeDefined();
  for (const a of areas) if (a.id !== "list-h" && a.id !== "transfer-h") expect(list?.area ?? 0, a.id).toBeGreaterThan(a.area);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  await p.context.close();
});

test("E2E-KW-FL-06: long titles get room at 320 and 390, keep the full text, and nothing overflows", async ({ browser }) => {
  const title = `Valve ${"inspection-and-pressure-test ".repeat(4)}end`.slice(0, 120);
  for (const w of [320, 390]) {
    const p = await iphone(browser, w, 844);
    const page = p.page;
    await page.goto("/");
    await join(page, DOC);
    await addItemUi(page, title);
    const row = page.locator("li[data-item-id]").first();
    await expect(row.locator(".fl-record-full")).toHaveText(title);
    await expect(row.locator(".fl-record-full")).toBeVisible();
    const m = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement;
      const bad = [...main.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > 320.5 + (window.innerWidth - 320)).length;
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, bad };
    });
    expect(m.overflow, `${w} overflow`).toBeLessThanOrEqual(0);
    expect(m.bad, `${w} elements past the right edge`).toBe(0);
    await p.context.close();
  }
});

test("E2E-KW-FL-07: touch targets, 3px focus ring and no state by colour alone in the workspace (iPhone emulation)", async ({ browser }) => {
  const p = await iphone(browser, 390, 844);
  const page = p.page;
  await page.goto("/");
  await join(page, DOC);
  await createDetails(page, "Check the lamp site");
  await addItemUi(page, "Check the lamp");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, summary")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !e.closest(".sr-only");
      })
      .filter((e) => e.getBoundingClientRect().height < 43.5 || (e.getBoundingClientRect().width < 43.5))
      .map((e) => `${e.tagName}#${e.id}:${e.textContent?.slice(0, 20) ?? ""}`),
  );
  expect(small).toEqual([]);
  for (const sel of ["#new-item", "#f-notes", "#import-file", 'li[data-item-id] input[type="checkbox"]']) {
    await page.locator(sel).first().focus();
    const o = await page.locator(sel).first().evaluate((el) => ({ w: getComputedStyle(el).outlineWidth, s: getComputedStyle(el).outlineStyle }));
    expect(o.w, sel).toBe("3px");
    if (sel === "#new-item" || sel === "#f-notes") expect(o.s, sel).not.toBe("none");
  }
  await p.context.close();
});

test("E2E-KW-FL-08: offline reload keeps the hero art and the incident chooser; no requests leave the origin", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) foreign.push(r.url());
  });
  await loadUntilOfflineReady(page);
  await p.context.setOffline(true);
  await page.reload();
  await expect(page.getByText("The checklist survives the dead zone.", { exact: true })).toBeVisible();
  expect(await page.locator("#hero-art svg use").count()).toBeGreaterThan(0);
  expect((await box(page, "#hero-art svg")).width).toBeGreaterThan(0);
  await expect(page.getByLabel("Incident ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open incident", exact: true })).toBeVisible();
  expect(foreign).toEqual([]);
  await p.context.close();
});
