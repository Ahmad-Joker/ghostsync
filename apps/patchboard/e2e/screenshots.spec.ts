/**
 * Deterministic visual-verification capture for the Kiroween UI polish. Writes PNGs and an audit JSON
 * to .agents/tasks/ui-polish/screenshots (untracked). Assertions: no horizontal overflow at 320px,
 * every control has an accessible name, reduce-motion CSS exists, last control reachable above a
 * ~100px emulated bottom browser toolbar.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { addCardUi, awaitSaved, btn, join, loadUntilOfflineReady, newProfile } from "./helpers.js";
import { addFakeCamera, capsuleFrame, qrOnlineProfile, setCameraFrame } from "./camera.js";
import { expectScanState, peerCapsule, qrBtn, scanFrame, showPanel } from "./qr-fixtures.js";
import { press } from "./helpers.js";

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
  saveAudit(`audit-patchboard.json`, audit);
  return a;
}
const MOBILE = { width: 320, height: 568 };
async function expectClean(a: Audit, label: string): Promise<void> {
  expect(a.overflow.scroll, `${label}: scrollWidth`).toBeLessThanOrEqual(a.overflow.client);
  expect(a.unnamed, `${label}: unnamed controls`).toEqual([]);
}

test("SHOT-PB-01: first-time guidance (desktop and 320px)", async ({ browser }) => {
  const d = await newProfile(browser, { viewport: { width: 1280, height: 800 } });
  await d.page.goto("/");
  await expect(d.page.locator("#guidance")).toBeVisible();
  await expectClean(await snap(d.page, "01-patchboard-guidance-desktop.png", "01-desktop"), "01 desktop");
  await d.context.close();
  const m = await newProfile(browser, { viewport: MOBILE });
  await m.page.goto("/");
  await expect(m.page.locator("#guidance")).toBeVisible();
  const a = await snap(m.page, "01-patchboard-guidance-320.png", "01-320");
  await expectClean(a, "01 320");
  await m.context.close();
});

test("SHOT-PB-02: desktop workspace with cards in every column", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 1280, height: 800 } });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, "sprint-board");
  await addCardUi(page, "Draft spec v1", "Outline plus risks");
  await addCardUi(page, "Review notes", "Check with the field team");
  await addCardUi(page, "Ship the offline build");
  await btn(page, "Move to Doing: Review notes").click();
  await btn(page, "Move to Doing: Ship the offline build").click();
  await btn(page, "Move to Done: Ship the offline build").click();
  await awaitSaved(page);
  await expectClean(await snap(page, "02-patchboard-desktop-workspace.png", "02-desktop"), "02");
  await p.context.close();
});

test("SHOT-PB-03/04: 320px workspace and offline-ready state", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: MOBILE });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, "sprint-board");
  await page.getByRole("button", { name: "Start working", exact: true }).click().catch(() => undefined);
  await addCardUi(page, "Draft spec v1", "Outline plus risks");
  await addCardUi(page, "Review notes");
  await btn(page, "Move to Doing: Review notes").click();
  await awaitSaved(page);
  await expectClean(await snap(page, "03-patchboard-320-workspace.png", "03-320"), "03");
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await expect(page.getByTestId("offline-indicator")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ ...out(`04-patchboard-320-offline-ready-top.png`), fullPage: false });
  await page.getByTestId("offline-indicator").scrollIntoViewIfNeeded();
  await page.screenshot({ ...out(`04-patchboard-320-offline-ready-indicator.png`), fullPage: false });
  const reduce = await page.evaluate(() => {
    const walk = (rules: CSSRuleList): boolean => [...rules].some((r) => (r instanceof CSSMediaRule && (/prefers-reduced-motion/.test(r.conditionText) || walk(r.cssRules))));
    return [...document.styleSheets].some((s) => {
      try {
        return walk(s.cssRules);
      } catch {
        return false;
      }
    });
  });
  audit["reduce-motion-css"] = reduce;
  saveAudit(`audit-patchboard.json`, audit);
  expect(reduce, "prefers-reduced-motion rule present").toBe(true);
  await p.context.close();
});

test("SHOT-PB-05/06: QR sharing panel and scanned-capsule review (camera stub)", async ({ browser }) => {
  const p = await qrOnlineProfile(browser, "sprint-board", { width: 1280, height: 800 });
  const page = p.page;
  await addCardUi(page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(page);
  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "ready");
  await expectClean(await snap(page, "05-patchboard-qr-sharing-desktop.png", "05-desktop"), "05 desktop");
  await p.context.close();
  // At 320px the code is intentionally not drawn (too small to scan); the panel explains this.
  const m = await qrOnlineProfile(browser, "sprint-board", MOBILE);
  await addCardUi(m.page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(m.page);
  await press(m.page, qrBtn(m.page, "qr-show-btn"));
  await expect(showPanel(m.page)).toHaveAttribute("data-qr-state", "too-narrow");
  await expectClean(await snap(m.page, "05-patchboard-qr-too-narrow-320.png", "05-320-too-narrow"), "05 320");
  await m.context.close();
  const m2 = await qrOnlineProfile(browser, "sprint-board", { width: 768, height: 1024 });
  await addCardUi(m2.page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(m2.page);
  await press(m2.page, qrBtn(m2.page, "qr-show-btn"));
  await expect(showPanel(m2.page)).toHaveAttribute("data-qr-state", "ready");
  await snap(m2.page, "05-patchboard-qr-sharing-768.png", "05-768");
  await m2.context.close();

  const s = await qrOnlineProfile(browser, "sprint-board", { width: 1280, height: 800 });
  await scanFrame(s.page, capsuleFrame(await peerCapsule()));
  await expect(qrBtn(s.page, "qr-import-btn")).toBeVisible();
  await expectClean(await snap(s.page, "06-patchboard-scanned-review-desktop.png", "06-desktop"), "06 desktop");
  await s.context.close();
  const sm = await qrOnlineProfile(browser, "sprint-board", MOBILE);
  await scanFrame(sm.page, capsuleFrame(await peerCapsule()));
  await expect(qrBtn(sm.page, "qr-import-btn")).toBeVisible();
  await expectClean(await snap(sm.page, "06-patchboard-scanned-review-320.png", "06-320"), "06 320");
  await sm.page.getByTestId("qr-scan-panel").screenshot({ ...out(`06-patchboard-scanned-review-320-panel.png`) });
  await sm.context.close();
});

test("SHOT-PB-12: last control reachable above a ~100px bottom toolbar (320x568 and 390x844)", async ({ browser }) => {
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ] as const) {
    const p = await newProfile(browser, { viewport: { width: w, height: h - 100 } });
    const page = p.page;
    await addFakeCamera(p.context);
    await loadUntilOfflineReady(page);
    await join(page, "sprint-board");
    await addCardUi(page, "Draft spec v1", "Outline plus risks");
    await awaitSaved(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const a = await auditPage(page);
    audit[`12-inset-${w}x${h}`] = a;
    saveAudit(`audit-patchboard.json`, audit);
    await page.screenshot({ ...out(`12-patchboard-inset-${w}x${h}-bottom.png`), fullPage: false });
    expect(a.lastBottom, `${w}x${h}: last control bottom ${a.lastBottom} vs visible ${a.innerHeight}`).toBeLessThanOrEqual(a.innerHeight);
    expect(a.overflow.scroll).toBeLessThanOrEqual(a.overflow.client);
    await p.context.close();
  }
});

async function failedEdit(page: Page): Promise<void> {
  await addCardUi(page, "Pump leak");
  await awaitSaved(page);
  await press(page, btn(page, "Edit card: Pump leak"));
  // Same real failure as E2E-PB-13: a 121-character title set programmatically is rejected by the adapter.
  await page.getByTestId("card-edit-form").getByLabel("Title").evaluate((el, v) => {
    (el as HTMLInputElement).value = v;
  }, "y".repeat(121));
  await press(page, btn(page, "Save card: Pump leak"));
  const alert = page.getByTestId("edit-error-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Your edit was NOT applied");
  await expect(page.locator(`li[data-card-id] [data-testid="card-title"]`).first()).toHaveText("Pump leak");
}
test("SHOT-PB-13: failed-edit alert keeps the last good board visible (desktop and 320px)", async ({ browser }) => {
  const d = await newProfile(browser, { viewport: { width: 1280, height: 800 } });
  await loadUntilOfflineReady(d.page);
  await join(d.page, "sprint-board");
  await failedEdit(d.page);
  await expectClean(await snap(d.page, "13-patchboard-failed-edit-desktop.png", "13-desktop"), "13 desktop");
  await d.context.close();
  const m = await newProfile(browser, { viewport: MOBILE });
  await loadUntilOfflineReady(m.page);
  await join(m.page, "sprint-board");
  await failedEdit(m.page);
  await expectClean(await snap(m.page, "13-patchboard-failed-edit-320.png", "13-320"), "13 320");
  await m.context.close();
});
test("SHOT-PB-14: QR scan in progress with the framing overlay (desktop and 320px)", async ({ browser }) => {
  for (const [vp, file, key] of [
    [{ width: 1280, height: 800 }, "14-patchboard-scan-in-progress-desktop.png", "14-desktop"],
    [MOBILE, "14-patchboard-scan-in-progress-320.png", "14-320"],
  ] as const) {
    const p = await qrOnlineProfile(browser, "sprint-board", vp);
    await setCameraFrame(p.page, undefined);
    await press(p.page, qrBtn(p.page, "qr-scan-btn"));
    await expectScanState(p.page, "scanning");
    await expect(p.page.getByTestId("qr-video")).toBeVisible();
    await expect(qrBtn(p.page, "qr-scan-cancel")).toBeVisible();
    await p.page.getByTestId("qr-scan-panel").scrollIntoViewIfNeeded();
    await expectClean(await snap(p.page, file, key), key);
    await p.context.close();
  }
});
