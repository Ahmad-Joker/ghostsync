/**
 * Regression (mirrors FieldLedger E2E-FL-INPUT-*): re-renders must not clear typed input or move focus.
 * Re-renders are forced through the real paths: network chip changes and a rejected capsule import (controller notify).
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { join, loadUntilOfflineReady, newProfile } from "./helpers.js";

async function flap(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByTestId("network-chip")).toContainText(/offline/i);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("network-chip")).toContainText(/online/i);
}

async function rerender(page: Page): Promise<void> {
  await page.getByTestId("import-input").setInputFiles({ name: "junk.gscap", mimeType: "application/octet-stream", buffer: Buffer.from("not a capsule") });
  await expect(page.locator("[data-import-state]")).toHaveAttribute("data-import-state", "rejected");
}

test("E2E-PB-INPUT-01: typed Board ID and focus survive network re-renders", async ({ browser }) => {
  const { context, page } = await newProfile(browser);
  await loadUntilOfflineReady(page);
  const id = page.getByLabel("Board ID");
  await id.click();
  await id.pressSequentially("sprint-board");
  await flap(context, page);
  await expect(id).toHaveValue("sprint-board");
  await expect(id).toBeFocused();
});

test("E2E-PB-INPUT-02: typed Add card title and notes, caret and focus survive re-renders, then Add works", async ({ browser }) => {
  const { context, page } = await newProfile(browser);
  await loadUntilOfflineReady(page);
  await join(page, "input-keep-pb");
  const title = page.getByLabel("New card title");
  await title.click();
  await title.pressSequentially("Patch the relay");
  await title.press("ArrowLeft");
  await title.evaluate((el) => el.setAttribute("data-keep", "yes"));
  const notes = page.locator("#new-notes");
  await notes.fill("Check the gasket");
  await title.focus();
  await flap(context, page);
  await rerender(page);
  await expect(title).toHaveAttribute("data-keep", "yes");
  await expect(title).toHaveValue("Patch the relay");
  await expect(notes).toHaveValue("Check the gasket");
  expect(await title.evaluate((el: HTMLInputElement) => [document.activeElement === el, el.selectionStart, el.selectionEnd])).toEqual([true, 14, 14]);
  await page.getByRole("button", { name: /^Add card/ }).first().click();
  await expect(title).toHaveValue("");
  await expect(page.getByText("Patch the relay").first()).toBeVisible();
});
