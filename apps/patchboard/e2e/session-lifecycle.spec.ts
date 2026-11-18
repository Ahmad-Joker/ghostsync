import { expect, test } from "@playwright/test";
import {
  BOARD,
  addCardUi,
  awaitSaved,
  decodeCapsuleFile,
  join,
  offlineProfileOnBoard,
  press,
  saveIndicator,
  saveSequence,
  setStickyAbort,
  storedState,
} from "./helpers.js";

const titles = (cards: Awaited<ReturnType<typeof storedState>>["cards"]): string[] =>
  cards.flatMap(([, r]) => (r.ok ? [r.entity.title] : []));

test("E2E-PB-10: a second tab of the same profile gets the in-use screen; Try again by keyboard once the lock is free", async ({ browser }) => {
  const a = await offlineProfileOnBoard(browser);
  await addCardUi(a.page, "Held card");
  await awaitSaved(a.page);
  const before = await storedState(a.page);

  const second = await a.context.newPage();
  await second.goto("/");
  await expect(second.locator("html")).toHaveAttribute("data-session", "in-use");
  const message = second.getByTestId("session-message");
  await expect(message).toContainText("already open in another tab or window on this device");
  const tryAgain = message.getByRole("button", { name: "Try again", exact: true });
  await expect(tryAgain).toBeVisible();
  await expect(message.getByRole("button", { name: "Open a different board", exact: true })).toBeVisible();

  // Release the first tab's lock, then wait by reading navigator.locks until it is gone.
  await a.page.close();
  await expect
    .poll(() => second.evaluate(async () => (await navigator.locks.query()).held?.length ?? 0))
    .toBe(0);
  await press(second, tryAgain);
  await expect(second.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(second.locator("main")).toHaveAttribute("data-board-id", BOARD);
  expect((await storedState(second)).record.sequence).toBeGreaterThanOrEqual(before.record.sequence);
  expect(titles((await storedState(second)).cards)).toEqual(["Held card"]);
  await a.context.close();
});

test("E2E-PB-15: Change board by keyboard; a failed close shows recovery; backup and Discard by keyboard", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser);
  const page = a.page;
  await addCardUi(page, "Saved edit");
  await awaitSaved(page);
  const S = await saveSequence(page);

  // (a) successful close, A-20
  await press(page, page.getByTestId("change-board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  await expect(page.locator("main")).toHaveCount(0);
  const afterClose = await storedState(page);
  expect(afterClose.record.sequence).toBe(S);
  expect(titles(afterClose.cards)).toContain("Saved edit");

  // The previous board was closed: reopening reaches ready, not in-use.
  await join(page, BOARD);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");

  // (b) failed close: every write fails, so the final save inside close() fails for real.
  await setStickyAbort(page, true);
  await addCardUi(page, "Unsaved edit");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "error");
  await press(page, page.getByTestId("change-board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "recovery");
  await expect(page.locator("main")).toHaveAttribute("data-board-id", BOARD);
  const panel = page.getByTestId("recovery-panel");
  await expect(panel.getByRole("button", { name: "Download backup capsule", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Discard unsaved changes and switch", exact: true })).toBeVisible();
  await expect(page.getByLabel("Board ID")).toHaveCount(0);
  await expect(page.getByTestId("card-title").filter({ hasText: "Unsaved edit" })).toHaveCount(1);

  const downloadPromise = page.waitForEvent("download");
  await press(page, panel.getByRole("button", { name: "Download backup capsule", exact: true }));
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/_backup\.gscap$/);
  const backupPath = testInfo.outputPath("recovery-backup.gscap");
  await dl.saveAs(backupPath);
  expect(titles(await decodeCapsuleFile(backupPath))).toContain("Unsaved edit");

  await press(page, panel.getByRole("button", { name: "Discard unsaved changes and switch", exact: true }));
  await expect(page.locator("html")).toHaveAttribute("data-session", "join");
  await setStickyAbort(page, false);

  // Nothing was silently saved.
  await join(page, BOARD);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  const reopened = await storedState(page);
  expect(reopened.record.sequence).toBe(S);
  expect(titles(reopened.cards)).not.toContain("Unsaved edit");
  await a.context.close();
});
