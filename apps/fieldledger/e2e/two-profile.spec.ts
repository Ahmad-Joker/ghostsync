import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  DOC,
  PNG_SIGNATURE,
  addItemUi,
  awaitSaved,
  awaitSavedAfter,
  createDetails,
  exportCapsule,
  expectImportMeta,
  importFile,
  importResult,
  itemIds,
  lastDownloadName,
  join,
  loadUntilOfflineReady,
  newProfile,
  readUiModel,
  saveSequence,
  storedState,
  storedTexts,
  type UiModel,
} from "./helpers.js";
import { existsSync, readFileSync, statSync } from "node:fs";

/** Locator of the checklist row whose text input currently holds `text`. */
async function rowId(page: Page, text: string): Promise<string> {
  const model = await readUiModel(page);
  const hit = model.items.find((i) => "text" in i && i.text === text);
  expect(hit, `row with text "${text}"`).toBeDefined();
  return hit?.id ?? "";
}

async function editText(page: Page, id: string, text: string): Promise<void> {
  const input = page.locator(`li[data-item-id="${id}"]`).getByLabel("Item text");
  await input.fill(text);
  await input.press("Enter");
}

test("two profiles: join, work offline, exchange real .gscap files, converge, keep state after offline reload", async ({ browser }, testInfo) => {
  const a = await newProfile(browser);
  const b = await newProfile(browser);
  const requests: string[] = [];
  for (const p of [a, b]) p.page.on("request", (r) => requests.push(r.url()));

  // ---- bootstrap online until genuinely offline-ready, then offline + reload WITHOUT re-enabling ----
  for (const p of [a, b]) {
    await loadUntilOfflineReady(p.page);
    await expect(p.page.getByTestId("network-chip")).toHaveText("Network: online");
    await p.context.setOffline(true);
    await expect(p.page.getByTestId("network-chip")).toHaveText("Network: offline");
    await expect(p.page.getByTestId("transfer-mode")).toHaveText("Transfer: file (.gscap)");
    const res = await p.page.reload();
    expect(res?.fromServiceWorker()).toBe(true);
    await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
    await expect(p.page.getByTestId("network-chip")).toHaveText("Network: offline");
  }

  // ---- E2E-FL-01: same document (normalized), distinct replicas ----
  await join(a.page, " INC-2026-0042 ");
  await join(b.page, "inc-2026-0042");
  const mainA = a.page.locator("main");
  const mainB = b.page.locator("main");
  await expect(mainA).toHaveAttribute("data-document-id", DOC);
  await expect(mainB).toHaveAttribute("data-document-id", DOC);
  const replicaA = (await mainA.getAttribute("data-replica-id")) ?? "";
  const replicaB = (await mainB.getAttribute("data-replica-id")) ?? "";
  expect(replicaA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(replicaB).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(replicaA).not.toBe(replicaB);

  await createDetails(a.page, "Pump station leak");
  for (const t of ["Close inlet", "Check valve", "Log pressure"]) await addItemUi(a.page, t);
  await addItemUi(b.page, "Replace gasket");
  await awaitSaved(a.page);
  await awaitSaved(b.page);
  const sa1 = await storedState(a.page);
  const sb1 = await storedState(b.page);
  expect(sa1.record.app).toBe("fieldledger");
  expect(sa1.record.documentId).toBe(DOC);
  expect(sa1.record.replicaId).toBe(replicaA);
  expect(sb1.record.replicaId).toBe(replicaB);
  expect(storedTexts(sa1.state).sort()).toEqual(["Check valve", "Close inlet", "Log pressure"]);
  expect(storedTexts(sb1.state)).toEqual(["Replace gasket"]);
  expect(sa1.record.sequence).toBe(await saveSequence(a.page));

  // ---- first exchange: A -> B ----
  const fileA1 = await exportCapsule(a.page, testInfo, "a1.gscap");
  expect(readFileSync(fileA1).subarray(0, 5).toString("latin1")).toBe("GSCAP");
  expect(lastDownloadName).toMatch(/^fieldledger_inc-2026-0042_[0-9a-f]{8}_\d{8}T\d{6}Z\.gscap$/);
  const seqB = await saveSequence(b.page);
  await importFile(b.page, fileA1);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expectImportMeta(b.page, fileA1);
  await expect(b.page.getByTestId("merge-summary")).toContainText("Added 3 checklist item(s).");
  await awaitSavedAfter(b.page, seqB);
  expect((await readUiModel(b.page)).items).toHaveLength(4);

  // ---- concurrent offline edits ----
  const idX = await rowId(a.page, "Close inlet");
  const idZ = await rowId(a.page, "Log pressure");
  const idYb = await rowId(b.page, "Check valve");
  const idZb = await rowId(b.page, "Log pressure");
  expect(idZb).toBe(idZ);
  expect(idYb).not.toBe("");

  let seqA = await saveSequence(a.page);
  await editText(a.page, idX, "Close inlet valve");
  seqA = await awaitSavedAfter(a.page, seqA);
  await a.page.locator(`li[data-item-id="${idZ}"]`).getByLabel(/^Done/).check();
  seqA = await awaitSavedAfter(a.page, seqA);
  await a.page.locator("#f-title").fill("Title from A");
  await a.page.locator("#f-title").press("Enter");
  seqA = await awaitSavedAfter(a.page, seqA);

  let seqB2 = await saveSequence(b.page);
  await editText(b.page, idYb, "Check valve seat");
  seqB2 = await awaitSavedAfter(b.page, seqB2);
  await editText(b.page, idZb, "Log pressure hourly");
  seqB2 = await awaitSavedAfter(b.page, seqB2);
  await b.page.locator("#f-title").fill("Title from B");
  await b.page.locator("#f-title").press("Enter");
  seqB2 = await awaitSavedAfter(b.page, seqB2);

  // ---- exchange both ways with real files ----
  const fileA2 = await exportCapsule(a.page, testInfo, "a2.gscap");
  const fileB2 = await exportCapsule(b.page, testInfo, "b2.gscap");
  await importFile(b.page, fileA2);
  await expect(importResult(b.page)).toHaveAttribute("data-import-state", "applied-saved");
  seqB2 = await awaitSavedAfter(b.page, seqB2);
  await importFile(a.page, fileB2);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  seqA = await awaitSavedAfter(a.page, seqA);
  await expect(a.page.getByTestId("merge-summary")).toContainText("only one value is kept");

  // ---- converge: identical visible and persisted state ----
  const uiA = await readUiModel(a.page);
  const uiB = await readUiModel(b.page);
  expect(uiA).toEqual(uiB);
  expect(["Title from A", "Title from B"]).toContain(uiA.title);
  const byId = (m: UiModel, id: string) => m.items.find((i) => i.id === id);
  expect(byId(uiA, idX)).toMatchObject({ text: "Close inlet valve", done: false });
  expect(byId(uiA, idYb)).toMatchObject({ text: "Check valve seat" });
  expect(byId(uiA, idZ)).toMatchObject({ text: "Log pressure hourly", done: true });
  expect(uiA.items).toHaveLength(4);
  expect(await itemIds(a.page)).toEqual(await itemIds(b.page));

  const sa2 = await storedState(a.page);
  const sb2 = await storedState(b.page);
  expect(sa2.state).toEqual(sb2.state);
  expect(sa2.record.sequence).toBe(seqA);
  expect(sb2.record.sequence).toBe(seqB2);
  const pa = sa2.state.incident;
  expect(pa.ok && pa.entity.title).toBe(uiA.title);

  // ---- duplicate import is safe ----
  const before = await storedState(a.page);
  await importFile(a.page, fileB2);
  await expect(importResult(a.page)).toHaveAttribute("data-import-state", "applied-saved");
  await expect(a.page.getByTestId("merge-summary")).toContainText("No changes");
  await awaitSaved(a.page);
  expect(await readUiModel(a.page)).toEqual(uiA);
  expect((await storedState(a.page)).state).toEqual(before.state);

  // ---- screenshots from the running production build (desktop + 320 px) ----
  for (const [name, size] of [["desktop-1280x800", { width: 1280, height: 800 }], ["mobile-320", { width: 320, height: 640 }]] as const) {
    await a.page.setViewportSize(size);
    await expect(saveIndicator(a.page)).toHaveAttribute("data-save-state", "saved");
    const path = testInfo.outputPath(`fieldledger-${name}.png`);
    await a.page.screenshot({ path, fullPage: true });
    await testInfo.attach(`fieldledger-${name}`, { path, contentType: "image/png" });
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
    expect([...readFileSync(path).subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    process.stdout.write(`[screenshot] ${path}\n`);
  }

  // ---- reload OFFLINE again: merged state is retained from IndexedDB ----
  for (const p of [a, b]) {
    const res = await p.page.reload();
    expect(res?.fromServiceWorker()).toBe(true);
    await expect(p.page.locator("html")).toHaveAttribute("data-session", "ready");
    await expect(p.page.locator("main")).toHaveAttribute("data-document-id", DOC);
  }
  await expect(a.page.locator("main")).toHaveAttribute("data-replica-id", replicaA);
  await expect(b.page.locator("main")).toHaveAttribute("data-replica-id", replicaB);
  expect(await readUiModel(a.page)).toEqual(uiA);
  expect(await readUiModel(b.page)).toEqual(uiA);
  expect((await storedState(a.page)).state).toEqual(sa2.state);

  // no request left the origin
  for (const u of requests) expect(new URL(u).origin).toBe("http://localhost:4329");

  await a.context.close();
  await b.context.close();
});

const saveIndicator = (page: Page) => page.locator('[data-testid="save-indicator"]');
