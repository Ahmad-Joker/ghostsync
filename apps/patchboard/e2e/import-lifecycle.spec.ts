import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cardAdapter } from "../src/model/adapters.js";
import {
  BOARD,
  addCardUi,
  awaitSaved,
  buildCapsule,
  importFile,
  importResult,
  join,
  loadUntilOfflineReady,
  newProfile,
  press,
  saveIndicator,
  storedState,
} from "./helpers.js";

test("E2E-PB-20: Change board and Update now are disabled during a pending import and available again afterwards", async ({ browser }, testInfo) => {
  const p = await newProfile(browser);
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, BOARD);
  await addCardUi(page, "Saved card");
  await awaitSaved(page);

  // A waiting worker makes the Update now button appear.
  expect((await page.request.post("/__test/sw-bump")).status()).toBe(204);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "waiting");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  const t0 = await page.evaluate(() => performance.timeOrigin);

  const bytes = await buildCapsule(BOARD, "patchboard", (r) => {
    r.collection(cardAdapter).put("card-peer", { title: "From peer", notes: "", placement: "todo|00001024" });
  });
  const path = testInfo.outputPath("peer.gscap");
  writeFileSync(path, bytes);

  // Test-side delay: the file read waits until the test releases it. Nothing here exists in the app bundle.
  await page.evaluate(() => {
    const w = window as unknown as { __releaseRead: () => void };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    w.__releaseRead = release;
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function (this: Blob): Promise<ArrayBuffer> {
      await gate;
      return original.call(this);
    };
  });

  const change = page.getByTestId("change-board");
  const update = page.getByTestId("update-banner").getByRole("button", { name: "Update now", exact: true });
  await expect(change).toBeEnabled();
  await expect(update).toBeEnabled();

  await importFile(page, path);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "importing");
  await expect(change).toBeDisabled();
  await expect(update).toBeDisabled();
  // A forced click on the disabled buttons does nothing.
  await change.evaluate((el) => (el as HTMLButtonElement).click());
  await update.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(t0);

  await page.evaluate(() => (window as unknown as { __releaseRead: () => void }).__releaseRead());
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(change).toBeEnabled();
  await expect(update).toBeEnabled();
  expect((await storedState(page)).cards.flatMap(([, r]) => (r.ok ? [r.entity.title] : [])).sort()).toEqual(["From peer", "Saved card"]);

  await press(page, update);
  await expect.poll(() => page.evaluate(() => performance.timeOrigin).catch(() => t0)).not.toBe(t0);
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.getByTestId("change-board")).toBeEnabled();
  await p.context.close();
});
