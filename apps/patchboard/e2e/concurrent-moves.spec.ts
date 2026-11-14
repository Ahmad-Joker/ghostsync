import { expect, test } from "@playwright/test";
import {
  addCardUi,
  awaitSaved,
  btn,
  cardIn,
  exportCapsule,
  importFile,
  importResult,
  offlineProfileOnBoard,
  readUiBoard,
  storedState,
  validCard,
} from "./helpers.js";

test("E2E-PB-02: concurrent moves of one card, moves of different cards, same-field title edits", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser);
  const b = await offlineProfileOnBoard(browser);
  const x = await addCardUi(a.page, "Card X");
  const y = await addCardUi(a.page, "Card Y");
  const z = await addCardUi(a.page, "Card Z");
  const w = await addCardUi(a.page, "Card W");
  await awaitSaved(a.page);
  const seed = await exportCapsule(a.page, testInfo, "seed.gscap");
  await importFile(b.page, seed);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");

  // A: X to Doing, then Y to Doing, W title Alpha. B: X to Done, then Z to Done, W title Beta.
  await btn(a.page, "Move to Doing: Card X").click();
  await expect(cardIn(a.page, "doing", x)).toHaveCount(1);
  await btn(a.page, "Move to Doing: Card Y").click();
  await expect(cardIn(a.page, "doing", y)).toHaveCount(1);
  await btn(a.page, "Edit card: Card W").click();
  await a.page.getByTestId("card-edit-form").getByLabel("Title").fill("Alpha");
  await btn(a.page, "Save card: Card W").click();
  await expect(cardIn(a.page, "todo", w).getByTestId("card-title")).toHaveText("Alpha");
  await awaitSaved(a.page);

  await btn(b.page, "Move to Done: Card X").click();
  await expect(cardIn(b.page, "done", x)).toHaveCount(1);
  await btn(b.page, "Move to Done: Card Z").click();
  await expect(cardIn(b.page, "done", z)).toHaveCount(1);
  await btn(b.page, "Edit card: Card W").click();
  await b.page.getByTestId("card-edit-form").getByLabel("Title").fill("Beta");
  await btn(b.page, "Save card: Card W").click();
  await expect(cardIn(b.page, "todo", w).getByTestId("card-title")).toHaveText("Beta");
  await awaitSaved(b.page);

  const fa = await exportCapsule(a.page, testInfo, "a.gscap");
  const fb = await exportCapsule(b.page, testInfo, "b.gscap");
  await importFile(a.page, fb);
  await importFile(b.page, fa);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");

  for (const p of [a, b]) {
    await expect(p.page.locator(`li[data-card-id="${x}"]`)).toHaveCount(1);
    await expect(cardIn(p.page, "doing", y)).toHaveCount(1);
    await expect(cardIn(p.page, "done", z)).toHaveCount(1);
    await expect(p.page.getByTestId("merge-help")).toContainText("Which one is not decided by clock time");
  }
  const uiA = await readUiBoard(a.page);
  const uiB = await readUiBoard(b.page);
  expect(uiA).toEqual(uiB);
  const xColumn = (["doing", "done"] as const).filter((c) => uiA[c].some((card) => card.id === x));
  expect(xColumn).toHaveLength(1);
  const titleW = [...uiA.todo, ...uiA.doing, ...uiA.done].find((c) => c.id === w)?.title ?? "";
  expect(["Alpha", "Beta"]).toContain(titleW);

  const sa = await storedState(a.page);
  const sb = await storedState(b.page);
  expect(sa.cards).toEqual(sb.cards);
  expect(sa.cards.filter(([id]) => id === x)).toHaveLength(1);
  expect(["doing|00001024", "done|00001024"]).toContain(validCard(sa.cards, x)?.placement);
  expect(validCard(sa.cards, x)?.placement.startsWith(xColumn[0] ?? "?")).toBe(true);
  expect(validCard(sa.cards, y)?.placement).toBe("doing|00002048");
  expect(validCard(sa.cards, z)?.placement).toBe("done|00002048");
  expect(["Alpha", "Beta"]).toContain(validCard(sa.cards, w)?.title);
  await a.context.close();
  await b.context.close();
});