/**
 * Regression: a re-render must not clear what the user is typing. Real Chromium against the production build.
 * Re-renders are forced the way the app really gets them: the network chip changing (offline/online events) and
 * a controller notify (a rejected capsule import re-renders the whole workspace without changing any document).
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { awaitSaved, join, loadUntilOfflineReady, newProfile } from "./helpers.js";

async function flap(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByTestId("network-chip")).toContainText(/offline/i);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("network-chip")).toContainText(/online/i);
}

/** A controller notify: the capsule is rejected (not a capsule), the result panel renders, the document is untouched. */
async function rerender(page: Page): Promise<void> {
  await page.getByTestId("import-input").setInputFiles({ name: "junk.gscap", mimeType: "application/octet-stream", buffer: Buffer.from("not a capsule") });
  await expect(page.locator("[data-import-state]")).toHaveAttribute("data-import-state", "rejected");
}

test("E2E-FL-INPUT-01: typed incident title, caret and focus survive re-renders, then Create works", async ({ browser }) => {
  const { context, page } = await newProfile(browser);
  await loadUntilOfflineReady(page);
  await join(page, "input-keep-1");
  const title = page.getByLabel("Title");
  await expect(title).toBeVisible();
  await title.click();
  await title.pressSequentially("Burst main on Elm");
  await title.press("ArrowLeft");
  await title.press("ArrowLeft");
  const marked = await title.evaluate((el) => {
    el.setAttribute("data-keep", "yes");
    return true;
  });
  expect(marked).toBe(true);
  await flap(context, page);
  await rerender(page);
  await title.focus();
  await title.evaluate((el: HTMLInputElement) => el.setSelectionRange(15, 15));
  await rerender(page);
  await expect(title).toHaveAttribute("data-keep", "yes");
  await expect(title).toHaveValue("Burst main on Elm");
  expect(await title.evaluate((el: HTMLInputElement) => [document.activeElement === el, el.selectionStart, el.selectionEnd])).toEqual([true, 15, 15]);
  await page.getByRole("button", { name: "Create incident details" }).click();
  await awaitSaved(page);
  await expect(page.getByLabel("Title")).toHaveValue("Burst main on Elm");
});

test("E2E-FL-INPUT-02: typed checklist item and focus survive re-renders, then Add works", async ({ browser }) => {
  const { context, page } = await newProfile(browser);
  await loadUntilOfflineReady(page);
  await join(page, "input-keep-2");
  const input = page.getByLabel("New checklist item");
  await input.click();
  await input.pressSequentially("Close valve 4");
  await flap(context, page);
  await rerender(page);
  await expect(input).toHaveValue("Close valve 4");
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.locator(".fl-record-full", { hasText: "Close valve 4" })).toHaveCount(1);
});

test("E2E-FL-INPUT-03: typed incident ID in the join form survives re-renders", async ({ browser }) => {
  const { context, page } = await newProfile(browser);
  await loadUntilOfflineReady(page);
  const id = page.getByLabel("Incident ID");
  await id.click();
  await id.pressSequentially("pump-station-7");
  await flap(context, page);
  await expect(id).toHaveValue("pump-station-7");
  await expect(id).toBeFocused();
});
