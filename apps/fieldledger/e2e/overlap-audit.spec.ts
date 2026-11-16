/**
 * Decorative-effect overlap audit (Kiroween UI polish) and checklist-row layout check for FieldLedger.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DOC, addItemUi, armAbort, awaitSaved, createDetails, exportCapsule, importFile, importResult, join, loadUntilOfflineReady, newProfile, offlineProfileInIncident } from "./helpers.js";
import { auditOverlap } from "./overlap.js";
import type { OverlapResult } from "./overlap.js";

const OUT = process.env["GS_SCREENSHOT_DIR"] ?? "";
const results: Record<string, OverlapResult> = {};
test.use({ trace: "off" });
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 320, height: 568 };

async function check(page: Page, key: string): Promise<void> {
  const r = await auditOverlap(page);
  results[key] = r;
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(joinPath(OUT, "overlap-audit-fieldledger.json"), JSON.stringify(results, null, 2));
  }
  expect(r.checkedElements, `${key}: elements checked`).toBeGreaterThan(3);
  expect(r.hitFailures, `${key}: covered elements`).toEqual([]);
  expect(r.pseudoFailures, `${key}: decorative layers`).toEqual([]);
  expect(r.qrFailures, `${key}: QR effects`).toEqual([]);
}
async function fill(page: Page): Promise<void> {
  await createDetails(page, "Burst water main, Elm Street");
  await addItemUi(page, "Isolate the valve");
  await addItemUi(page, "Photograph the damage");
  await addItemUi(page, "Notify the duty engineer");
  await page.getByRole("checkbox").first().check();
  await awaitSaved(page);
}

for (const [name, vp] of [
  ["desktop", DESKTOP],
  ["320", MOBILE],
] as const) {
  test(`E2E-FL-OVL-${name}: decorative effects never cover content (guidance, workspace, unsaved alert)`, async ({ browser }) => {
    const g = await newProfile(browser, { viewport: vp });
    await g.page.goto("/");
    await expect(g.page.locator("#guidance")).toBeVisible();
    await check(g.page, `guidance-${name}`);
    await g.context.close();
    const p = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(p.page);
    await join(p.page, DOC);
    await fill(p.page);
    await check(p.page, `workspace-${name}`);
    await p.context.close();
    const a = await offlineProfileInIncident(browser);
    const b = await offlineProfileInIncident(browser);
    await addItemUi(a.page, "Pump valve");
    await awaitSaved(a.page);
    await addItemUi(b.page, "Replace gasket");
    await awaitSaved(b.page);
    const fileB = await exportCapsule(b.page, test.info(), "b.gscap");
    await armAbort(a.page);
    await importFile(a.page, fileB);
    await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-unsaved");
    await expect(a.page.locator('[data-testid="save-error-alert"]')).toBeVisible();
    await a.page.setViewportSize(vp);
    await check(a.page, `unsaved-alert-${name}`);
    await a.context.close();
    await b.context.close();
  });
}

for (const [name, vp] of [
  ["320", MOBILE],
  ["390", { width: 390, height: 844 }],
  ["desktop", DESKTOP],
] as const) {
  test(`E2E-FL-ROW-${name}: checklist row actions share a consistent layout, no overflow, targets >= 44px`, async ({ browser }) => {
    const p = await newProfile(browser, { viewport: vp });
    await loadUntilOfflineReady(p.page);
    await join(p.page, DOC);
    await fill(p.page);
    await addItemUi(p.page, "A much longer checklist item title that must not push the row buttons out of the viewport at all");
    const info = await p.page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="checklist"] > li.fl-record')];
      return {
        overflow: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        rows: rows.map((li) => {
          const box = (e: Element): { x: number; y: number; w: number; h: number; r: number } => {
            const r = e.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right };
          };
          const kids = [...li.children];
          return {
            li: box(li),
            order: kids.map((k) => k.tagName.toLowerCase() + ":" + (k.getAttribute("aria-label") ?? k.textContent ?? "").split(":")[0]),
            parts: kids.map((k) => box(k)),
            scroll: [li.scrollWidth, li.clientWidth],
          };
        }),
      };
    });
    expect(info.overflow[0]).toBeLessThanOrEqual(info.overflow[1] ?? 0);
    expect(info.rows.length).toBe(4);
    for (const row of info.rows) {
      expect([row.order[0], row.order[1], row.order[3], row.order[4], row.order[5]]).toEqual(["input:Done", "input:Item text", "button:Move up", "button:Move down", "button:Delete item"]);
      expect(row.order[2]).toMatch(/^span:/);
      expect(row.scroll[0]).toBeLessThanOrEqual(row.scroll[1] ?? 0);
      const [, text, , up, down, del] = row.parts;
      for (const b of [up, down, del]) {
        expect(b?.h ?? 0).toBeGreaterThanOrEqual(43.5);
        expect(b?.r ?? 0).toBeLessThanOrEqual(row.li.r + 0.5);
      }
      expect(text?.h ?? 0).toBeGreaterThanOrEqual(43.5);
      if (name !== "desktop") {
        // Stacked layout: title above the chip, the three buttons share one line with equal widths and equal gaps.
        expect(Math.abs((up?.y ?? 0) - (down?.y ?? 1))).toBeLessThan(1);
        expect(Math.abs((down?.y ?? 0) - (del?.y ?? 1))).toBeLessThan(1);
        expect(Math.abs((up?.w ?? 0) - (down?.w ?? 1))).toBeLessThan(1);
        expect(Math.abs((down?.w ?? 0) - (del?.w ?? 1))).toBeLessThan(1);
        expect(Math.abs(((down?.x ?? 0) - (up?.r ?? 0)) - ((del?.x ?? 0) - (down?.r ?? 0)))).toBeLessThan(1);
        expect((row.parts[2]?.y ?? 0)).toBeGreaterThan((text?.y ?? 0) + (text?.h ?? 0) - 1);
        expect(up?.y ?? 0).toBeGreaterThan((row.parts[2]?.y ?? 0) + (row.parts[2]?.h ?? 0) - 1);
      } else {
        expect(Math.abs((up?.y ?? 0) - (text?.y ?? 1))).toBeLessThan(12);
      }
    }
    const ys = info.rows.map((r) => r.li.y);
    const gaps = info.rows.slice(1).map((r, i) => r.li.y - ((info.rows[i]?.li.y ?? 0) + (info.rows[i]?.li.h ?? 0)));
    for (const g of gaps) expect(Math.abs(g - (gaps[0] ?? 0))).toBeLessThan(1);
    expect(ys.length).toBe(4);
    await p.context.close();
  });
}
