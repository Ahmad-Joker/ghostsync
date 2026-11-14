import { expect, test, type Browser, type TestInfo } from "@playwright/test";
import {
  addCardUi,
  awaitSaved,
  btn,
  exportCapsule,
  importFile,
  importResult,
  offlineProfileOnBoard,
  press,
  readUiBoard,
  storedState,
  type DecodedCards,
} from "./helpers.js";

type Shape = "absent" | "valid" | "invalidRecord";
const shapeOf = (cards: DecodedCards, id: string): { shape: Shape; fields?: unknown } => {
  const hit = cards.find(([i]) => i === id)?.[1];
  if (hit === undefined) return { shape: "absent" };
  if (hit.ok) return { shape: "valid", fields: hit.entity };
  return hit.reason === "invalidRecord" ? { shape: "invalidRecord", fields: hit.fields } : { shape: "absent" };
};

async function scenario(
  browser: Browser,
  testInfo: TestInfo,
  concurrent: (b: Awaited<ReturnType<typeof offlineProfileOnBoard>>, id: string) => Promise<void>,
): Promise<void> {
  const a = await offlineProfileOnBoard(browser);
  const b = await offlineProfileOnBoard(browser);
  const q = await addCardUi(a.page, "Check valve", "n");
  await awaitSaved(a.page);
  const seed = await exportCapsule(a.page, testInfo, "seed.gscap");
  await importFile(b.page, seed);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");

  // A deletes through the UI; B edits or moves.
  await press(a.page, btn(a.page, "Delete card: Check valve"));
  await press(a.page, btn(a.page, "Confirm delete: Check valve"));
  await expect(a.page.locator(`li[data-card-id="${q}"]`)).toHaveCount(0);
  await awaitSaved(a.page);
  await concurrent(b, q);
  await awaitSaved(b.page);

  const fa = await exportCapsule(a.page, testInfo, "a.gscap");
  const fb = await exportCapsule(b.page, testInfo, "b.gscap");
  await importFile(a.page, fb);
  await importFile(b.page, fa);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");

  // Convergence is asserted; the observed outcome is recorded, not promised.
  expect(await readUiBoard(a.page)).toEqual(await readUiBoard(b.page));
  const sa = await storedState(a.page);
  const sb = await storedState(b.page);
  expect(sa.cards).toEqual(sb.cards);
  const observed = shapeOf(sa.cards, q);
  expect(["absent", "valid", "invalidRecord"]).toContain(observed.shape);
  expect(shapeOf(sb.cards, q)).toEqual(observed);
  testInfo.annotations.push({ type: "observed-shape", description: JSON.stringify(observed) });
  process.stdout.write(`[characterization] ${testInfo.title}: ${JSON.stringify(observed)}\n`);
  await a.context.close();
  await b.context.close();
}

test("E2E-PB-06: delete versus edit of an existing field converges (observed shape recorded)", async ({ browser }, testInfo) => {
  await scenario(browser, testInfo, async (b) => {
    await press(b.page, btn(b.page, "Edit card: Check valve"));
    await b.page.getByTestId("card-edit-form").getByLabel("Title").fill("Check valve 2");
    await press(b.page, btn(b.page, "Save card: Check valve"));
    await expect(b.page.getByTestId("card-title")).toHaveText("Check valve 2");
  });
});

test("E2E-PB-07: delete versus move converges (observed shape recorded)", async ({ browser }, testInfo) => {
  await scenario(browser, testInfo, async (b, id) => {
    await press(b.page, btn(b.page, "Move to Doing: Check valve"));
    await expect(b.page.locator(`[data-testid="column-doing"] li[data-card-id="${id}"]`)).toHaveCount(1);
  });
});