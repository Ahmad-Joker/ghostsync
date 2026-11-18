import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import type { EntityAdapter, Replica } from "@ghostsync/kit";
import { checklistItemAdapter, type ChecklistItem } from "../src/model/adapters.js";
import {
  DOC,
  addItemUi,
  awaitSaved,
  awaitSavedAfter,
  decodeBytes,
  editText,
  exportCapsule,
  expectImportMeta,
  importFile,
  importResult,
  itemIds,
  itemTexts,
  offlineProfileInIncident,
  readStoredRecords,
  readUiModel,
  rowId,
  saveIndicator,
  saveSequence,
  storedState,
  type DecodedState,
} from "./helpers.js";

const kit = createKit();
const item = (text: string, sortKey: number): ChecklistItem => ({ text, done: false, sortKey, createdBy: "fixture", createdAt: 1 });

async function capsuleFrom(r: Replica): Promise<Uint8Array> {
  return encodeCapsule({ app: "fieldledger", documentId: DOC, update: r.exportState() });
}

// ORD-FIX-1 (design 14.4.1), scrambled insertion order; expectations are hand-written literals.
const FIXTURE: Array<[string, string, number]> = [
  ["ci-c3", "Check valve", 2048],
  ["ci-f6", "Sign off", 4096],
  ["ci-a1", "Close inlet", 2048],
  ["ci-b2", "Record flow", 2048],
  ["ci-e5", "Tag out valve", 512],
  ["ci-B2", "Photograph gauge", 2048],
  ["ci-d4", "Isolate pump", 1024],
  ["ci-a", "Log pressure", 2048],
];
const ORD_BASE_EXPECTED = ["ci-e5", "ci-d4", "ci-B2", "ci-a", "ci-a1", "ci-b2", "ci-c3", "ci-f6"];
const ORD_CONCURRENT_EXPECTED = [...ORD_BASE_EXPECTED, "ci-n1", "ci-n2"];

function baseReplica(): Replica {
  const r = kit.createReplica(DOC);
  const items = r.collection(checklistItemAdapter);
  for (const [id, text, key] of FIXTURE) items.put(id, item(text, key));
  return r;
}

test("concurrent inserts and ordering use the literal ORD-FIX-1 sequences (E2E-FL-07)", async ({ browser }, testInfo) => {
  const base = baseReplica();
  const baseBytes = base.exportState().bytes;
  const fromBase = (): Replica => kit.createReplica(DOC, baseBytes);
  const ra = fromBase();
  ra.collection(checklistItemAdapter).put("ci-n2", item("A item", 5120));
  const rb = fromBase();
  rb.collection(checklistItemAdapter).put("ci-n1", item("B item", 5120));
  const files = { base: testInfo.outputPath("ord-base.gscap"), a: testInfo.outputPath("ord-a.gscap"), b: testInfo.outputPath("ord-b.gscap") };
  writeFileSync(files.base, await capsuleFrom(base));
  writeFileSync(files.a, await capsuleFrom(ra));
  writeFileSync(files.b, await capsuleFrom(rb));

  const a = await offlineProfileInIncident(browser);
  const b = await offlineProfileInIncident(browser);
  for (const p of [a, b]) {
    await importFile(p.page, files.base);
    await expect(importResult(p.page)).toHaveAttribute("data-import-state", "applied-saved");
    await expectImportMeta(p.page, files.base);
    await expect.poll(() => itemIds(p.page)).toEqual(ORD_BASE_EXPECTED);
  }
  await importFile(a.page, files.a);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await importFile(b.page, files.b);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await awaitSaved(a.page);
  await awaitSaved(b.page);
  const fromA = await exportCapsule(a.page, testInfo, "ord-from-a.gscap");
  const fromB = await exportCapsule(b.page, testInfo, "ord-from-b.gscap");
  await importFile(b.page, fromA);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await importFile(a.page, fromB);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  for (const p of [a, b]) await expect.poll(() => itemIds(p.page)).toEqual(ORD_CONCURRENT_EXPECTED);

  const sa = await storedState(a.page);
  const sb = await storedState(b.page);
  const key = (s: DecodedState, id: string): number | undefined => {
    const r = s.items.find(([i]) => i === id)?.[1];
    return r?.ok ? r.entity.sortKey : undefined;
  };
  expect(key(sa.state, "ci-n1")).toBe(5120);
  expect(key(sa.state, "ci-n2")).toBe(5120);
  expect(sa.state.items.map(([id]) => id).sort()).toEqual([...ORD_CONCURRENT_EXPECTED].sort());
  expect(sa.state).toEqual(sb.state);
  await a.context.close();
  await b.context.close();
});

test("app-generated IDs with equal sortKeys order identically on both profiles (E2E-FL-07 part 2)", async ({ browser }, testInfo) => {
  const base = baseReplica();
  const baseFile = testInfo.outputPath("ord-base2.gscap");
  writeFileSync(baseFile, await capsuleFrom(base));
  const a = await offlineProfileInIncident(browser);
  const b = await offlineProfileInIncident(browser);
  for (const p of [a, b]) {
    await importFile(p.page, baseFile);
    await expect(importResult(p.page)).toHaveAttribute("data-import-state", "applied-saved");
    await expect.poll(() => itemIds(p.page)).toEqual(ORD_BASE_EXPECTED);
  }
  await addItemUi(a.page, "A item");
  await addItemUi(b.page, "B item");
  await awaitSaved(a.page);
  await awaitSaved(b.page);
  const idA = await rowId(a.page, "A item");
  const idB = await rowId(b.page, "B item");
  const sa = await storedState(a.page);
  const sb = await storedState(b.page);
  const keyOf = (s: DecodedState, id: string): number | undefined => {
    const r = s.items.find(([i]) => i === id)?.[1];
    return r?.ok ? r.entity.sortKey : undefined;
  };
  expect(keyOf(sa.state, idA)).toBe(5120);
  expect(keyOf(sb.state, idB)).toBe(5120);
  const fromA = await exportCapsule(a.page, testInfo, "p2-a.gscap");
  const fromB = await exportCapsule(b.page, testInfo, "p2-b.gscap");
  await importFile(b.page, fromA);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await importFile(a.page, fromB);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  const expected = [...ORD_BASE_EXPECTED, ...[idA, idB].sort()];
  for (const p of [a, b]) await expect.poll(() => itemIds(p.page)).toEqual(expected);
  await a.context.close();
  await b.context.close();
});

test("delete versus edit of an existing field: CHARACTERIZATION (E2E-FL-08)", async ({ browser }, testInfo) => {
  const q = kit.createReplica(DOC);
  q.collection(checklistItemAdapter).put("ci-q", item("Check valve", 1024));
  const qFile = testInfo.outputPath("q-base.gscap");
  writeFileSync(qFile, await capsuleFrom(q));

  const a = await offlineProfileInIncident(browser);
  const b = await offlineProfileInIncident(browser);
  const pageErrors: string[] = [];
  for (const p of [a, b]) p.page.on("pageerror", (e) => pageErrors.push(e.message));
  for (const p of [a, b]) {
    await importFile(p.page, qFile);
    await expect(importResult(p.page)).toHaveAttribute("data-import-state", "applied-saved");
    await expect.poll(() => itemTexts(p.page)).toEqual(["Check valve"]);
  }
  await a.page.getByRole("button", { name: "Delete item: Check valve" }).click();
  await expect.poll(() => itemIds(a.page)).toEqual([]);
  await editText(b.page, "ci-q", "Check valve seat");
  await awaitSaved(a.page);
  await awaitSaved(b.page);

  const fromA = await exportCapsule(a.page, testInfo, "q-a.gscap");
  const fromB = await exportCapsule(b.page, testInfo, "q-b.gscap");
  await importFile(b.page, fromA);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await importFile(a.page, fromB);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await awaitSaved(a.page);
  await awaitSaved(b.page);

  // (a) decoded states deep-equal; (c) same checklist on both pages
  const sa = await storedState(a.page);
  const sb = await storedState(b.page);
  expect(sa.state).toEqual(sb.state);
  expect(await itemIds(a.page)).toEqual(await itemIds(b.page));
  expect(pageErrors).toEqual([]);

  // (b) the item shape is exactly one of the enumerated acceptable shapes
  const qa = sa.state.items.find(([id]) => id === "ci-q")?.[1];
  let shape: string;
  if (qa === undefined) shape = "absent";
  else if (qa.ok) {
    expect(qa.entity.text).toBe("Check valve seat");
    shape = "valid-with-edit";
  } else {
    expect(qa.reason).toBe("invalidRecord");
    shape = `invalidRecord(fields=${JSON.stringify(qa.reason === "invalidRecord" ? qa.fields : null)})`;
  }
  process.stdout.write(`[characterization] E2E-FL-08 observed shape on both profiles: ${shape}\n`);
  if (shape.startsWith("invalidRecord")) {
    for (const p of [a, b]) {
      const row = p.page.locator('li[data-item-id="ci-q"]');
      await expect(row).toContainText("Conflicted or incomplete item");
      await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();
      await expect(row.getByRole("button", { name: "Discard" })).toBeVisible();
    }
  }
  await a.context.close();
  await b.context.close();
});

test("import input is disabled while an import runs (E2E-FL-17)", async ({ browser }, testInfo) => {
  const src = kit.createReplica(DOC);
  src.collection(checklistItemAdapter).put("ci-s1", item("From A", 1024));
  const file = testInfo.outputPath("held.gscap");
  writeFileSync(file, await capsuleFrom(src));

  const b = await offlineProfileInIncident(browser);
  await addItemUi(b.page, "B data");
  await awaitSaved(b.page);
  const S = await saveSequence(b.page);
  const input = b.page.getByTestId("import-input");
  await b.page.evaluate(() => (window as unknown as { __ghostsyncTest: { holdNextFileRead(): void } }).__ghostsyncTest.holdNextFileRead());
  await input.setInputFiles(file);
  await expect(input).toBeDisabled();
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "importing");
  expect((await readStoredRecords(b.page))[0]?.sequence).toBe(S);
  await b.page.evaluate(() => (window as unknown as { __ghostsyncTest: { releaseFileRead(): void } }).__ghostsyncTest.releaseFileRead());
  await expect(input).toBeEnabled();
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(input).toHaveValue("");
  await awaitSavedAfter(b.page, S);
  const after = await storedState(b.page);
  expect(after.record.sequence).toBeGreaterThan(S);
  expect(after.state.items.flatMap(([, r]) => (r.ok ? [r.entity.text] : [])).sort()).toEqual(["B data", "From A"]);
  await b.context.close();
});

test("invalid record is rendered, never auto-repaired, and Restore is explicit (E2E-FL-18)", async ({ browser }, testInfo) => {
  // A test-local PARTIAL adapter with the same schema identity writes only `text`.
  const partial: EntityAdapter<{ text: string }> = {
    schema: checklistItemAdapter.schema,
    validate: () => undefined,
    toFields: (e) => ({ text: e.text }),
    fromFields: (f) => ({ text: String(f.text) }),
  };
  const w = kit.createReplica(DOC);
  w.collection(partial).put("ci-q1", { text: "Half item" });
  const file = testInfo.outputPath("incomplete.gscap");
  writeFileSync(file, await capsuleFrom(w));

  const a = await offlineProfileInIncident(browser);
  await importFile(a.page, file);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await awaitSaved(a.page);
  const row = a.page.locator('li[data-item-id="ci-q1"]');
  await expect(row).toContainText("Conflicted or incomplete item");
  await expect(row).toContainText("Half item");
  await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(row.getByLabel("Item text")).toHaveCount(0); // not a normal row: nothing auto-repaired
  const before = await storedState(a.page);
  const q1 = before.state.items.find(([id]) => id === "ci-q1")?.[1];
  expect(q1?.ok).toBe(false);
  expect(q1 && !q1.ok && q1.reason === "invalidRecord" ? q1.fields : null).toEqual({ text: "Half item" });

  const seq = await saveSequence(a.page);
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row.getByLabel("Item text")).toHaveValue("Half item");
  await expect(row.getByLabel(/^Done/)).not.toBeChecked();
  await awaitSavedAfter(a.page, seq);
  const after = await storedState(a.page);
  const r = after.state.items.find(([id]) => id === "ci-q1")?.[1];
  expect(r?.ok && r.entity).toMatchObject({ text: "Half item", done: false, sortKey: 1024, createdAt: expect.any(Number) });
  expect((await readUiModel(a.page)).items).toEqual([{ id: "ci-q1", text: "Half item", done: false }]);
  expect(saveIndicator(a.page)).toBeTruthy();
  await a.context.close();
});

void decodeBytes;
