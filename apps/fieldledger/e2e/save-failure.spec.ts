import { expect, test } from "@playwright/test";
import {
  DOC,
  addItemUi,
  armAbort,
  awaitSaved,
  decodeCapsuleFile,
  exportCapsule,
  expectImportMeta,
  importFile,
  importResult,
  itemTexts,
  offlineProfileInIncident,
  saveSequence,
  storedState,
  storedTexts,
} from "./helpers.js";

test("import applied but not saved: alert, backup, retry, reload (E2E-FL-05)", async ({ browser }, testInfo) => {
  const a = await offlineProfileInIncident(browser);
  const b = await offlineProfileInIncident(browser);
  await addItemUi(a.page, "Pump valve");
  await awaitSaved(a.page);
  await addItemUi(b.page, "Replace gasket");
  await awaitSaved(b.page);
  const fileB = await exportCapsule(b.page, testInfo, "b.gscap");

  // FLUSH SETUP WRITES and ASSERT they succeeded (UI saved + persisted) BEFORE arming the one-shot abort.
  const pre = await storedState(a.page);
  expect(pre.record.sequence).toBe(await saveSequence(a.page));
  expect(storedTexts(pre.state)).toEqual(["Pump valve"]);

  await armAbort(a.page); // armed immediately before the import
  await importFile(a.page, fileB);

  const result = importResult(a.page);
  await expect(result).toHaveAttribute("data-import-state", "applied-unsaved");
  await expect(result).toHaveAttribute("data-import-code", "TransactionAbortError");
  await expectImportMeta(a.page, fileB); // metadata is shown for applied-unsaved too (AC-FL-013-7)
  const alert = a.page.locator('[data-testid="save-error-alert"]');
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Capsule applied, but NOT saved to this device");
  await expect(alert).toContainText("If you close or reload this page before the save succeeds");
  const retry = alert.getByRole("button", { name: "Retry save" });
  const backup = alert.getByRole("button", { name: "Download backup capsule" });
  await expect(retry).toBeVisible();
  await expect(backup).toBeVisible();
  await retry.focus();
  await expect(retry).toBeFocused();
  await expect(a.page.locator('[data-testid="save-indicator"]')).toHaveAttribute("data-save-state", "error");
  await expect(a.page.locator('[data-testid="save-indicator"]')).toHaveText(/NOT saved to this device/);
  // data is still readable
  expect((await itemTexts(a.page)).sort()).toEqual(["Pump valve", "Replace gasket"]);

  // Persisted truth: unsaved. Stored record is the pre-import snapshot.
  const during = await storedState(a.page);
  expect(during.record.sequence).toBe(pre.record.sequence);
  expect(during.record.bytes).toEqual(pre.record.bytes);
  expect(storedTexts(during.state)).not.toContain("Replace gasket");

  // Backup capsule (real download) holds the merged state.
  const downloadPromise = a.page.waitForEvent("download");
  await backup.click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/_backup\.gscap$/);
  const backupPath = testInfo.outputPath("backup.gscap");
  await dl.saveAs(backupPath);
  const backupState = await decodeCapsuleFile(backupPath);
  expect(storedTexts(backupState).sort()).toEqual(["Pump valve", "Replace gasket"]);

  // Retry save: single click, then await observable state.
  await retry.click();
  await expect(a.page.locator('[data-testid="save-indicator"]')).toHaveAttribute("data-save-state", "saved");
  await expect(result).toHaveAttribute("data-import-state", "applied-saved");
  await expect(result).toContainText("Saved locally. The imported changes are now stored on this device.");
  await expectImportMeta(a.page, fileB); // unchanged after a successful retry
  await expect(alert).toHaveCount(0);
  const after = await storedState(a.page);
  expect(after.record.sequence).toBeGreaterThan(pre.record.sequence);
  expect(storedTexts(after.state).sort()).toEqual(["Pump valve", "Replace gasket"]);

  // Reload offline: the merged data is persisted.
  await a.page.reload();
  await expect(a.page.locator("main")).toHaveAttribute("data-document-id", DOC);
  await expect.poll(async () => (await itemTexts(a.page)).sort()).toEqual(["Pump valve", "Replace gasket"]);
  expect(storedTexts((await storedState(a.page)).state).sort()).toEqual(["Pump valve", "Replace gasket"]);
  await a.context.close();
  await b.context.close();
});
