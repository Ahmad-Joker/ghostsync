/**
 * EV-FIXTURE (never EV-PHYS): checks that the generated capsules import into the REAL built PatchBoard on board
 * `sprint-board`, using the app's own file-import path (same bytes and pipeline the QR path uses). It also checks that a
 * profile on a DIFFERENT board rejects them. Needs `pnpm.cmd -F @ghostsync/patchboard build` first.
 * Starts the test static server (e2e/static-server.mjs) on a throwaway port for the duration of the run, then stops it.
 *
 *   node apps/patchboard/tools/phone-test/verify-import.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const { fixtures } = JSON.parse(readFileSync(join(here, "generated", "fixtures.json"), "utf8"));
const PORT = "4351";
const server = spawn(process.execPath, [join(here, "..", "..", "e2e", "static-server.mjs")], { env: { ...process.env, PATCHBOARD_PORT: PORT }, stdio: "ignore" });
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
try {
  await new Promise((r) => setTimeout(r, 1000));
  const browser = await chromium.launch();
  try {
    const open = async (board) => {
      const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}` });
      const page = await ctx.newPage();
      await page.goto("/");
      await page.waitForSelector('html[data-offline-ready="true"]');
      await page.getByLabel("Board ID").fill(board);
      await page.getByRole("button", { name: "Open board" }).click();
      await page.waitForSelector('html[data-session="ready"]');
      return { ctx, page };
    };
    const bytesOf = (f) => ({ name: `${f.id}.gscap`, mimeType: "application/octet-stream", buffer: Buffer.from(f.capsuleB64, "base64") });
    const { ctx, page } = await open("sprint-board");
    const results = [];
    for (const id of ["S01", "L01"]) {
      const f = fixtures.find((x) => x.id === id);
      await page.getByTestId("import-input").setInputFiles(bytesOf(f));
      await page.waitForFunction(() => /^(applied|rejected)/.test(document.querySelector('[data-testid="import-result"]')?.getAttribute("data-import-state") ?? ""));
      const state = await page.locator('[data-testid="import-result"]').getAttribute("data-import-state");
      results.push(`${id} (${f.capsuleBytes} bytes): ${state}`);
      check(state === "applied-saved", `${id} import state ${state}`);
    }
    const cards = await page.locator("li[data-card-id]").count();
    results.push(`cards on sprint-board after both: ${cards}`);
    check(cards === 2, `expected 2 cards, got ${cards}`);
    await ctx.close();
    const other = await open("other-board");
    const f = fixtures.find((x) => x.id === "L01");
    await other.page.getByTestId("import-input").setInputFiles(bytesOf(f));
    await other.page.waitForFunction(() => /^(applied|rejected)/.test(document.querySelector('[data-testid="import-result"]')?.getAttribute("data-import-state") ?? ""));
    const st = await other.page.locator('[data-testid="import-result"]').getAttribute("data-import-state");
    const code = await other.page.locator('[data-testid="import-result"]').getAttribute("data-import-code");
    results.push(`L01 on other-board: ${st} ${code ?? ""}`);
    check(st === "rejected", `a different board must reject, got ${st}`);
    await other.ctx.close();
    process.stdout.write(`${results.join("\n")}\n`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
if (failures.length > 0) {
  process.stdout.write(`FAIL\n${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("EV-FIXTURE: import checks passed (this is not EV-PHYS)\n");
