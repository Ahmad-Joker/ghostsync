import { expect, test } from "@playwright/test";
import {
  BOARD,
  addCardUi,
  awaitSaved,
  awaitSavedAfter,
  btn,
  cardIn,
  decodeCapsuleFile,
  exportCapsule,
  expectImportMeta,
  importFile,
  importResult,
  offlineProfileOnBoard,
  readUiBoard,
  saveSequence,
  storedState,
  validCard,
} from "./helpers.js";

test("E2E-PB-01: one profile moves a card while the other edits it; real files both ways; offline reload", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser);
  const b = await offlineProfileOnBoard(browser);

  // 1. A adds two cards, awaits saved, exports seed.gscap.
  const x = await addCardUi(a.page, "Draft spec", "Outline");
  await addCardUi(a.page, "Write tests");
  await awaitSaved(a.page);
  const seed = await exportCapsule(a.page, testInfo, "seed.gscap");

  // 2. B imports seed.gscap; both boards identical, replica ids differ.
  await importFile(b.page, seed);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expectImportMeta(b.page, seed);
  expect(await readUiBoard(b.page)).toEqual(await readUiBoard(a.page));
  const ridA = await a.page.locator("main").getAttribute("data-replica-id");
  const ridB = await b.page.locator("main").getAttribute("data-replica-id");
  expect(ridA).not.toBe(ridB);

  // 3. Same card ID on both, stored in To do.
  await expect(cardIn(b.page, "todo", x)).toHaveCount(1);
  for (const p of [a, b]) {
    const s = await storedState(p.page);
    expect(validCard(s.cards, x)?.placement).toBe("todo|00001024");
  }

  // 4. A moves X to Doing; B (no exchange) edits title and notes.
  const seqA = await saveSequence(a.page);
  await btn(a.page, "Move to Doing: Draft spec").click();
  await expect(cardIn(a.page, "doing", x)).toHaveCount(1);
  await awaitSavedAfter(a.page, seqA);
  const seqB = await saveSequence(b.page);
  await btn(b.page, "Edit card: Draft spec").click();
  const form = b.page.getByTestId("card-edit-form");
  await form.getByLabel("Title").fill("Draft spec v2");
  await form.getByLabel("Notes").fill("Outline plus risks");
  await btn(b.page, "Save card: Draft spec").click();
  await expect(cardIn(b.page, "todo", x).getByTestId("card-title")).toHaveText("Draft spec v2");
  await awaitSavedAfter(b.page, seqB);
  const preA = await storedState(a.page);
  expect(validCard(preA.cards, x)).toEqual({ title: "Draft spec", notes: "Outline", placement: "doing|00001024" });
  const preB = await storedState(b.page);
  expect(validCard(preB.cards, x)).toEqual({ title: "Draft spec v2", notes: "Outline plus risks", placement: "todo|00001024" });

  // 5. Real files both ways.
  const a2 = await exportCapsule(a.page, testInfo, "a2.gscap");
  const b2 = await exportCapsule(b.page, testInfo, "b2.gscap");
  await importFile(a.page, b2);
  await importFile(b.page, a2);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");

  // 6. Both show X in Doing with the new title and notes; no duplicate; Write tests unchanged.
  for (const p of [a, b]) {
    await expect(cardIn(p.page, "doing", x)).toHaveCount(1);
    await expect(cardIn(p.page, "doing", x).getByTestId("card-title")).toHaveText("Draft spec v2");
    await expect(cardIn(p.page, "doing", x).getByTestId("card-notes")).toHaveText("Outline plus risks");
    await expect(p.page.locator(`li[data-card-id="${x}"]`)).toHaveCount(1);
  }
  const uiA = await readUiBoard(a.page);
  expect(uiA).toEqual(await readUiBoard(b.page));
  expect(uiA.todo.map((c) => c.title)).toEqual(["Write tests"]);
  expect(uiA.doing).toEqual([{ id: x, title: "Draft spec v2", notes: "Outline plus risks" }]);
  const summaryA = a.page.getByTestId("merge-summary");
  await expect(summaryA).toContainText("Title changed");
  await expect(summaryA).toContainText("Notes changed");
  await expect(b.page.getByTestId("merge-summary")).toContainText("Moved: Draft spec v2, To do to Doing");

  // 7. Displayed metadata equals the Node-decoded metadata of the imported files.
  await expectImportMeta(a.page, b2);
  await expectImportMeta(b.page, a2);

  // 8. Stored state on both: exact placement, title, notes, deep-equal; exported capsules decode the same.
  const finalA = await storedState(a.page);
  const finalB = await storedState(b.page);
  const want = { title: "Draft spec v2", notes: "Outline plus risks", placement: "doing|00001024" };
  expect(validCard(finalA.cards, x)).toEqual(want);
  expect(validCard(finalB.cards, x)).toEqual(want);
  expect(finalA.cards).toEqual(finalB.cards);
  expect(finalA.cards.filter(([id]) => id === x)).toHaveLength(1);
  expect(finalA.cards).toHaveLength(2);
  expect(validCard(await decodeCapsuleFile(a2), x)?.placement).toBe("doing|00001024");
  expect(validCard(await decodeCapsuleFile(b2), x)?.title).toBe("Draft spec v2");

  // 9. Duplicate import is a no-op.
  await importFile(a.page, b2);
  await expect(a.page.getByTestId("merge-summary")).toContainText("No changes");
  expect((await storedState(a.page)).cards).toEqual(finalA.cards);

  // 10. Both reload offline: same board, same replica id, same stored state.
  for (const [p, rid, fin] of [
    [a, ridA, finalA],
    [b, ridB, finalB],
  ] as const) {
    await p.page.reload();
    await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
    await expect(p.page.locator("main")).toHaveAttribute("data-board-id", BOARD);
    await expect(p.page.locator("main")).toHaveAttribute("data-replica-id", rid ?? "");
    await expect(cardIn(p.page, "doing", x).getByTestId("card-title")).toHaveText("Draft spec v2");
    expect(await readUiBoard(p.page)).toEqual(uiA);
    const reloaded = await storedState(p.page);
    expect(validCard(reloaded.cards, x)).toEqual(want);
    expect(reloaded.cards).toEqual(fin.cards);
    expect(reloaded.cards.filter(([id]) => id === x)).toHaveLength(1);
  }

  // 11. After the assertions: screenshots at 1280x800 and 320x640 (evidence only).
  for (const [name, p] of [["A", a], ["B", b]] as const) {
    await p.page.setViewportSize({ width: 1280, height: 800 });
    const desktop = testInfo.outputPath(`${name}-desktop-1280x800.png`);
    await p.page.screenshot({ path: desktop, fullPage: true });
    await testInfo.attach(`${name}-desktop-1280x800`, { path: desktop, contentType: "image/png" });
    await p.page.setViewportSize({ width: 320, height: 640 });
    const narrow = testInfo.outputPath(`${name}-320x640.png`);
    await p.page.screenshot({ path: narrow, fullPage: true });
    await testInfo.attach(`${name}-320x640`, { path: narrow, contentType: "image/png" });
  }
  await a.context.close();
  await b.context.close();
});
