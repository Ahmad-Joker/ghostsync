import { statSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createKit } from "@ghostsync/kit";
import { cardAdapter } from "../src/model/adapters.js";
import {
  BOARD,
  addCardUi,
  awaitSaved,
  btn,
  expectImportMeta,
  importFile,
  importResult,
  newerSchemaCapsule,
  offlineProfileOnBoard,
  press,
  readStoredRecords,
  readUiBoard,
  saveIndicator,
  saveSequence,
  storedState,
} from "./helpers.js";

test("E2E-PB-13: a failed edit is shown, the workspace stays usable, it is not shown as saved; Dismiss by keyboard", async ({ browser }) => {
  // Real failure, no production hook: the title input carries maxlength=120, but a value set
  // programmatically (the way paste or autofill can bypass it) reaches Save with 121 characters.
  // The adapter's own validate() rejects the put while reads still work.
  const a = await offlineProfileOnBoard(browser);
  const page = a.page;
  const id = await addCardUi(page, "Pump leak");
  await awaitSaved(page);
  const seq = await saveSequence(page);
  const pre = await storedState(page);

  await press(page, btn(page, "Edit card: Pump leak"));
  const title = page.getByTestId("card-edit-form").getByLabel("Title");
  await title.evaluate((el, v) => {
    (el as HTMLInputElement).value = v;
  }, "y".repeat(121));
  await press(page, btn(page, "Save card: Pump leak"));

  const alert = page.getByTestId("edit-error-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("data-edit-error-kind", "unexpected");
  await expect(alert).toContainText("Your edit was NOT applied");
  await expect(alert.getByRole("button", { name: "Reload app", exact: true })).toHaveCount(0);

  // The workspace stays usable, the draft is kept, nothing is stored or shown as saved.
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.getByTestId("card-edit-form")).toHaveCount(1);
  await expect(page.getByLabel("New card title")).toBeEnabled();
  await expect(page.locator(`li[data-card-id="${id}"] [data-testid="card-title"]`)).toHaveText("Pump leak");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  expect(await saveSequence(page)).toBe(seq);
  await expect(page.getByTestId("save-error-alert")).toHaveCount(0);
  const during = await storedState(page);
  expect(during.record.sequence).toBe(pre.record.sequence);
  expect(during.record.bytes).toEqual(pre.record.bytes);
  await expect(alert).not.toContainText(/saved locally|capsule applied/i);

  // A-15: Dismiss by keyboard.
  await press(page, alert.getByRole("button", { name: "Dismiss", exact: true }));
  await expect(alert).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  expect(await readUiBoard(page)).toEqual({ todo: [{ id, title: "Pump leak", notes: "" }], doing: [], done: [], invalid: [] });
  await a.context.close();
});

test("E2E-PB-14: a newer-schema capsule gives the stale-workspace notice; schema-mismatch edit error; Reload app and Open a different board by keyboard", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser);
  const page = a.page;
  const id = await addCardUi(page, "Close inlet");
  await awaitSaved(page);
  const stored = (await readStoredRecords(page))[0];
  expect(stored).toBeDefined();
  const file = testInfo.outputPath("newer-schema.gscap");
  writeFileSync(file, await newerSchemaCapsule(stored?.bytes ?? []));

  await importFile(page, file);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await awaitSaved(page);

  // The post-import re-read fails: stale notice, no misleading diff, metadata and backup access kept.
  const staleNotice = page.getByTestId("import-stale-notice");
  await expect(staleNotice).toBeVisible();
  await expect(staleNotice).toContainText("showing its last readable data");
  await expectImportMeta(page, file);
  await expect(page.getByText("No changes")).toHaveCount(0);
  await expect(page.getByTestId("merge-summary")).toHaveCount(1);
  await expect(page.getByTestId("merge-summary").getByRole("heading", { name: "What changed" })).toHaveCount(0);
  await expect(page.getByTestId("merge-summary").locator("li")).toHaveCount(0);
  await expect(staleNotice.getByRole("button", { name: "Download backup capsule", exact: true })).toBeVisible();
  const seq = await saveSequence(page);
  const rawBefore = (await readStoredRecords(page))[0];
  expect(rawBefore?.sequence).toBe(seq);
  // The stored record includes the imported data: it now declares the newer schema.
  const r = createKit().createReplica(BOARD, Uint8Array.from(rawBefore?.bytes ?? []));
  expect(() => r.collection(cardAdapter)).toThrow(/schema mismatch/);
  r.destroy();

  // The failed edit: open the editor and save a new title.
  await press(page, btn(page, "Edit card: Close inlet"));
  await page.getByTestId("card-edit-form").getByLabel("Title").fill("Close inlet 2");
  await press(page, btn(page, "Save card: Close inlet"));
  const alert = page.getByTestId("edit-error-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("data-edit-error-kind", "schema-mismatch");
  await expect(alert).toContainText("newer schema");
  await expect(alert.getByRole("button", { name: "Reload app", exact: true })).toBeVisible();
  await expect(alert.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
  await expect(staleNotice).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator(`li[data-card-id="${id}"] [data-testid="card-title"]`)).toHaveText("Close inlet");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  expect(await saveSequence(page)).toBe(seq);
  await expect(page.getByTestId("save-error-alert")).toHaveCount(0);
  expect((await readStoredRecords(page))[0]?.bytes).toEqual(rawBefore?.bytes);

  // The backup download does not go through the failing collection.
  const downloadPromise = page.waitForEvent("download");
  await press(page, alert.getByRole("button", { name: "Download backup capsule", exact: true }));
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/_backup\.gscap$/);
  const backupPath = testInfo.outputPath("schema-mismatch-backup.gscap");
  await dl.saveAs(backupPath);
  expect(statSync(backupPath).size).toBeGreaterThan(0);

  // A-16: Reload app by keyboard reloads the page; the board then fails to open with the schema message.
  const t0 = await page.evaluate(() => performance.timeOrigin);
  await press(page, alert.getByRole("button", { name: "Reload app", exact: true }));
  await expect.poll(() => page.evaluate(() => performance.timeOrigin).catch(() => t0)).not.toBe(t0);
  await expect(page.locator("html")).toHaveAttribute("data-session", "error");
  await expect(page.getByTestId("session-message")).toContainText("incompatible PatchBoard version");

  // A-19: Open a different board by keyboard.
  await press(page, btn(page, "Open a different board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  await expect(page.getByLabel("Board ID")).toBeVisible();
  await a.context.close();
});
