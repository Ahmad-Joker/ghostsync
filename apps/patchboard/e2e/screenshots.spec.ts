/**
 * Deterministic visual-verification capture for the interface redesign. PNGs and audit JSON are written only when
 * GS_SCREENSHOT_DIR is set; the assertions always run: no horizontal overflow at 320px, every control has an
 * accessible name, a reduced-motion rule exists, and the last control stays reachable above a ~100px bottom toolbar.
 * File names match the BEFORE set (local-patchboard-<state>-<size>.png) so each pair is directly comparable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { addCardUi, armAbort, awaitSaved, btn, join, loadUntilOfflineReady, newProfile, press } from "./helpers.js";
import { addFakeCamera, capsuleFrame, qrOnlineProfile, setCameraFrame } from "./camera.js";
import { expectScanState, peerCapsule, qrBtn, scanFrame, showPanel } from "./qr-fixtures.js";

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

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 664 }; // iPhone-sized viewport with the Safari toolbars showing
const TALL = { width: 430, height: 932 };
const MOBILE = { width: 320, height: 568 };
const BOARD_ID = "before-capture";

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
  saveAudit("audit-patchboard.json", audit);
  return a;
}
async function expectClean(a: Audit, label: string, phone = false): Promise<void> {
  expect(a.overflow.scroll, `${label}: scrollWidth`).toBeLessThanOrEqual(a.overflow.client);
  expect(a.unnamed, `${label}: unnamed controls`).toEqual([]);
  if (phone) expect(a.small, `${label}: targets under 44px`).toEqual([]);
}

/** Four cards in three columns, the same data as the BEFORE capture. */
async function populate(page: Page): Promise<void> {
  await join(page, BOARD_ID);
  await addCardUi(page, "Check generator fuel", "Before the night shift");
  await addCardUi(page, "Replace relay board", "Spare is in locker 4");
  await addCardUi(page, "Log sensor readings");
  await addCardUi(page, "Brief the night crew", "Ten minutes at 18:00");
  await btn(page, "Move to Doing: Replace relay board").click();
  await btn(page, "Move to Doing: Log sensor readings").click();
  await btn(page, "Move to Done: Brief the night crew").click();
  await awaitSaved(page);
}
/** Keeps the app in its genuine first-visit "registering" state so the one-online-visit notice is deterministic. */
async function holdFirstVisit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register = (): Promise<ServiceWorkerRegistration> => new Promise(() => undefined);
  });
}
async function firstVisit(browser: Browser, vp: { width: number; height: number }, file: string, key: string): Promise<Audit> {
  const p = await newProfile(browser, { viewport: vp });
  await holdFirstVisit(p.page);
  await p.page.goto("/");
  await expect(p.page.getByTestId("first-visit-notice")).toBeVisible();
  await expect(p.page.getByRole("button", { name: "Open board", exact: true })).toBeVisible();
  const a = await snap(p.page, file, key);
  await p.context.close();
  return a;
}

test("SHOT-PB-01: first visit (desktop, phone, 320px): the open action is above the fold and Help is closed", async ({ browser }) => {
  await expectClean(await firstVisit(browser, DESKTOP, "local-patchboard-first-visit-desktop.png", "01-desktop"), "01 desktop");
  await expectClean(await firstVisit(browser, PHONE, "local-patchboard-first-visit-phone.png", "01-phone"), "01 phone", true);
  await expectClean(await firstVisit(browser, TALL, "local-patchboard-first-visit-tall.png", "01-tall"), "01 tall", true);
  await expectClean(await firstVisit(browser, MOBILE, "local-patchboard-first-visit-320.png", "01-320"), "01 320");
  for (const [vp, label] of [[PHONE, "390x664"], [TALL, "430x932"], [MOBILE, "320x568"]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    await holdFirstVisit(p.page);
    await p.page.goto("/");
    const open = p.page.getByRole("button", { name: "Open board", exact: true });
    await expect(open).toBeVisible();
    const box = await open.boundingBox();
    expect((box?.y ?? 9999) + (box?.height ?? 0), `${label}: Open board bottom edge`).toBeLessThanOrEqual(vp.height);
    await expect(p.page.locator("#guidance")).toBeHidden();
    await p.context.close();
  }
});

test("SHOT-PB-02: populated workspace and transfer area (desktop and phone)", async ({ browser }) => {
  for (const [vp, name, phone] of [[DESKTOP, "desktop", false], [PHONE, "phone", true], [TALL, "tall", true]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(p.page);
    await populate(p.page);
    await expectClean(await snap(p.page, `local-patchboard-populated-${name}.png`, `02-${name}`), `02 ${name}`, phone);
    const transfer = p.page.locator('section[aria-labelledby="transfer-h"]');
    await transfer.scrollIntoViewIfNeeded();
    await transfer.screenshot({ ...out(`local-patchboard-transfer-${name}.png`) });
    await p.context.close();
  }
});

test("SHOT-PB-03: 320px workspace has no overflow and a reduced-motion rule exists", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: MOBILE });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await populate(page);
  await expectClean(await snap(page, "local-patchboard-populated-320.png", "03-320"), "03 320", true);
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
  saveAudit("audit-patchboard.json", audit);
  expect(reduce, "prefers-reduced-motion rule present").toBe(true);
  await p.context.close();
});

test("SHOT-PB-04: offline reload keeps the board and shows the connection cue without moving the layout", async ({ browser }) => {
  for (const [vp, name, phone] of [[DESKTOP, "desktop", false], [PHONE, "phone", true]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    const page = p.page;
    await loadUntilOfflineReady(page);
    await populate(page);
    const bar = page.locator(".gs-statusbar");
    await expect(bar).toHaveAttribute("data-network", "online");
    const before = await bar.boundingBox();
    await p.context.setOffline(true);
    // Right after going offline: one compact banner with the courier, no layout shift.
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await snap(page, `local-patchboard-offline-banner-${name}.png`, `04-banner-${name}`, false);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
    await expect(page.locator("li[data-card-id]")).toHaveCount(4);
    await expect(bar).toHaveAttribute("data-network", "offline");
    await expect(page.getByTestId("network-chip")).toHaveText("Network: offline");
    await expect(page.locator("#status-note")).toContainText("Offline · Changes still save on this device");
    const after = await bar.boundingBox();
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0)), `${name}: status bar height change online -> offline`).toBeLessThan(1);
    await expect(page.getByTestId("save-indicator")).toHaveAttribute("data-save-state", "saved");
    await expectClean(await snap(page, `local-patchboard-offline-reload-${name}.png`, `04-${name}`, false), `04 ${name}`, phone);
    await p.context.close();
  }
});

test("SHOT-PB-05: QR display (desktop), too-narrow file fallback (320px)", async ({ browser }) => {
  const p = await qrOnlineProfile(browser, "sprint-board", DESKTOP);
  await addCardUi(p.page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(p.page);
  await press(p.page, qrBtn(p.page, "qr-show-btn"));
  await expect(showPanel(p.page)).toHaveAttribute("data-qr-state", "ready");
  await expectClean(await snap(p.page, "local-patchboard-qr-display-desktop.png", "05-desktop"), "05 desktop");
  await p.page.getByTestId("qr-transfer").screenshot({ ...out("local-patchboard-qr-display-desktop-panel.png") });
  await p.context.close();
  const m = await qrOnlineProfile(browser, "sprint-board", MOBILE);
  await addCardUi(m.page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(m.page);
  await press(m.page, qrBtn(m.page, "qr-show-btn"));
  await expect(showPanel(m.page)).toHaveAttribute("data-qr-state", "too-narrow");
  await expectClean(await snap(m.page, "local-patchboard-qr-too-narrow-320.png", "05-320"), "05 320", true);
  await m.context.close();
});

test("SHOT-PB-06: QR scan review, then import shows the result next to the board (desktop and 320px)", async ({ browser }) => {
  const s = await qrOnlineProfile(browser, "sprint-board", DESKTOP);
  await scanFrame(s.page, capsuleFrame(await peerCapsule()));
  await expect(qrBtn(s.page, "qr-import-btn")).toBeVisible();
  await expect(s.page.getByTestId("qr-scan-panel").locator(".gs-trust")).toBeVisible();
  await expectClean(await snap(s.page, "local-patchboard-qr-review-desktop.png", "06-desktop"), "06 desktop");
  await s.page.getByTestId("qr-scan-panel").screenshot({ ...out("local-patchboard-qr-review-desktop-panel.png") });
  await press(s.page, qrBtn(s.page, "qr-import-btn"));
  await expect(s.page.getByTestId("import-result")).toHaveAttribute("data-import-state", "applied-saved");
  await expect(s.page.getByTestId("merge-summary")).toContainText("Imported:");
  await expect(s.page.getByTestId("merge-summary")).toContainText("Saved on this device.");
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await expectClean(await snap(s.page, "local-patchboard-qr-imported-desktop.png", "06-imported-desktop", false), "06 imported");
  await s.context.close();
  const sm = await qrOnlineProfile(browser, "sprint-board", MOBILE);
  await scanFrame(sm.page, capsuleFrame(await peerCapsule()));
  await expect(qrBtn(sm.page, "qr-import-btn")).toBeVisible();
  await expectClean(await snap(sm.page, "local-patchboard-qr-review-320.png", "06-320"), "06 320", true);
  await sm.page.getByTestId("qr-scan-panel").screenshot({ ...out("local-patchboard-qr-review-320-panel.png") });
  await sm.context.close();
  for (const [vp, name] of [[PHONE, "phone"], [TALL, "tall"]] as const) {
    const ph = await qrOnlineProfile(browser, "sprint-board", vp);
    await scanFrame(ph.page, capsuleFrame(await peerCapsule()));
    await expect(qrBtn(ph.page, "qr-import-btn")).toBeVisible();
    await expectClean(await snap(ph.page, `local-patchboard-qr-review-${name}.png`, `06-${name}`), `06 ${name}`, true);
    await ph.page.getByTestId("qr-scan-panel").screenshot({ ...out(`local-patchboard-qr-review-${name}-panel.png`) });
    await press(ph.page, qrBtn(ph.page, "qr-import-btn"));
    await expect(ph.page.getByTestId("import-result")).toHaveAttribute("data-import-state", "applied-saved");
    await expectClean(await snap(ph.page, `local-patchboard-qr-imported-${name}.png`, `06-imported-${name}`), `06 imported ${name}`, true);
    await ph.context.close();
  }
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
    saveAudit("audit-patchboard.json", audit);
    await page.screenshot({ ...out(`inset-patchboard-${w}x${h}-bottom.png`), fullPage: false });
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
  for (const [vp, name] of [[DESKTOP, "desktop"], [MOBILE, "320"]] as const) {
    const d = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(d.page);
    await join(d.page, "sprint-board");
    await failedEdit(d.page);
    await expectClean(await snap(d.page, `failed-edit-patchboard-${name}.png`, `13-${name}`), `13 ${name}`);
    await d.context.close();
  }
});

test("SHOT-PB-14: QR scan in progress with the framing guide (desktop and 320px)", async ({ browser }) => {
  for (const [vp, name] of [[DESKTOP, "desktop"], [MOBILE, "320"]] as const) {
    const p = await qrOnlineProfile(browser, "sprint-board", vp);
    await setCameraFrame(p.page, undefined);
    await press(p.page, qrBtn(p.page, "qr-scan-btn"));
    await expectScanState(p.page, "scanning");
    await expect(p.page.getByTestId("qr-video")).toBeVisible();
    await expect(qrBtn(p.page, "qr-scan-cancel")).toBeVisible();
    await p.page.getByTestId("qr-scan-panel").scrollIntoViewIfNeeded();
    await expectClean(await snap(p.page, `scan-in-progress-patchboard-${name}.png`, `14-${name}`), `14 ${name}`);
    await p.context.close();
  }
});

test("SHOT-PB-15: failed save with the recovery actions (desktop, phone, 320px)", async ({ browser }) => {
  for (const [vp, name, phone] of [[DESKTOP, "desktop", false], [PHONE, "phone", true], [MOBILE, "320", true]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(p.page);
    await join(p.page, "sprint-board");
    await armAbort(p.page);
    await p.page.getByLabel("New card title").fill("Unsaved card");
    await press(p.page, btn(p.page, "Add card"));
    await expect(p.page.getByTestId("save-error-alert")).toBeVisible();
    await expect(p.page.getByTestId("save-indicator")).toHaveAttribute("data-save-state", "error");
    await expectClean(await snap(p.page, `failed-save-patchboard-${name}.png`, `15-${name}`), `15 ${name}`, phone);
    await p.context.close();
  }
});

test("SHOT-PB-16: QR sender on the white stage (phone-width screens use the file fallback)", async ({ browser }) => {
  const p = await qrOnlineProfile(browser, "sprint-board", { width: 1024, height: 800 });
  await addCardUi(p.page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(p.page);
  await press(p.page, qrBtn(p.page, "qr-show-btn"));
  await expect(showPanel(p.page)).toHaveAttribute("data-qr-state", "ready");
  await p.page.getByTestId("qr-show-panel").scrollIntoViewIfNeeded();
  await p.page.getByTestId("qr-show-panel").screenshot({ ...out("local-patchboard-qr-sender-stage.png") });
  await p.context.close();
});

test("SHOT-PB-17: mobile pass viewport captures (hero, keyboard open, review after scroll and focus, phone sender)", async ({ browser }) => {
  const hero = await newProfile(browser, { viewport: PHONE });
  await holdFirstVisit(hero.page);
  await hero.page.goto("/");
  await expect(hero.page.getByTestId("first-visit-notice")).toBeVisible();
  await hero.page.screenshot({ ...out("local-patchboard-first-visit-phone-viewport.png"), fullPage: false });
  await hero.context.close();
  for (const [vp, name] of [[{ width: 390, height: 340 }, "390x340"], [{ width: 320, height: 300 }, "320x300"]] as const) {
    const k = await newProfile(browser, { viewport: vp });
    await holdFirstVisit(k.page);
    await k.page.goto("/");
    await k.page.getByLabel("Board ID").focus();
    await k.page.screenshot({ ...out(`local-patchboard-first-visit-keyboard-${name}.png`), fullPage: false });
    await k.context.close();
  }
  for (const [vp, name] of [[PHONE, "phone"], [MOBILE, "320"]] as const) {
    const r = await qrOnlineProfile(browser, "sprint-board", vp);
    await scanFrame(r.page, capsuleFrame(await peerCapsule()));
    await expect(r.page.getByTestId("qr-review-heading")).toBeFocused();
    await expect
      .poll(() => r.page.evaluate(() => Math.abs((document.querySelector('[data-testid="qr-scan-panel"]') as HTMLElement).getBoundingClientRect().top) <= 1 && (document.querySelector('[data-testid="qr-discard-btn"]') as HTMLElement).getBoundingClientRect().bottom <= window.innerHeight))
      .toBe(true);
    await r.page.screenshot({ ...out(`local-patchboard-qr-review-${name}-viewport.png`), fullPage: false });
    await r.context.close();
  }
  const s = await qrOnlineProfile(browser, "sprint-board", PHONE);
  await addCardUi(s.page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(s.page);
  await press(s.page, qrBtn(s.page, "qr-show-btn"));
  await expect(showPanel(s.page)).not.toHaveAttribute("data-qr-state", "idle");
  await s.page.getByTestId("qr-show-panel").scrollIntoViewIfNeeded();
  await s.page.getByTestId("qr-show-panel").screenshot({ ...out("local-patchboard-qr-sender-stage-phone.png") });
  await s.context.close();
});