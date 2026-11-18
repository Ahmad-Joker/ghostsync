import { expect, test } from "@playwright/test";
import {
  DOC,
  addItemUi,
  awaitSaved,
  awaitSavedAfter,
  createDetails,
  join,
  loadUntilOfflineReady,
  newProfile,
  readUiModel,
  rowId,
  saveSequence,
  storedState,
  storedTexts,
} from "./helpers.js";

test("keep working through offline reloads, hash route and remembered-incident fallback (E2E-FL-02)", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await loadUntilOfflineReady(page);
  await join(page, DOC);
  await createDetails(page, "Pump station leak");
  await addItemUi(page, "Close inlet");
  await addItemUi(page, "Check valve");
  await awaitSaved(page);
  const replicaId = (await page.locator("main").getAttribute("data-replica-id")) ?? "";
  await p.context.setOffline(true);

  const res = await page.reload(); // hash route /#/i/<id>, no network, never re-enabled
  expect(res?.fromServiceWorker()).toBe(true);
  const js = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /assets\/index-.*\.js/.test(n)));
  expect(js.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator("main")).toHaveAttribute("data-replica-id", replicaId);
  const urlAfterReload = page.url();
  process.stdout.write(`[evidence] offline reload kept the hash route: ${urlAfterReload.includes("#/i/")}\n`);
  expect(urlAfterReload).toContain("#/i/inc-2026-0042");

  // edit offline
  const before = (await storedState(page)).record.sequence;
  const id = await rowId(page, "Close inlet");
  await page.locator(`li[data-item-id="${id}"]`).getByLabel(/^Done/).check();
  await addItemUi(page, "Log pressure");
  await page.locator("#f-status").selectOption("in-progress");
  await expect.poll(async () => (await storedState(page)).record.sequence).toBeGreaterThan(before);
  await awaitSaved(page);

  // remembered-incident fallback: open "/" with no hash, offline
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  await expect(page.locator("main")).toHaveAttribute("data-replica-id", replicaId);
  const model = await readUiModel(page);
  expect(model.items.map((i) => ("text" in i ? [i.text, i.done] : null))).toEqual([["Close inlet", true], ["Check valve", false], ["Log pressure", false]]);
  await expect(page.locator("#f-status")).toHaveValue("in-progress");
  const persisted = await storedState(page);
  expect(storedTexts(persisted.state).sort()).toEqual(["Check valve", "Close inlet", "Log pressure"]);
  for (const u of requests) expect(new URL(u).origin).toBe("http://localhost:4329");
  await p.context.close();
});

test("a first visit while offline fails honestly; readiness gates 'ready' (E2E-FL-10)", async ({ browser }) => {
  const p = await newProfile(browser);
  await p.context.setOffline(true);
  await expect(p.page.goto("/")).rejects.toThrow();
  await p.context.setOffline(false);
  await p.page.goto("/");
  await expect(p.page.getByTestId("first-visit-notice")).toBeVisible();
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-state", "ready");
  await expect(p.page.getByTestId("first-visit-notice")).toBeHidden();
  await expect(p.page.getByTestId("offline-indicator")).toHaveText("Ready to work offline.");
  await p.context.close();
});

test("OPTIONAL extra (not required by the MVP contract): sub-path hosting at /deploy-fl/ (E2E-FL-11)", async ({ browser }) => {
  const p = await newProfile(browser);
  await loadUntilOfflineReady(p.page, "/deploy-fl/");
  const scope = await p.page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? "");
  expect(scope.endsWith("/deploy-fl/")).toBe(true);
  await p.context.setOffline(true);
  const res = await p.page.reload();
  expect(res?.fromServiceWorker()).toBe(true);
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await p.context.close();
});

test("a new worker waits; Update now activates it explicitly after settling (E2E-FL-15)", async ({ browser }) => {
  const p = await newProfile(browser);
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, DOC);
  await addItemUi(page, "Saved item");
  await awaitSaved(page);
  const before = await storedState(page);

  const bump = await page.request.post("/__test/sw-bump");
  expect(bump.status()).toBe(204);
  await page.reload(); // online
  const t0 = await page.evaluate(() => performance.timeOrigin);
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "waiting");
  const banner = page.getByTestId("update-banner");
  await expect(banner).toContainText("A new version is ready. Save your work, then update.");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null)).toBe(true);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(t0); // no automatic skipWaiting
  await expect(page.locator('[data-testid="save-indicator"]')).toHaveAttribute("data-save-state", "saved");
  const seq = await saveSequence(page).catch(() => 0);
  void seq;

  await banner.getByRole("button", { name: "Update now" }).click();
  await expect
    .poll(() => page.evaluate(() => performance.timeOrigin).catch(() => t0))
    .not.toBe(t0);
  await expect(page.locator("html")).toHaveAttribute("data-offline-state", "ready");
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).toBeNull();
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
  expect((await storedState(page)).state).toEqual(before.state);
  void awaitSavedAfter;
  await p.context.close();
});
