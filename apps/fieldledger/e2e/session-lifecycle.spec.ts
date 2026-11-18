import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  DOC,
  addItemUi,
  armAbort,
  awaitSaved,
  awaitSavedAfter,
  createDetails,
  decodeCapsuleFile,
  decodeCapsuleFileNewer,
  expectImportMeta,
  importFile,
  importResult,
  join,
  newerSchemaCapsule,
  offlineProfileInIncident,
  readStoredRecords,
  readUiModel,
  rowId,
  saveIndicator,
  saveSequence,
  setStickyAbort,
  storedState,
  storedTexts,
} from "./helpers.js";

test("change incident: close first, failed close keeps a recovery-only session (E2E-FL-12)", async ({ browser }, testInfo) => {
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await addItemUi(page, "Saved edit");
  await awaitSaved(page);
  const S = await saveSequence(page);

  // (a) successful close
  await page.getByTestId("change-incident").click();
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  const afterClose = await storedState(page);
  expect(afterClose.record.sequence).toBe(S);
  expect(storedTexts(afterClose.state)).toContain("Saved edit");

  // (b) failed close: every write fails, so the final save inside close() fails for real.
  await join(page, DOC);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  await setStickyAbort(page, true);
  await addItemUi(page, "Unsaved edit");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "error");
  await page.getByTestId("change-incident").click();
  await expect(page.locator("html")).toHaveAttribute("data-session", "recovery");
  await expect(page.locator("main")).toHaveAttribute("data-document-id", DOC);
  const panel = page.getByTestId("recovery-panel");
  await expect(panel.getByRole("button", { name: "Download backup capsule" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Discard unsaved changes and switch" })).toBeVisible();
  await expect(page.getByLabel("Incident ID")).toHaveCount(0);
  expect((await readUiModel(page)).items.map((i) => ("text" in i ? i.text : ""))).toContain("Unsaved edit");

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download backup capsule" }).click();
  const dl = await downloadPromise;
  const backupPath = testInfo.outputPath("recovery-backup.gscap");
  await dl.saveAs(backupPath);
  expect(storedTexts(await decodeCapsuleFile(backupPath))).toContain("Unsaved edit");

  await panel.getByRole("button", { name: "Discard unsaved changes and switch" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  await setStickyAbort(page, false);

  // Nothing was silently saved.
  await join(page, DOC);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  const reopened = await storedState(page);
  expect(reopened.record.sequence).toBe(S);
  expect(storedTexts(reopened.state)).not.toContain("Unsaved edit");
  await a.context.close();
});

test("page hide commits a focused draft (E2E-FL-13)", async ({ browser }) => {
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await addItemUi(page, "Check valve");
  await addItemUi(page, "Log pressure");
  await awaitSaved(page);
  let seq = await saveSequence(page);
  const idA = await rowId(page, "Check valve");
  const idB = await rowId(page, "Log pressure");

  // pagehide
  const inputA = page.locator(`li[data-item-id="${idA}"]`).getByLabel("Item text");
  await inputA.fill("Check valve seat"); // no Enter, no blur
  expect(storedTexts((await storedState(page)).state)).not.toContain("Check valve seat");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  seq = await awaitSavedAfter(page, seq);
  await expect(inputA).toHaveValue("Check valve seat");
  expect(storedTexts((await storedState(page)).state)).toContain("Check valve seat");

  // visibilitychange -> hidden
  const inputB = page.locator(`li[data-item-id="${idB}"]`).getByLabel("Item text");
  await inputB.fill("Log pressure hourly");
  expect(storedTexts((await storedState(page)).state)).not.toContain("Log pressure hourly");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  seq = await awaitSavedAfter(page, seq);
  await expect(inputB).toHaveValue("Log pressure hourly");
  const texts = storedTexts((await storedState(page)).state);
  expect(texts).toContain("Check valve seat");
  expect(texts).toContain("Log pressure hourly");
  await a.context.close();
});

test("a failed edit in the ready workspace is shown, the workspace stays usable, and it is not shown as saved (E2E-FL-19)", async ({ browser }, testInfo) => {
  // Real failure, no production hook: the title input carries maxlength=120, but a value set
  // programmatically (the way paste, autofill or an IME can bypass maxlength) reaches the field's
  // `change` handler with 121 characters. The app's own validate() rejects the put, while reads still
  // work, so the phase stays `ready` and guard() catches the throw.
  const tooLong = "y".repeat(121);
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await createDetails(page, "Pump leak");
  await addItemUi(page, "Close inlet");
  await awaitSaved(page);
  const seq = await saveSequence(page);
  const pre = await storedState(page);
  const title = page.locator("#f-title");

  await title.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = v;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, tooLong);

  const alert = page.getByTestId("edit-error-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("data-edit-error-kind", "unexpected");
  await expect(alert).toContainText("Your edit was NOT applied");
  await expect(alert).toContainText("try the edit again, or reload the page");

  // (b) the workspace stays usable
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(title).toBeVisible();
  await expect(title).toBeEnabled();
  await expect(title).toHaveValue("Pump leak"); // the unapplied edit is not left on screen as if it took
  for (const id of ["f-location", "f-severity", "f-status", "f-notes"]) await expect(page.locator(`#${id}`)).toBeEnabled();
  const row = page.locator('[data-testid="checklist"] li[data-item-id]');
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel("Item text")).toHaveValue("Close inlet");
  await expect(row.getByLabel("Item text")).toBeEnabled();
  await expect(row.getByLabel(/^Done/)).toBeEnabled();
  await expect(page.getByLabel("New checklist item")).toBeEnabled();

  // (c) not shown as saved, nothing persisted
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  expect(await saveSequence(page)).toBe(seq);
  await expect(saveIndicator(page)).not.toContainText("error");
  const during = await storedState(page);
  expect(during.record.sequence).toBe(pre.record.sequence);
  expect(during.record.bytes).toEqual(pre.record.bytes);
  expect(during.state.incident.ok && during.state.incident.entity.title).toBe("Pump leak");

  // (d) distinct from save errors and import results
  await expect(page.getByTestId("save-error-alert")).toHaveCount(0);
  await expect(importResult(page)).not.toHaveAttribute("data-import-state", /.+/); // no import happened in this session
  await expect(alert).not.toContainText(/saved locally|capsule applied/i);

  // (e) keyboard reaches the actions; backup downloads once; Dismiss clears once
  const dismiss = alert.getByRole("button", { name: "Dismiss" });
  const backup = alert.getByRole("button", { name: "Download backup capsule" });
  await expect(alert.getByRole("button", { name: "Reload app" })).toHaveCount(0);
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(backup).toBeFocused();

  const downloadPromise = page.waitForEvent("download");
  await backup.click();
  const dl = await downloadPromise;
  const backupPath = testInfo.outputPath("edit-error-backup.gscap");
  await dl.saveAs(backupPath);
  const decoded = await decodeCapsuleFile(backupPath);
  expect(decoded.incident.ok && decoded.incident.entity.title).toBe("Pump leak");
  expect(storedTexts(decoded)).toEqual(["Close inlet"]);

  await dismiss.click();
  await expect(alert).toHaveCount(0);
  await expect(title).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  expect(await saveSequence(page)).toBe(seq);
  await a.context.close();
});

test("a schema-mismatch edit failure keeps the ready workspace, its last good model, save state and backup (E2E-FL-20)", async ({ browser }, testInfo) => {
  // REAL schema mismatch, no production hook. A Node-built capsule (the page's own stored state plus schema
  // metadata for both collections at a HIGHER schemaVersion, same app/entityType) is imported through the file
  // input. The Kit does not re-check the schema on apply, so the import succeeds and the workspace stays ready,
  // but from then on every collection operation (put, listResults) throws the Kit's schema-mismatch error.
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await createDetails(page, "Pump leak");
  await addItemUi(page, "Close inlet");
  await addItemUi(page, "Log pressure");
  await awaitSaved(page);
  const before = await readUiModel(page);
  expect(before.items.map((i) => ("text" in i ? i.text : ""))).toEqual(["Close inlet", "Log pressure"]);
  const stored = (await readStoredRecords(page))[0];
  expect(stored).toBeDefined();
  const file = testInfo.outputPath("newer-schema.gscap");
  writeFileSync(file, await newerSchemaCapsule(stored?.bytes ?? []));

  await importFile(page, file);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await awaitSaved(page);
  // The post-import re-read fails: a stale-data notice, no misleading diff, metadata and backup access kept.
  const staleNotice = page.getByTestId("import-stale-notice");
  await expect(staleNotice).toBeVisible();
  await expect(staleNotice).toContainText("last data it could read");
  await expectImportMeta(page, file);
  await expect(page.getByTestId("merge-summary")).not.toContainText("No changes");
  await expect(page.getByTestId("merge-summary")).toHaveCount(1);
  await expect(page.getByTestId("merge-summary").getByRole("heading", { name: "What changed" })).toHaveCount(0);
  await expect(page.getByTestId("merge-summary").locator("li")).toHaveCount(0);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(staleNotice.getByRole("button", { name: "Download backup capsule" })).toBeVisible();
  const seq = await saveSequence(page);
  const rawBefore = (await readStoredRecords(page))[0];
  expect(rawBefore?.sequence).toBe(seq);

  // The failed edit (a title change on the incident details).
  const title = page.locator("#f-title");
  await title.fill("Pump leak (edited)");
  await title.press("Enter");

  const alert = page.getByTestId("edit-error-alert");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("data-edit-error-kind", "schema-mismatch");
  await expect(alert).toContainText("Your edit was NOT applied");
  await expect(alert).toContainText("newer schema");
  await expect(alert).toContainText("Reload the app");
  await expect(alert.getByRole("button", { name: "Reload app" })).toBeVisible();
  await expect(alert.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(alert.getByRole("button", { name: "Download backup capsule" })).toBeVisible();
  await expect(staleNotice).toBeVisible();

  // The ready workspace and the last good model survive: same text, still enabled, no error screen.
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.getByTestId("session-message")).toHaveCount(0);
  await expect(title).toBeVisible();
  await expect(title).toBeEnabled();
  await expect(title).toHaveValue("Pump leak");
  const rows = page.locator('[data-testid="checklist"] li[data-item-id]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByLabel("Item text")).toHaveValue("Close inlet");
  await expect(rows.nth(1).getByLabel("Item text")).toHaveValue("Log pressure");
  await expect(rows.nth(0).getByLabel("Item text")).toBeEnabled();
  await expect(rows.nth(1).getByLabel("Item text")).toBeEnabled();
  expect(await readUiModel(page)).toEqual(before);

  // Not shown as saved; nothing persisted by the failed edit.
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  expect(await saveSequence(page)).toBe(seq);
  await expect(page.getByTestId("save-error-alert")).toHaveCount(0);
  const rawDuring = (await readStoredRecords(page))[0];
  expect(rawDuring?.sequence).toBe(rawBefore?.sequence);
  expect(rawDuring?.bytes).toEqual(rawBefore?.bytes);

  // Backup does not go through the failing collections: one download, decodes to the last good model.
  const downloadPromise = page.waitForEvent("download");
  await alert.getByRole("button", { name: "Download backup capsule" }).click();
  const dl = await downloadPromise;
  const backupPath = testInfo.outputPath("schema-mismatch-backup.gscap");
  await dl.saveAs(backupPath);
  const decoded = await decodeCapsuleFileNewer(backupPath);
  expect(decoded.incident.ok && decoded.incident.entity.title).toBe("Pump leak");
  expect(storedTexts(decoded).sort()).toEqual(["Close inlet", "Log pressure"]);

  // Dismiss once clears the alert; the workspace remains.
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(rows).toHaveCount(2);
  await expect(title).toHaveValue("Pump leak");
  await a.context.close();
});

test("failed edit save: alert and the beforeunload guard only in error (E2E-FL-14)", async ({ browser }) => {
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await addItemUi(page, "Check valve");
  await awaitSaved(page);
  const id = await rowId(page, "Check valve");
  const pre = await storedState(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => dialogs.push(d.type()));

  await armAbort(page);
  const input = page.locator(`li[data-item-id="${id}"]`).getByLabel("Item text");
  await input.fill("Check valve seat");
  await input.press("Enter");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "error");
  const alert = page.getByTestId("save-error-alert");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("data-save-error-kind", "edit");
  await expect(alert).toHaveAttribute("data-save-error-code", "TransactionAbortError");
  await expect(alert).toContainText("Your latest changes are NOT saved to this device.");
  await expect(alert).toContainText("If you close or reload this page before the save succeeds");
  await expect(alert).not.toContainText("Capsule applied");
  await expect(page.getByTestId("import-result")).not.toHaveAttribute("data-import-state", "applied-unsaved");
  await expect(alert.getByRole("button", { name: "Retry save" })).toBeVisible();
  await expect(alert.getByRole("button", { name: "Download backup capsule" })).toBeVisible();
  const during = await storedState(page);
  expect(during.record.sequence).toBe(pre.record.sequence);
  expect(during.record.bytes).toEqual(pre.record.bytes);
  expect(storedTexts(during.state)).not.toContain("Check valve seat");

  // guard: closing in error raises a beforeunload dialog, which we dismiss
  const dialogPromise = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(dialogs).toEqual(["beforeunload"]);
  expect(page.isClosed()).toBe(false);

  await alert.getByRole("button", { name: "Retry save" }).click();
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect(alert).toHaveCount(0);
  expect(storedTexts((await storedState(page)).state)).toContain("Check valve seat");

  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(dialogs).toEqual(["beforeunload"]); // no second dialog
  await a.context.close();
});
