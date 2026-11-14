import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  DOC,
  awaitSaved,
  exportCapsule,
  importFile,
  importResult,
  loadUntilOfflineReady,
  newProfile,
  offlineProfileInIncident,
  readStoredRecords,
  readUiModel,
  saveIndicator,
  saveSequence,
  storedState,
  storedTexts,
} from "./helpers.js";

test("second tab of the same profile shows StorageInUse and does not write (E2E-FL-06)", async ({ browser }) => {
  const p = await newProfile(browser);
  const page1 = p.page;
  await page1.goto("/");
  await page1.getByLabel("Incident ID").fill(DOC);
  await page1.getByRole("button", { name: "Open incident" }).click();
  await expect(page1.locator("html")).toHaveAttribute("data-session", "ready");
  await page1.getByLabel("New checklist item").fill("First");
  await page1.getByRole("button", { name: "Add item" }).click();
  await awaitSaved(page1);
  const seq1 = await saveSequence(page1);

  const page2 = await p.context.newPage();
  await page2.goto("/"); // remembered incident auto-opens, but the lock is held by page 1
  await expect(page2.locator("html")).toHaveAttribute("data-session", "in-use");
  await expect(page2.getByTestId("session-message")).toContainText("already open in another tab");
  await expect(page2.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page2.locator('[data-testid="checklist"]')).toHaveCount(0);

  // page 1 stays editable and still saves
  await page1.getByLabel("New checklist item").fill("Second");
  await page1.getByRole("button", { name: "Add item" }).click();
  await expect.poll(() => saveSequence(page1)).toBeGreaterThan(seq1);
  await awaitSaved(page1);
  const stored = await readStoredRecords(page1);
  expect(stored).toHaveLength(1);
  const lastSeq = stored[0]?.sequence;

  await page1.close();
  await expect
    .poll(() =>
      page2.evaluate(async () => {
        const q = await navigator.locks.query();
        return (q.held ?? []).some((l) => (l.name ?? "").startsWith("ghostsync:lock:fieldledger"));
      }),
    )
    .toBe(false);
  await page2.getByRole("button", { name: "Try again" }).click();
  await expect(page2.locator("html")).toHaveAttribute("data-session", "ready");
  await expect.poll(async () => storedTexts((await storedState(page2)).state).sort()).toEqual(["First", "Second"]);
  const after = await readStoredRecords(page2);
  expect(after).toHaveLength(1);
  expect(after[0]?.sequence).toBe(lastSeq);
  await p.context.close();
});

async function expectVisibleFocus(loc: Locator): Promise<void> {
  await expect(loc).toBeFocused();
  const [style, width] = await loc.evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.outlineStyle, s.outlineWidth];
  });
  expect(style).not.toBe("none");
  expect(width).toBe("3px");
}

test("keyboard-only operation with visible focus (E2E-FL-09)", async ({ browser }, testInfo) => {
  const p = await newProfile(browser);
  const page = p.page;
  await page.goto("/");
  const idInput = page.getByLabel("Incident ID");
  await idInput.focus();
  await page.keyboard.type(DOC);
  await expectVisibleFocus(idInput);
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");

  const title = page.getByLabel("Title");
  await title.focus();
  await page.keyboard.type("Pump leak");
  await page.keyboard.press("Enter");
  await expect(page.locator("#f-title")).toHaveValue("Pump leak");

  const newItem = page.getByLabel("New checklist item");
  await newItem.focus();
  await expectVisibleFocus(newItem);
  await page.keyboard.type("One");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Two");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="checklist"] li')).toHaveCount(2);

  const doneOne = page.getByLabel("Done: One");
  await doneOne.focus();
  await expectVisibleFocus(doneOne);
  await page.keyboard.press("Space");
  await expect(doneOne).toBeChecked();

  const down = page.getByRole("button", { name: "Move down: One" });
  await down.focus();
  await expectVisibleFocus(down);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await readUiModel(page)).items.map((i) => ("text" in i ? i.text : ""))).toEqual(["Two", "One"]);

  const del = page.getByRole("button", { name: "Delete item: Two" });
  await del.focus();
  await expectVisibleFocus(del);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await readUiModel(page)).items.map((i) => ("text" in i ? i.text : ""))).toEqual(["One"]);

  const exportBtn = page.getByRole("button", { name: "Export capsule (.gscap)" });
  await exportBtn.focus();
  await expectVisibleFocus(exportBtn);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const dl = await downloadPromise;
  const path = testInfo.outputPath("kb.gscap");
  await dl.saveAs(path);

  // The file input is reachable and named; setInputFiles completes the import.
  const fileInput = page.getByLabel("Import capsule (.gscap)");
  await fileInput.focus();
  await expectVisibleFocus(fileInput);
  await importFile(page, path);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");

  await awaitSaved(page);
  const s = await storedState(page);
  const items = s.state.items.flatMap(([, r]) => (r.ok ? [[r.entity.text, r.entity.done] as const] : []));
  expect(items).toEqual([["One", true]]);
  const inc = s.state.incident;
  expect(inc.ok && inc.entity.title).toBe("Pump leak");
  await p.context.close();
});

async function noHorizontalOverflow(page: Page, width: number): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (width <= 320) {
    const offenders = await page.evaluate((w) => {
      const main = document.querySelector("main");
      const bad: string[] = [];
      main?.querySelectorAll("*").forEach((el) => {
        if (el.getBoundingClientRect().right <= w + 0.5) return;
        for (let a: Element | null = el.parentElement; a !== null && a !== main?.parentElement; a = a.parentElement) {
          if (getComputedStyle(a).overflowX === "auto") return;
        }
        bad.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`);
      });
      return bad;
    }, width);
    expect(offenders, `elements wider than ${width}px: ${offenders.join(", ")}`).toEqual([]);
  }
}

test("320 px layout has no horizontal scroll (E2E-FL-16)", async ({ browser }) => {
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await page.getByLabel("New checklist item").fill("L".repeat(200));
  await page.getByRole("button", { name: "Add item" }).click();
  await awaitSaved(page);
  await expect.poll(async () => (await readUiModel(page)).items.length).toBe(1);
  await page.getByTestId("import-input").setInputFiles({ name: "x.gscap", mimeType: "application/octet-stream", buffer: Buffer.from("not a capsule at all") });
  await expect(importResult(page)).toHaveAttribute("data-import-state", "rejected");
  for (const [w, h] of [[320, 640], [1280, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await noHorizontalOverflow(page, w);
    await expect(page.getByRole("button", { name: "Export capsule (.gscap)" })).toBeVisible();
    await expect(page.getByTestId("import-input")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();
  }
  await a.context.close();
});
