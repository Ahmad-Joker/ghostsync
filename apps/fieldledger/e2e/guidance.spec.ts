import { expect, test } from "@playwright/test";
import { DOC, join, newProfile } from "./helpers.js";

const KEY = "ghostsync.fieldledger.ui.guidance";

test("E2E-UI-01: guidance is visible, does not block the join form or take focus, and is dismissed with focus on the next control", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  await page.goto("/");
  const guide = page.locator("#guidance");
  const help = page.getByRole("button", { name: "How it works", exact: true });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("heading", { name: "How GhostSync works" })).toBeVisible();
  await expect(guide.getByRole("listitem")).toHaveCount(3);
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Incident ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open incident", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), KEY)).toBeNull();
  await guide.getByRole("button", { name: "Start working", exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#incident-id")).toBeFocused();
  expect(await page.evaluate((k) => window.localStorage.getItem(k), KEY)).toBe("dismissed");
  await p.context.close();
});

test("E2E-UI-02: Help reopens the panel and focus returns to Help; Escape closes it; reload keeps it dismissed", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  await page.goto("/");
  await page.getByRole("button", { name: "Start working", exact: true }).click();
  await expect(page.locator("#guidance")).toBeHidden();
  const help = page.getByRole("button", { name: "How it works", exact: true });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#guidance")).toBeVisible();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(help).toBeFocused();
  await page.getByRole("button", { name: "Start working", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#guidance")).toBeHidden();
  await expect(help).toBeFocused();
  await help.click();
  await page.getByRole("button", { name: "Start working", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#guidance")).toBeHidden();
  await expect(help).toBeFocused();
  await page.reload();
  await expect(page.locator("#guidance")).toBeHidden();
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await p.context.close();
});

test("E2E-UI-03: the guide still works when its own preference cannot be stored", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  await page.addInitScript((k) => {
    const real = Storage.prototype;
    const getItem = real.getItem;
    const setItem = real.setItem;
    real.getItem = function patched(this: Storage, key: string): string | null {
      if (key === k) throw new DOMException("denied", "SecurityError");
      return getItem.call(this, key);
    };
    real.setItem = function patched(this: Storage, key: string, value: string): void {
      if (key === k) throw new DOMException("denied", "SecurityError");
      setItem.call(this, key, value);
    };
  }, KEY);
  await page.goto("/");
  await expect(page.locator("#guidance")).toBeVisible();
  await page.getByRole("button", { name: "Start working", exact: true }).click();
  await expect(page.locator("#guidance")).toBeHidden();
  await p.context.close();
});

test("E2E-UI-04: in the workspace the guide does not block work and Help opens it again", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  await page.goto("/");
  await join(page, DOC);
  await expect(page.locator("#guidance")).toBeVisible();
  await page.getByLabel("New checklist item").fill("Check the lamp");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.locator('[data-testid="checklist"] li[data-item-id]')).toHaveCount(1);
  await page.getByRole("button", { name: "Start working", exact: true }).click();
  await expect(page.locator("#create-title")).toBeFocused();
  await expect(page.locator("#guidance")).toBeHidden();
  await page.getByRole("button", { name: "How it works", exact: true }).click();
  await expect(page.locator("#guidance")).toBeVisible();
  await p.context.close();
});
