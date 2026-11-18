import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cardAdapter } from "../src/model/adapters.js";
import { BOARD, addCardUi, awaitSaved, buildCapsule, importFile, importResult, offlineProfileOnBoard } from "./helpers.js";

test("E2E-PB-16: no horizontal scroll at 320 px, stacked columns below 48em; screenshots after the assertions", async ({ browser }, testInfo) => {
  const p = await offlineProfileOnBoard(browser);
  const page = p.page;
  await addCardUi(page, "W".repeat(110), "n".repeat(300));
  await addCardUi(page, "Second card");
  await awaitSaved(page);
  const bytes = await buildCapsule(BOARD, "patchboard", (r) => {
    r.collection(cardAdapter).put("card-peer", { title: "From a peer", notes: "", placement: "doing|00001024" });
  });
  const file = testInfo.outputPath("peer.gscap");
  writeFileSync(file, bytes);
  await importFile(page, file);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");

  const box = async (c: string): Promise<{ x: number; y: number }> => {
    const b = await page.locator(`[data-testid="column-${c}"]`).boundingBox();
    if (b === null) throw new Error(`no box for ${c}`);
    return b;
  };
  const overflow = (): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  const [t, d, n] = [await box("todo"), await box("doing"), await box("done")];
  expect(Math.abs(t.x - d.x)).toBeLessThan(1);
  expect(Math.abs(d.x - n.x)).toBeLessThan(1);
  expect(t.y).toBeLessThan(d.y);
  expect(d.y).toBeLessThan(n.y);
  const narrow = testInfo.outputPath("layout-320x640.png");
  await page.screenshot({ path: narrow, fullPage: true });
  await testInfo.attach("layout-320x640", { path: narrow, contentType: "image/png" });

  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  const [t2, d2, n2] = [await box("todo"), await box("doing"), await box("done")];
  expect(Math.abs(t2.y - d2.y)).toBeLessThan(1);
  expect(t2.x).toBeLessThan(d2.x);
  expect(d2.x).toBeLessThan(n2.x);
  const wide = testInfo.outputPath("layout-1280x800.png");
  await page.screenshot({ path: wide, fullPage: true });
  await testInfo.attach("layout-1280x800", { path: wide, contentType: "image/png" });
  await p.context.close();
});
