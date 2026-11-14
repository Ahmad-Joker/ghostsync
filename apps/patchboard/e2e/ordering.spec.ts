import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createKit } from "@ghostsync/kit";
import { encodeCapsule } from "@ghostsync/capsule";
import { cardAdapter } from "../src/model/adapters.js";
import { ORD_DOING_EXPECTED, ORD_DONE_EXPECTED, ORD_FIXTURE, ORD_TODO_CONCURRENT_EXPECTED } from "../tests/fixtures.js";
import { importFile, importResult, offlineProfileOnBoard, storedState, validCard } from "./helpers.js";

const BOARD_ID = "order-fixture";

test("E2E-PB-09: ordering fixture ORD-FIX-PB-1 and the concurrent-insert case, against hand-written literals", async ({ browser }, testInfo) => {
  // Node-built capsule with the REAL card adapter. Two replicas each add one card with the same position
  // (the concurrent insert), then merge into one exported state.
  const kit = createKit();
  const r0 = kit.createReplica(BOARD_ID);
  const c0 = r0.collection(cardAdapter);
  for (const [id, card] of [...ORD_FIXTURE].reverse()) c0.put(id, card);
  const seedBytes = r0.exportState().bytes;
  const r1 = kit.createReplica(BOARD_ID, seedBytes);
  const r2 = kit.createReplica(BOARD_ID, seedBytes);
  r1.collection(cardAdapter).put("card-n2", { title: "Concurrent B", notes: "", placement: "todo|00003072" });
  r2.collection(cardAdapter).put("card-n1", { title: "Concurrent A", notes: "", placement: "todo|00003072" });
  r1.applyUpdate(r2.exportState());
  const bytes = await encodeCapsule({ app: "patchboard", documentId: BOARD_ID, update: r1.exportState() });
  for (const r of [r0, r1, r2]) r.destroy();
  const file = testInfo.outputPath("order.gscap");
  writeFileSync(file, bytes);

  const p = await offlineProfileOnBoard(browser, BOARD_ID);
  await importFile(p.page, file);
  await expect(importResult(p.page)).toHaveAttribute("data-import-state", "applied-saved");
  const order = (col: string): Promise<string[]> =>
    p.page.locator(`[data-testid="column-${col}"] li[data-card-id]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-card-id") ?? ""));
  await expect.poll(() => order("todo")).toEqual(ORD_TODO_CONCURRENT_EXPECTED);
  expect(await order("doing")).toEqual(ORD_DOING_EXPECTED);
  expect(await order("done")).toEqual(ORD_DONE_EXPECTED);

  const s = await storedState(p.page);
  for (const [id, card] of ORD_FIXTURE) expect(validCard(s.cards, id)?.placement).toBe(card.placement);
  expect(validCard(s.cards, "card-n1")?.placement).toBe("todo|00003072");
  expect(validCard(s.cards, "card-n2")?.placement).toBe("todo|00003072");

  await p.page.reload();
  await expect(p.page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect.poll(() => order("todo")).toEqual(ORD_TODO_CONCURRENT_EXPECTED);
  await p.context.close();
});