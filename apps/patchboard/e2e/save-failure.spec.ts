import { expect, test } from "@playwright/test";
import {
  BOARD,
  addCardUi,
  armAbort,
  awaitSaved,
  btn,
  cardIn,
  decodeCapsuleFile,
  exportCapsule,
  expectImportMeta,
  importFile,
  importResult,
  offlineProfileOnBoard,
  press,
  readUiBoard,
  saveIndicator,
  saveSequence,
  storedState,
  validCard,
} from "./helpers.js";

const titles = (cards: Awaited<ReturnType<typeof storedState>>["cards"]): string[] =>
  cards.flatMap(([, r]) => (r.ok ? [r.entity.title] : [])).sort();

test("E2E-PB-05: import applied but not saved: alert, backup, Retry save by keyboard, reload; edit-save leg; beforeunload", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser);
  const b = await offlineProfileOnBoard(browser);
  await addCardUi(a.page, "Pump valve");
  await awaitSaved(a.page);
  await addCardUi(b.page, "Replace gasket");
  await awaitSaved(b.page);
  const fileB = await exportCapsule(b.page, testInfo, "b.gscap");

  // FLUSH SETUP WRITES and ASSERT they succeeded (UI saved + persisted) BEFORE arming the one-shot abort.
  const pre = await storedState(a.page);
  expect(pre.record.sequence).toBe(await saveSequence(a.page));
  expect(titles(pre.cards)).toEqual(["Pump valve"]);

  await armAbort(a.page); // armed immediately before the import
  await importFile(a.page, fileB);

  const result = importResult(a.page);
  await expect(result).toHaveAttribute("data-import-state", "applied-unsaved");
  await expect(result).toHaveAttribute("data-import-code", "TransactionAbortError");
  await expectImportMeta(a.page, fileB);
  const alert = a.page.locator('[data-testid="save-error-alert"]');
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toHaveAttribute("data-save-error-kind", "import");
  await expect(alert).toContainText("Capsule applied, but NOT saved to this device");
  await expect(alert).toContainText("If you close or reload this page before the save succeeds");
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "error");
  await expect(saveIndicator(a.page)).toHaveText(/NOT saved to this device/);
  // The merged board is readable while unsaved.
  expect((await readUiBoard(a.page)).todo.map((c) => c.title).sort()).toEqual(["Pump valve", "Replace gasket"]);

  // Persisted truth: unsaved. The stored record is still the pre-import snapshot.
  const during = await storedState(a.page);
  expect(during.record.sequence).toBe(pre.record.sequence);
  expect(during.record.bytes).toEqual(pre.record.bytes);
  expect(titles(during.cards)).not.toContain("Replace gasket");

  // A-14: backup by keyboard, a real download that holds the merged board.
  const downloadPromise = a.page.waitForEvent("download");
  await press(a.page, alert.getByRole("button", { name: "Download backup capsule", exact: true }));
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/_backup\.gscap$/);
  const backupPath = testInfo.outputPath("backup.gscap");
  await dl.saveAs(backupPath);
  expect(titles(await decodeCapsuleFile(backupPath))).toEqual(["Pump valve", "Replace gasket"]);

  // A-13: Retry save by keyboard.
  await press(a.page, alert.getByRole("button", { name: "Retry save", exact: true }));
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "saved");
  await expect(result).toHaveAttribute("data-import-state", "applied-saved");
  await expect(result).toContainText("Saved locally. The imported changes are now stored on this device.");
  await expectImportMeta(a.page, fileB);
  await expect(alert).toHaveCount(0);
  const after = await storedState(a.page);
  expect(after.record.sequence).toBeGreaterThan(pre.record.sequence);
  expect(titles(after.cards)).toEqual(["Pump valve", "Replace gasket"]);

  // Reload offline: the merged board is persisted.
  await a.page.reload();
  await expect(a.page.locator("main")).toHaveAttribute("data-board-id", BOARD);
  await expect.poll(async () => (await readUiBoard(a.page)).todo.map((c) => c.title).sort()).toEqual(["Pump valve", "Replace gasket"]);
  expect(titles((await storedState(a.page)).cards)).toEqual(["Pump valve", "Replace gasket"]);

  // Edit-save leg: setup flushed and asserted, THEN the one-shot abort, then one edit.
  const mine = (await readUiBoard(a.page)).todo.find((c) => c.title === "Pump valve")?.id ?? "";
  // A restored session honestly shows "Nothing to save yet" (Persist does not expose the restored sequence).
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "saved");
  await expect(saveIndicator(a.page)).toHaveText(/Nothing to save yet/);
  const seq = (await storedState(a.page)).record.sequence;
  expect(seq).toBeGreaterThan(0);
  await armAbort(a.page);
  await press(a.page, btn(a.page, "Edit card: Pump valve"));
  await a.page.getByTestId("card-edit-form").getByLabel("Title").fill("Pump valve seat");
  await press(a.page, btn(a.page, "Save card: Pump valve"));
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "error");
  const editAlert = a.page.locator('[data-testid="save-error-alert"]');
  await expect(editAlert).toHaveAttribute("data-save-error-kind", "edit");
  await expect(editAlert).toHaveAttribute("data-save-error-code", "TransactionAbortError");
  await expect(editAlert).toContainText("Your latest changes are NOT saved to this device.");
  await expect(editAlert).not.toContainText("Capsule applied");
  await expect(cardIn(a.page, "todo", mine).getByTestId("card-title")).toHaveText("Pump valve seat");
  expect(validCard((await storedState(a.page)).cards, mine)?.title).toBe("Pump valve");

  // beforeunload guard only in error.
  const dialogPromise = a.page.waitForEvent("dialog");
  await a.page.close({ runBeforeUnload: true });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(a.page.isClosed()).toBe(false);

  await press(a.page, editAlert.getByRole("button", { name: "Retry save", exact: true }));
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "saved");
  await expect(editAlert).toHaveCount(0);
  expect(validCard((await storedState(a.page)).cards, mine)?.title).toBe("Pump valve seat");
  await a.page.close({ runBeforeUnload: true });
  await expect.poll(() => a.page.isClosed()).toBe(true);
  await a.context.close();
  await b.context.close();
});
