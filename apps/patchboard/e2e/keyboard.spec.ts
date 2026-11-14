import { expect, test } from "@playwright/test";
import {
  activeCardId,
  activeIsBody,
  addCardUi,
  announcer,
  awaitSavedAfter,
  btn,
  cardIn,
  column,
  decodeCapsuleFile,
  loadUntilOfflineReady,
  newProfile,
  press,
  readUiBoard,
  saveSequence,
  storedState,
  validCard,
} from "./helpers.js";

const BOARD = "kb-board";

test("E2E-PB-03: keyboard-only join, add, edit, save, cancel, move, reorder, delete, export", async ({ browser }, testInfo) => {
  const p = await newProfile(browser);
  const page = p.page;
  await loadUntilOfflineReady(page);
  await p.context.setOffline(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");

  // 1. A-01 open board by keyboard
  await page.getByLabel("Board ID").fill(BOARD);
  await press(page, btn(page, "Open board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator("main")).toHaveAttribute("data-board-id", BOARD);
  expect((await storedState(page)).record.documentId).toBe(BOARD);

  // 2. A-02 add three cards by keyboard
  const ids: Record<string, string> = {};
  const positions = ["todo|00001024", "todo|00002048", "todo|00003072"];
  for (const [i, title] of ["Alpha", "Beta", "Gamma"].entries()) {
    ids[title] = await addCardUi(page, title, "", true);
    await expect(announcer(page)).toHaveText(`Added "${title}" to To do, position ${i + 1} of ${i + 1}.`);
    expect(await activeIsBody(page)).toBe(false);
    expect(validCard((await storedState(page)).cards, ids[title] ?? "")?.placement).toBe(positions[i]);
  }
  const alpha = ids["Alpha"] ?? "";
  const beta = ids["Beta"] ?? "";
  const gamma = ids["Gamma"] ?? "";
  await expect.poll(async () => saveSequence(page)).toBeGreaterThan(0);

  // 3. A-03 and A-04: edit and save by keyboard
  let seq = await saveSequence(page);
  await press(page, btn(page, "Edit card: Alpha"));
  const form = page.getByTestId("card-edit-form");
  await expect(form).toBeVisible();
  expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe("title");
  await form.getByLabel("Title").fill("Alpha v2");
  await press(page, btn(page, "Save card: Alpha"));
  await expect(form).toHaveCount(0);
  await expect(cardIn(page, "todo", alpha).getByTestId("card-title")).toHaveText("Alpha v2");
  seq = await awaitSavedAfter(page, seq);
  await expect(btn(page, "Edit card: Alpha v2")).toBeFocused();
  let s = await storedState(page);
  expect(validCard(s.cards, alpha)).toEqual({ title: "Alpha v2", notes: "", placement: "todo|00001024" });

  // 4. A-05 cancel by keyboard
  await press(page, btn(page, "Edit card: Alpha v2"));
  await form.getByLabel("Title").fill("Discarded draft");
  await press(page, btn(page, "Cancel edit: Alpha v2"));
  await expect(form).toHaveCount(0);
  await expect(cardIn(page, "todo", alpha).getByTestId("card-title")).toHaveText("Alpha v2");
  await expect(btn(page, "Edit card: Alpha v2")).toBeFocused();
  expect(await saveSequence(page)).toBe(seq);
  expect((await storedState(page)).record.sequence).toBe(seq);

  // 5. A-06 move to Doing by keyboard
  await press(page, btn(page, "Move to Doing: Alpha v2"));
  await expect(cardIn(page, "doing", alpha)).toHaveCount(1);
  await expect(announcer(page)).toHaveText('Moved "Alpha v2" to Doing, position 1 of 1.');
  expect(await activeCardId(page)).toBe(alpha);
  expect(await activeIsBody(page)).toBe(false);
  seq = await awaitSavedAfter(page, seq);
  s = await storedState(page);
  expect(validCard(s.cards, alpha)).toEqual({ title: "Alpha v2", notes: "", placement: "doing|00001024" });

  // 6. A-07 reorder: Enter for down, Space for up
  await press(page, btn(page, "Move down: Beta"));
  await expect.poll(async () => (await readUiBoard(page)).todo.map((c) => c.id)).toEqual([gamma, beta]);
  await expect(announcer(page)).toHaveText('Moved "Beta" down, position 2 of 2 in To do.');
  expect(await activeCardId(page)).toBe(beta);
  seq = await awaitSavedAfter(page, seq);
  expect(validCard((await storedState(page)).cards, beta)?.placement).toBe("todo|00004096");
  await press(page, btn(page, "Move up: Beta"), "Space");
  await expect.poll(async () => (await readUiBoard(page)).todo.map((c) => c.id)).toEqual([beta, gamma]);
  await expect(announcer(page)).toHaveText('Moved "Beta" up, position 1 of 2 in To do.');
  expect(await activeCardId(page)).toBe(beta);
  seq = await awaitSavedAfter(page, seq);
  expect(validCard((await storedState(page)).cards, beta)?.placement).toBe("todo|00002048");

  // 7. A-08 and A-10: delete then keep
  await press(page, btn(page, "Delete card: Gamma"));
  await expect(btn(page, "Confirm delete: Gamma")).toBeVisible();
  await expect(btn(page, "Keep card: Gamma")).toBeVisible();
  expect(validCard((await storedState(page)).cards, gamma)).toBeDefined();
  await press(page, btn(page, "Keep card: Gamma"));
  await expect(btn(page, "Confirm delete: Gamma")).toBeHidden();
  await expect(cardIn(page, "todo", gamma)).toHaveCount(1);
  expect(validCard((await storedState(page)).cards, gamma)?.placement).toBe("todo|00003072");

  // 8. A-08 and A-09: delete then confirm by Space
  await press(page, btn(page, "Delete card: Gamma"));
  await press(page, btn(page, "Confirm delete: Gamma"), "Space");
  await expect(page.locator(`li[data-card-id="${gamma}"]`)).toHaveCount(0);
  await expect(announcer(page)).toHaveText('Deleted card "Gamma".');
  await expect(column(page, "todo").getByRole("heading", { name: "To do" })).toBeFocused();
  await awaitSavedAfter(page, seq);
  s = await storedState(page);
  expect(s.cards.some(([id]) => id === gamma)).toBe(false);

  // 9. A-11 export by keyboard
  const downloadPromise = page.waitForEvent("download");
  await press(page, btn(page, "Export capsule (.gscap)"));
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/^patchboard_kb-board_[0-9a-f]{8}_\d{8}T\d{6}Z\.gscap$/);
  const path = testInfo.outputPath("kb.gscap");
  await dl.saveAs(path);
  expect(await decodeCapsuleFile(path)).toEqual(s.cards);
  await p.context.close();
});
