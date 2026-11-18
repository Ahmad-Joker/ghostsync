import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cardAdapter } from "../src/model/adapters.js";
import {
  BOARD,
  addCardUi,
  awaitSaved,
  awaitSavedAfter,
  buildCapsule,
  importFile,
  importResult,
  offlineProfileOnBoard,
  readStoredRecords,
  readUiBoard,
  saveSequence,
  storedState,
} from "./helpers.js";

const fill = (title: string) => (r: Parameters<Parameters<typeof buildCapsule>[2]>[0]): void => {
  r.collection(cardAdapter).put("card-foreign", { title, notes: "", placement: "todo|00001024" });
};

test("E2E-PB-04: rejected capsules never mutate UI or persisted state", async ({ browser }, testInfo) => {
  const a = await offlineProfileOnBoard(browser);
  const page = a.page;
  await addCardUi(page, "Pump valve");
  await awaitSaved(page);

  // Step 0 (A-12): the file input is reachable with a visible 3 px focus ring and its accessible name.
  // Reachability asserted, chooser dialog not driven: files are supplied with setInputFiles.
  const input = page.getByLabel("Import capsule file (.gscap)", { exact: true });
  await expect(input).toHaveCount(1);
  expect(await input.evaluate((el) => (el as HTMLInputElement).type)).toBe("file");
  await input.focus();
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("3px");
  await expect(page.getByText("not authenticated")).toBeVisible();

  const genuine = await buildCapsule(BOARD, "patchboard", fill("Foreign card"));
  const flipped = Uint8Array.from(genuine);
  flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 0xff;
  const newerVersion = Uint8Array.from(genuine);
  newerVersion[6] = 2;
  const cases: Array<{ name: string; bytes: Uint8Array | Buffer; code: string; text?: string }> = [
    { name: "wrong-board.gscap", bytes: await buildCapsule("other-board", "patchboard", fill("Other board")), code: "DocumentIdentityMismatch", text: "other-board" },
    { name: "wrong-app.gscap", bytes: await buildCapsule(BOARD, "fieldledger", fill("Other app")), code: "AppIdentityMismatch", text: "fieldledger" },
    { name: "corrupt.gscap", bytes: flipped, code: "ChecksumMismatch" },
    { name: "truncated.gscap", bytes: genuine.subarray(0, Math.floor(genuine.length / 2)), code: "Malformed" },
    { name: "newer-version.gscap", bytes: newerVersion, code: "UnsupportedVersion" },
    { name: "not-a-capsule.gscap", bytes: Buffer.from("this is just text, not a capsule"), code: "Malformed" },
  ];

  const before = { ui: await readUiBoard(page), seq: await saveSequence(page), stored: (await storedState(page)).record };

  for (const c of cases) {
    const path = testInfo.outputPath(c.name);
    writeFileSync(path, c.bytes);
    await importFile(page, path);
    await expect(importResult(page)).toHaveAttribute("data-import-state", "rejected");
    await expect(importResult(page)).toHaveAttribute("data-import-code", c.code);
    await expect(importResult(page)).toContainText("Nothing was changed.");
    if (c.text !== undefined) await expect(importResult(page)).toContainText(c.text);
    expect(await readUiBoard(page)).toEqual(before.ui);
    await expect(page.locator('[data-testid="save-indicator"]')).toHaveAttribute("data-save-state", "saved");
    expect(await saveSequence(page)).toBe(before.seq);
    expect((await readStoredRecords(page))[0]).toEqual(before.stored);
  }

  // Oversized raw file (16 MiB + 1): rejected by File.size BEFORE reading.
  await page.getByTestId("import-input").setInputFiles({ name: "huge.gscap", mimeType: "application/octet-stream", buffer: Buffer.alloc(16 * 1024 * 1024 + 1) });
  await expect(importResult(page)).toHaveAttribute("data-import-code", "OversizedRaw");
  await expect(importResult(page)).toContainText("Nothing was changed.");
  expect(await readUiBoard(page)).toEqual(before.ui);
  expect((await readStoredRecords(page))[0]).toEqual(before.stored);

  // The session stayed usable: a new edit still saves.
  await addCardUi(page, "After rejection");
  expect(await awaitSavedAfter(page, before.seq)).toBeGreaterThan(before.seq);
  await a.context.close();
});
