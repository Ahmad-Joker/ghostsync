import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { checklistItemAdapter } from "../src/model/adapters.js";
import {
  DOC,
  addItemUi,
  awaitSaved,
  awaitSavedAfter,
  buildCapsule,
  importFile,
  importResult,
  offlineProfileInIncident,
  readStoredRecords,
  readUiModel,
  saveSequence,
  storedState,
} from "./helpers.js";

const fill = (text: string) => (r: Parameters<Parameters<typeof buildCapsule>[2]>[0]): void => {
  r.collection(checklistItemAdapter).put("ci-foreign", { text, done: false, sortKey: 1024, createdBy: "rx", createdAt: 1 });
};

test("rejected capsules never mutate UI or persisted state (E2E-FL-04)", async ({ browser }, testInfo) => {
  const a = await offlineProfileInIncident(browser);
  const page = a.page;
  await addItemUi(page, "Pump valve");
  await awaitSaved(page);

  const genuine = await buildCapsule(DOC, "fieldledger", fill("Foreign item"));
  const flipped = Uint8Array.from(genuine);
  flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 0xff;
  const cases: Array<{ name: string; bytes: Uint8Array | Buffer; code: string; text?: string }> = [
    { name: "wrong-document.gscap", bytes: await buildCapsule("inc-2026-9999", "fieldledger", fill("Other doc")), code: "DocumentIdentityMismatch", text: "inc-2026-9999" },
    { name: "wrong-app.gscap", bytes: await buildCapsule(DOC, "patchboard", fill("Other app")), code: "AppIdentityMismatch", text: "patchboard" },
    { name: "corrupt.gscap", bytes: flipped, code: "ChecksumMismatch" },
    { name: "truncated.gscap", bytes: genuine.subarray(0, Math.floor(genuine.length / 2)), code: "Malformed" },
    { name: "not-a-capsule.gscap", bytes: Buffer.from("this is just text, not a capsule"), code: "Malformed" },
  ];

  const before = { ui: await readUiModel(page), seq: await saveSequence(page), stored: (await storedState(page)).record };

  for (const c of cases) {
    const path = testInfo.outputPath(c.name);
    writeFileSync(path, c.bytes);
    await importFile(page, path);
    await expect(importResult(page)).toHaveAttribute("data-import-state", "rejected");
    await expect(importResult(page)).toHaveAttribute("data-import-code", c.code);
    await expect(importResult(page)).toContainText("Nothing was changed.");
    if (c.text !== undefined) await expect(importResult(page)).toContainText(c.text);
    expect(await readUiModel(page)).toEqual(before.ui);
    await expect(page.locator('[data-testid="save-indicator"]')).toHaveAttribute("data-save-state", "saved");
    expect(await saveSequence(page)).toBe(before.seq);
    const rec = (await readStoredRecords(page))[0];
    expect(rec).toEqual(before.stored);
  }

  // Oversized raw file (16 MiB + 1): rejected by File.size BEFORE reading.
  await page.getByTestId("import-input").setInputFiles({ name: "huge.gscap", mimeType: "application/octet-stream", buffer: Buffer.alloc(16 * 1024 * 1024 + 1) });
  await expect(importResult(page)).toHaveAttribute("data-import-code", "OversizedRaw");
  await expect(importResult(page)).toContainText("Nothing was changed.");
  expect(await readUiModel(page)).toEqual(before.ui);
  expect((await readStoredRecords(page))[0]).toEqual(before.stored);

  // The session stayed usable: a new edit still saves.
  await addItemUi(page, "After rejection");
  expect(await awaitSavedAfter(page, before.seq)).toBeGreaterThan(before.seq);
  await a.context.close();
});
