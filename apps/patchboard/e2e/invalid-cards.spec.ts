import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  activeCardId,
  btn,
  buildCapsule,
  importFile,
  importResult,
  offlineProfileOnBoard,
  probeAdapter,
  press,
  readStoredRecords,
  readUiBoard,
  saveIndicator,
  saveSequence,
  storedState,
} from "./helpers.js";

const BOARD_ID = "invalid-board";
const HOSTILE = "<img src=x onerror=alert(1)>";

const rawFields = (cards: Awaited<ReturnType<typeof storedState>>["cards"], id: string): unknown => {
  const hit = cards.find(([i]) => i === id)?.[1];
  if (hit === undefined) return undefined;
  return hit.ok ? hit.entity : hit.reason === "invalidRecord" ? hit.fields : undefined;
};

test("E2E-PB-08: incomplete cards render as text and are repaired or discarded only by keyboard actions", async ({ browser }, testInfo) => {
  const records: Record<string, Record<string, string>> = {
    "card-ok1": { title: "Valid card", notes: "", placement: "todo|00001024" },
    "card-inv1": { placement: "doing|00001024" },
    "card-inv2": { title: "Bad placement", notes: "", placement: "archive|0001" },
    "card-inv3": { title: HOSTILE },
  };
  const bytes = await buildCapsule(BOARD_ID, "patchboard", (r) => {
    const probe = r.collection(probeAdapter);
    for (const [id, f] of Object.entries(records)) probe.put(id, f);
  });
  const file = testInfo.outputPath("invalid.gscap");
  writeFileSync(file, bytes);

  const p = await offlineProfileOnBoard(browser, BOARD_ID);
  const page = p.page;
  await importFile(page, file);
  await expect(importResult(page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");

  // Step 1: BEFORE any action.
  const first = await storedState(page);
  for (const [id, f] of Object.entries(records)) expect(rawFields(first.cards, id)).toEqual(f);
  const region = page.getByTestId("invalid-cards");
  await expect(region.getByRole("heading", { name: "Conflicted or incomplete cards (3)" })).toBeVisible();
  const ui = await readUiBoard(page);
  expect(ui.todo.map((c) => c.id)).toEqual(["card-ok1"]);
  expect(ui.doing).toEqual([]);
  expect(ui.done).toEqual([]);
  expect(ui.invalid.sort()).toEqual(["card-inv1", "card-inv2", "card-inv3"]);
  expect(await page.evaluate(() => document.querySelectorAll("img").length)).toBe(0);
  await expect(region.getByText(`title: ${HOSTILE}`)).toBeVisible();
  await expect(region.getByText("Conflicted or incomplete card", { exact: true })).toHaveCount(3);
  for (const label of ["card-inv1", "Bad placement", HOSTILE]) {
    await expect(btn(page, `Restore card: ${label}`)).toHaveCount(1);
    await expect(btn(page, `Discard card: ${label}`)).toHaveCount(1);
  }
  await expect(btn(page, "Restore")).toHaveCount(0);
  await expect(btn(page, "Discard")).toHaveCount(0);
  await expect(region.getByRole("button", { name: /^(Move|Edit|Delete)/ })).toHaveCount(0);

  // Step 2: RESTORE card-inv1.
  let seq = await saveSequence(page);
  await press(page, btn(page, "Restore card: card-inv1"));
  const inv1 = page.locator('[data-testid="column-doing"] li[data-card-id="card-inv1"]');
  await expect(inv1).toHaveCount(1);
  await expect(page.locator('[data-testid="invalid-cards"] li[data-card-id="card-inv1"]')).toHaveCount(0);
  await expect(inv1).not.toHaveAttribute("data-invalid", /.*/);
  await expect(inv1.getByTestId("card-title")).toHaveText("Untitled card");
  await expect(inv1.getByTestId("card-notes")).toHaveText("");
  await expect(region.getByRole("heading", { name: "Conflicted or incomplete cards (2)" })).toBeVisible();
  await expect.poll(async () => saveSequence(page)).toBeGreaterThan(seq);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  seq = await saveSequence(page);
  expect(await activeCardId(page)).toBe("card-inv1");
  expect(rawFields((await storedState(page)).cards, "card-inv1")).toEqual({ title: "Untitled card", notes: "", placement: "doing|00001024" });

  // Step 3: RESTORE card-inv2 (placement goes to the end of To do).
  await press(page, btn(page, "Restore card: Bad placement"));
  await expect.poll(async () => (await readUiBoard(page)).todo.map((c) => c.id)).toEqual(["card-ok1", "card-inv2"]);
  await expect(page.locator('[data-testid="column-todo"] li[data-card-id="card-inv2"] [data-testid="card-title"]')).toHaveText("Bad placement");
  await expect.poll(async () => saveSequence(page)).toBeGreaterThan(seq);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  seq = await saveSequence(page);
  expect(rawFields((await storedState(page)).cards, "card-inv2")).toEqual({ title: "Bad placement", notes: "", placement: "todo|00002048" });

  // Step 4: DISCARD card-inv3 with Keep and then Confirm.
  const row = page.locator('[data-testid="invalid-cards"] li[data-card-id="card-inv3"]');
  await press(page, btn(page, `Discard card: ${HOSTILE}`));
  await expect(btn(page, `Confirm discard: ${HOSTILE}`)).toBeVisible();
  await expect(btn(page, `Keep incomplete card: ${HOSTILE}`)).toBeVisible();
  expect(rawFields((await storedState(page)).cards, "card-inv3")).toEqual({ title: HOSTILE });
  expect(await saveSequence(page)).toBe(seq);
  await press(page, btn(page, `Keep incomplete card: ${HOSTILE}`));
  await expect(btn(page, `Confirm discard: ${HOSTILE}`)).toBeHidden();
  await expect(row).toHaveCount(1);
  expect(rawFields((await storedState(page)).cards, "card-inv3")).toEqual({ title: HOSTILE });
  expect(await saveSequence(page)).toBe(seq);
  await press(page, btn(page, `Discard card: ${HOSTILE}`));
  await press(page, btn(page, `Confirm discard: ${HOSTILE}`), "Space");
  await expect(row).toHaveCount(0);
  await expect(region.getByRole("heading", { name: "Conflicted or incomplete cards (0)" })).toBeFocused();
  await expect.poll(async () => saveSequence(page)).toBeGreaterThan(seq);
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  const after = await storedState(page);
  expect(after.cards.some(([id]) => id === "card-inv3")).toBe(false);
  expect(rawFields(after.cards, "card-ok1")).toEqual(records["card-ok1"]);
  expect(rawFields(after.cards, "card-inv1")).toEqual({ title: "Untitled card", notes: "", placement: "doing|00001024" });

  // Step 5: offline reload.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect.poll(async () => (await readUiBoard(page)).todo.map((c) => c.id)).toEqual(["card-ok1", "card-inv2"]);
  const ui2 = await readUiBoard(page);
  expect(ui2.doing.map((c) => c.id)).toEqual(["card-inv1"]);
  expect(ui2.invalid).toEqual([]);
  expect((await storedState(page)).cards).toEqual(after.cards);
  expect((await readStoredRecords(page))).toHaveLength(1);
  await p.context.close();
});
