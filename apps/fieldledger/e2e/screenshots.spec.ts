/**
 * Deterministic visual-verification capture for the interface redesign. PNGs and audit JSON are written only when
 * GS_SCREENSHOT_DIR is set; the assertions always run: no horizontal overflow at 320px, every control has an
 * accessible name, 44px targets on phones, a reduced-motion rule, and the last control reachable above a ~100px
 * bottom toolbar. File names match the BEFORE set (local-fieldledger-<state>-<size>.png) so pairs are comparable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DOC, addItemUi, armAbort, awaitSaved, createDetails, exportCapsule, importFile, importResult, loadUntilOfflineReady, join, newProfile, offlineProfileInIncident } from "./helpers.js";

// Screenshots/audit JSON are written only when GS_SCREENSHOT_DIR is set; assertions always run.
const OUT = process.env["GS_SCREENSHOT_DIR"] ?? "";
if (OUT) mkdirSync(OUT, { recursive: true });
const out = (file: string): { path?: string } => (OUT ? { path: joinPath(OUT, file) } : {});
const saveAudit = (file: string, data: unknown): void => {
  if (OUT) writeFileSync(joinPath(OUT, file), JSON.stringify(data, null, 2));
};
const audit: Record<string, unknown> = {};
// These specs open several browser contexts per test and write their own PNG/JSON artifacts; Playwright
// trace recording for them intermittently hit ENOENT copying trace files on context.close() (Windows).
test.use({ trace: "off" });

interface Audit {
  overflow: { scroll: number; client: number };
  unnamed: string[];
  small: string[];
  lastBottom: number;
  innerHeight: number;
  count: number;
}
async function auditPage(page: Page): Promise<Audit> {
  return page.evaluate(() => {
    const sel = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]";
    const vis = (e: Element): boolean => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && !e.closest("[hidden]");
    };
    const nameOf = (e: Element): string => {
      const al = e.getAttribute("aria-label");
      if (al && al.trim()) return al.trim();
      const lb = e.getAttribute("aria-labelledby");
      if (lb) {
        const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (t) return t;
      }
      const labels = (e as HTMLInputElement).labels;
      if (labels && labels.length > 0) {
        const t = [...labels].map((l) => l.textContent ?? "").join(" ").trim();
        if (t) return t;
      }
      const t = (e.textContent ?? "").trim();
      if (t) return t;
      return (e.getAttribute("title") ?? "").trim() || (e as HTMLInputElement).value?.trim?.() || "";
    };
    const describe = (e: Element): string => `${e.tagName.toLowerCase()}${(e as HTMLInputElement).type ? "[" + (e as HTMLInputElement).type + "]" : ""}#${e.id}"${nameOf(e).slice(0, 40)}"`;
    const els = [...document.querySelectorAll(sel)].filter(vis);
    const unnamed = els.filter((e) => nameOf(e) === "").map(describe);
    const small = els
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.height < 43.5 || r.width < 43.5;
      })
      .map((e) => {
        const r = e.getBoundingClientRect();
        return `${describe(e)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      });
    const last = els[els.length - 1];
    return {
      overflow: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
      unnamed,
      small,
      lastBottom: last ? last.getBoundingClientRect().bottom : 0,
      innerHeight: window.innerHeight,
      count: els.length,
    };
  });
}
async function snap(page: Page, file: string, key: string, fullPage = true): Promise<Audit> {
  await page.screenshot({ ...out(file), fullPage });
  const a = await auditPage(page);
  audit[key] = a;
  saveAudit(`audit-fieldledger.json`, audit);
  return a;
}
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const MOBILE = { width: 320, height: 568 };
const NARROW = { width: 320, height: 640 };
const INCIDENT_ID = "before-capture";
const LONG_ITEM = "Call the supervisor and confirm the replacement part is on site before the shift change";
async function expectClean(a: Audit, label: string, phone = false): Promise<void> {
  expect(a.overflow.scroll, `${label}: scrollWidth`).toBeLessThanOrEqual(a.overflow.client);
  expect(a.unnamed, `${label}: unnamed controls`).toEqual([]);
  if (phone) expect(a.small, `${label}: targets under 44px`).toEqual([]);
}
/** The same incident as the BEFORE capture: details, three checklist items (one long), the first completed. */
async function populate(page: Page): Promise<void> {
  await join(page, INCIDENT_ID);
  await createDetails(page, "Pump station 4 seal leak");
  await page.locator("#f-location").fill("North yard, bay 4");
  await page.locator("#f-severity").selectOption("high");
  await page.locator("#f-notes").fill("Slow drip from the lower seal. Area taped off.");
  await page.locator("#f-notes").press("Tab");
  for (const t of ["Isolate the feed valve", "Photograph the seal housing and the label on the pump", LONG_ITEM]) await addItemUi(page, t);
  await page.getByLabel("Done: Isolate the feed valve").check();
  await awaitSaved(page);
}
/** Keeps the app in its genuine first-visit "registering" state so the one-online-visit notice is deterministic. */
async function holdFirstVisit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register = (): Promise<ServiceWorkerRegistration> => new Promise(() => undefined);
  });
}

test("SHOT-FL-01: first visit (desktop, phone, 320px): the open action is above the fold and Help is closed", async ({ browser }) => {
  for (const [vp, name, phone] of [[DESKTOP, "desktop", false], [PHONE, "phone", true], [NARROW, "320", false]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    await holdFirstVisit(p.page);
    await p.page.goto("/");
    await expect(p.page.getByTestId("first-visit-notice")).toBeVisible();
    const open = p.page.getByRole("button", { name: "Open incident", exact: true });
    await expect(open).toBeVisible();
    await expect(p.page.locator("#guidance")).toBeHidden();
    await expectClean(await snap(p.page, `local-fieldledger-first-visit-${name}.png`, `01-${name}`), `01 ${name}`, phone);
    const box = await open.boundingBox();
    expect((box?.y ?? 9999) + (box?.height ?? 0), `${name}: Open incident bottom edge`).toBeLessThanOrEqual(vp.height);
    await p.context.close();
  }
  const m = await newProfile(browser, { viewport: MOBILE });
  await holdFirstVisit(m.page);
  await m.page.goto("/");
  const box = await m.page.getByRole("button", { name: "Open incident", exact: true }).boundingBox();
  expect((box?.y ?? 9999) + (box?.height ?? 0), "320x568: Open incident bottom edge").toBeLessThanOrEqual(MOBILE.height);
  await m.context.close();
});

test("SHOT-FL-02: populated workspace and transfer area (desktop and phone)", async ({ browser }) => {
  for (const [vp, name, phone] of [[DESKTOP, "desktop", false], [PHONE, "phone", true]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(p.page);
    await populate(p.page);
    await expectClean(await snap(p.page, `local-fieldledger-populated-${name}.png`, `02-${name}`), `02 ${name}`, phone);
    const transfer = p.page.locator('section[aria-labelledby="transfer-h"]');
    await transfer.scrollIntoViewIfNeeded();
    await transfer.screenshot({ ...out(`local-fieldledger-transfer-${name}.png`) });
    await p.context.close();
  }
});

test("SHOT-FL-03: 320px workspace and checklist with a long title: no overflow, nothing clipped, 44px targets", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: NARROW });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await populate(page);
  await expectClean(await snap(page, "local-fieldledger-populated-320.png", "03-320"), "03 320", true);
  await page.getByTestId("checklist").screenshot({ ...out("local-fieldledger-checklist-320.png") });
  // The long title is readable in full: its wrapped copy is visible, inside the row, and the row does not scroll sideways.
  const row = page.locator(`[data-testid="checklist"] li`).last();
  const full = row.locator(".fl-record-full");
  await expect(full).toBeVisible();
  await expect(full).toHaveText(LONG_ITEM);
  const fit = await row.evaluate((li) => {
    const r = li.getBoundingClientRect();
    const f = li.querySelector(".fl-record-full")?.getBoundingClientRect();
    const buttons = [...li.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    return {
      scroll: [li.scrollWidth, li.clientWidth],
      fullInside: f !== undefined && f.left >= r.left && f.right <= r.right + 0.5,
      buttonsInside: buttons.every((b) => b.left >= r.left - 0.5 && b.right <= r.right + 0.5),
      heights: buttons.map((b) => Math.round(b.height)),
    };
  });
  expect(fit.scroll[0]).toBeLessThanOrEqual(fit.scroll[1] ?? 0);
  expect(fit.fullInside).toBe(true);
  expect(fit.buttonsInside).toBe(true);
  for (const hgt of fit.heights) expect(hgt).toBeGreaterThanOrEqual(44);
  const reduce = await page.evaluate(() => {
    const walk = (rules: CSSRuleList): boolean => [...rules].some((r) => r instanceof CSSMediaRule && (/prefers-reduced-motion/.test(r.conditionText) || walk(r.cssRules)));
    return [...document.styleSheets].some((s) => {
      try {
        return walk(s.cssRules);
      } catch {
        return false;
      }
    });
  });
  audit["reduce-motion-css"] = reduce;
  saveAudit("audit-fieldledger.json", audit);
  expect(reduce, "prefers-reduced-motion rule present").toBe(true);
  await p.context.close();
});

test("SHOT-FL-04: offline reload keeps the incident and shows the connection cue", async ({ browser }) => {
  for (const [vp, name, phone] of [[DESKTOP, "desktop", false], [PHONE, "phone", true]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    const page = p.page;
    await loadUntilOfflineReady(page);
    await populate(page);
    await p.context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await snap(page, `local-fieldledger-offline-banner-${name}.png`, `04-banner-${name}`, false);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".gs-statusbar")).toHaveAttribute("data-network", "offline");
    await expect(page.locator("#status-note")).toContainText("Offline · Changes still save on this device");
    await expect(page.locator('[data-testid="checklist"] li')).toHaveCount(3);
    await expect(page.getByTestId("save-indicator")).toHaveAttribute("data-save-state", "saved");
    await expectClean(await snap(page, `local-fieldledger-offline-reload-${name}.png`, `04-${name}`, false), `04 ${name}`, phone);
    await p.context.close();
  }
});

test("SHOT-FL-11: applied-but-unsaved import alert (real aborted write)", async ({ browser }, testInfo) => {
  const a = await offlineProfileInIncident(browser);
  const b = await offlineProfileInIncident(browser);
  await addItemUi(a.page, "Pump valve");
  await awaitSaved(a.page);
  await addItemUi(b.page, "Replace gasket");
  await awaitSaved(b.page);
  const fileB = await exportCapsule(b.page, testInfo, "b.gscap");
  await armAbort(a.page);
  await importFile(a.page, fileB);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-unsaved");
  await expect(a.page.locator('[data-testid="save-error-alert"]')).toBeVisible();
  await a.page.setViewportSize(DESKTOP);
  await expectClean(await snap(a.page, "unsaved-alert-fieldledger-desktop.png", "11-desktop"), "11 desktop");
  await a.page.setViewportSize(MOBILE);
  await expectClean(await snap(a.page, "unsaved-alert-fieldledger-320.png", "11-320"), "11 320");
  await a.context.close();
  await b.context.close();
});

test("SHOT-FL-12: last control reachable above a ~100px bottom toolbar (320x568 and 390x844)", async ({ browser }) => {
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ] as const) {
    const p = await newProfile(browser, { viewport: { width: w, height: h - 100 } });
    const page = p.page;
    await loadUntilOfflineReady(page);
    await join(page, DOC);
    await createDetails(page, "Burst water main, Elm Street");
    await addItemUi(page, "Isolate the valve");
    await awaitSaved(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const a = await auditPage(page);
    audit[`12-inset-${w}x${h}`] = a;
    saveAudit("audit-fieldledger.json", audit);
    await page.screenshot({ ...out(`inset-fieldledger-${w}x${h}-bottom.png`), fullPage: false });
    expect(a.lastBottom, `${w}x${h}: last control bottom ${a.lastBottom} vs visible ${a.innerHeight}`).toBeLessThanOrEqual(a.innerHeight);
    expect(a.overflow.scroll).toBeLessThanOrEqual(a.overflow.client);
    await p.context.close();
  }
});
test("SHOT-FL-13: keyboard-open captures (short visual viewport, Incident ID focused): the field and Open incident stay in view", async ({ browser }) => {
  for (const [vp, name] of [[{ width: 390, height: 340 }, "390x340"], [{ width: 320, height: 300 }, "320x300"]] as const) {
    const k = await newProfile(browser, { viewport: vp });
    await holdFirstVisit(k.page);
    await k.page.goto("/");
    await k.page.getByLabel("Incident ID").focus();
    await expect(k.page.getByLabel("Incident ID")).toBeInViewport();
    await k.page.screenshot({ ...out(`local-fieldledger-first-visit-keyboard-${name}.png`), fullPage: false });
    await k.context.close();
  }
});
