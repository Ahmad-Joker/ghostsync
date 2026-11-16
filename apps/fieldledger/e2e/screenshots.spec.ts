/**
 * Deterministic visual-verification capture for the Kiroween UI polish. Writes PNGs and an audit JSON
 * to .agents/tasks/ui-polish/screenshots (untracked).
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
const MOBILE = { width: 320, height: 568 };
async function expectClean(a: Audit, label: string): Promise<void> {
  expect(a.overflow.scroll, `${label}: scrollWidth`).toBeLessThanOrEqual(a.overflow.client);
  expect(a.unnamed, `${label}: unnamed controls`).toEqual([]);
}
async function fill(page: Page): Promise<void> {
  await createDetails(page, "Burst water main, Elm Street");
  await addItemUi(page, "Isolate the valve");
  await addItemUi(page, "Photograph the damage");
  await addItemUi(page, "Notify the duty engineer");
  await page.getByRole("checkbox").first().check();
  await awaitSaved(page);
}

test("SHOT-FL-07: first-time guidance (desktop and 320px)", async ({ browser }) => {
  const d = await newProfile(browser, { viewport: { width: 1280, height: 800 } });
  await d.page.goto("/");
  await expect(d.page.locator("#guidance")).toBeVisible();
  await expectClean(await snap(d.page, "07-fieldledger-guidance-desktop.png", "07-desktop"), "07 desktop");
  await d.context.close();
  const m = await newProfile(browser, { viewport: MOBILE });
  await m.page.goto("/");
  await expect(m.page.locator("#guidance")).toBeVisible();
  await expectClean(await snap(m.page, "07-fieldledger-guidance-320.png", "07-320"), "07 320");
  await m.context.close();
});

test("SHOT-FL-08: desktop workspace", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 1280, height: 800 } });
  await loadUntilOfflineReady(p.page);
  await join(p.page, DOC);
  await fill(p.page);
  await expectClean(await snap(p.page, "08-fieldledger-desktop-workspace.png", "08-desktop"), "08");
  await p.context.close();
});

test("SHOT-FL-09/10: 320px workspace and offline-ready state", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: MOBILE });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, DOC);
  await fill(page);
  await expectClean(await snap(page, "09-fieldledger-320-workspace.png", "09-320"), "09");
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ ...out(`10-fieldledger-320-offline-ready-top.png`), fullPage: false });
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
  saveAudit(`audit-fieldledger.json`, audit);
  expect(reduce, "prefers-reduced-motion rule present").toBe(true);
  await p.context.close();
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
  await a.page.setViewportSize({ width: 1280, height: 800 });
  await expectClean(await snap(a.page, "11-fieldledger-unsaved-alert-desktop.png", "11-desktop"), "11 desktop");
  await a.page.setViewportSize(MOBILE);
  await expectClean(await snap(a.page, "11-fieldledger-unsaved-alert-320.png", "11-320"), "11 320");
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
    await fill(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const a = await auditPage(page);
    audit[`12-inset-${w}x${h}`] = a;
    saveAudit(`audit-fieldledger.json`, audit);
    await page.screenshot({ ...out(`12-fieldledger-inset-${w}x${h}-bottom.png`), fullPage: false });
    expect(a.lastBottom, `${w}x${h}: last control bottom ${a.lastBottom} vs visible ${a.innerHeight}`).toBeLessThanOrEqual(a.innerHeight);
    expect(a.overflow.scroll).toBeLessThanOrEqual(a.overflow.client);
    await p.context.close();
  }
});
