import { expect, test } from "@playwright/test";
import {
  addCardUi,
  awaitSaved,
  btn,
  cardIn,
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

const BOARD_ID = "draft-board";

test("E2E-PB-20: a focused uncommitted draft survives an applied import and a refresh", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser, BOARD_ID);
  const b = await offlineProfileOnBoard(browser, BOARD_ID);

  // 1. Setup, flushed: A adds X and Y; B imports A's seed.
  const x = await addCardUi(a.page, "Draft spec", "Outline");
  const y = await addCardUi(a.page, "Write tests");
  await awaitSaved(a.page);
  const seed = await exportCapsule(a.page, testInfo, "seed.gscap");
  await importFile(b.page, seed);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  expect(await readUiBoard(b.page)).toEqual(await readUiBoard(a.page));
  const pre = await storedState(a.page);
  expect(validCard(pre.cards, x)).toEqual({ title: "Draft spec", notes: "Outline", placement: "todo|00001024" });
  expect(validCard(pre.cards, y)).toEqual({ title: "Write tests", notes: "", placement: "todo|00002048" });
  const s0 = await saveSequence(a.page);

  // 2. B changes Y independently and exports a real capsule from its own UI.
  await press(b.page, btn(b.page, "Edit card: Write tests"));
  await b.page.getByTestId("card-edit-form").getByLabel("Title").fill("Write tests v2");
  await press(b.page, btn(b.page, "Save card: Write tests"));
  await expect(cardIn(b.page, "todo", y).getByTestId("card-title")).toHaveText("Write tests v2");
  await awaitSaved(b.page);
  const bY = await exportCapsule(b.page, testInfo, "b-y.gscap", true);

  // 3. On A: open X's editor and type a draft WITHOUT committing.
  await press(a.page, btn(a.page, "Edit card: Draft spec"));
  const input = a.page.getByTestId("card-edit-form").getByLabel("Title");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Draft spec");
  await a.page.keyboard.press("End");
  await a.page.keyboard.type(" WIP");
  await expect(input).toHaveValue("Draft spec WIP");
  const caret = await input.evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd]);
  expect(caret).toEqual([14, 14]);
  const editor = await input.elementHandle();
  expect(editor).not.toBeNull();
  const rev0 = Number(await a.page.getByTestId("board").getAttribute("data-board-revision"));
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "saved");
  expect(await saveSequence(a.page)).toBe(s0);
  expect(validCard((await storedState(a.page)).cards, x)?.title).toBe("Draft spec");

  // 4. Import B's capsule with Playwright file-input automation (does not move focus).
  await importFile(a.page, bY);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");

  // 5. Assertions on A, in order.
  // 5.1 focus preserved on the SAME node
  expect(await a.page.evaluate((el) => el === document.activeElement, editor)).toBe(true);
  expect(await editor?.evaluate((el) => el.isConnected)).toBe(true);
  expect(await editor?.evaluate((el) => (el as HTMLInputElement).value)).toBe("Draft spec WIP");
  expect(await editor?.evaluate((el) => [(el as HTMLInputElement).selectionStart, (el as HTMLInputElement).selectionEnd])).toEqual([14, 14]);
  // 5.2 the refresh really happened
  await expect.poll(async () => Number(await a.page.getByTestId("board").getAttribute("data-board-revision"))).toBeGreaterThan(rev0);
  await expect(cardIn(a.page, "todo", y).getByTestId("card-title")).toHaveText("Write tests v2");
  await expect(a.page.getByTestId("merge-summary")).toContainText("Title changed: Write tests to Write tests v2");
  await expectImportMeta(a.page, bY, BOARD_ID);
  expect(await saveSequence(a.page)).toBeGreaterThan(s0);
  // 5.3 draft visible and uncommitted
  await expect(input).toHaveValue("Draft spec WIP");
  await expect(a.page.getByTestId("card-edit-form")).toHaveCount(1);
  await expect(cardIn(a.page, "todo", x).getByTestId("card-title")).toHaveText("Draft spec");
  expect(validCard((await storedState(a.page)).cards, x)).toEqual({ title: "Draft spec", notes: "Outline", placement: "todo|00001024" });

  // 6. Commit by keyboard.
  const afterImport = await saveSequence(a.page);
  await press(a.page, btn(a.page, "Save card: Draft spec"));
  await expect(cardIn(a.page, "todo", x).getByTestId("card-title")).toHaveText("Draft spec WIP");
  await expect.poll(async () => saveSequence(a.page)).toBeGreaterThan(afterImport);
  await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "saved");
  const committed = await storedState(a.page);
  expect(validCard(committed.cards, x)).toEqual({ title: "Draft spec WIP", notes: "Outline", placement: "todo|00001024" });
  expect(validCard(committed.cards, y)?.title).toBe("Write tests v2");

  // 7. Reload offline: both edits are in the DOM and in the stored record.
  const rid = await a.page.locator("main").getAttribute("data-replica-id");
  const uiBefore = await readUiBoard(a.page);
  await a.page.reload();
  await expect(a.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await expect(a.page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(cardIn(a.page, "todo", x).getByTestId("card-title")).toHaveText("Draft spec WIP");
  await expect(cardIn(a.page, "todo", y).getByTestId("card-title")).toHaveText("Write tests v2");
  expect(await readUiBoard(a.page)).toEqual(uiBefore);
  const reloaded = await storedState(a.page);
  expect(validCard(reloaded.cards, x)).toEqual({ title: "Draft spec WIP", notes: "Outline", placement: "todo|00001024" });
  expect(validCard(reloaded.cards, y)).toEqual({ title: "Write tests v2", notes: "", placement: "todo|00002048" });
  await expect(a.page.locator("main")).toHaveAttribute("data-replica-id", rid ?? "");
  await a.context.close();
  await b.context.close();
});
