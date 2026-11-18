/**
 * Kiroween redesign (hero-led) checks for PatchBoard. Real Chromium against the production build.
 * iPhone-sized runs use Chromium emulation (isMobile, hasTouch, deviceScaleFactor 3, iPhone user agent).
 * That is EV-FIXTURE evidence only: it says nothing about Safari, its toolbars or its keyboard.
 */
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { BASE, BOARD, addCardUi, armAbort, awaitSaved, btn, join, loadUntilOfflineReady, newProfile, offlineProfileOnBoard, press } from "./helpers.js";
import { capsuleFrame, qrOnlineProfile, setCameraFrame } from "./camera.js";
import { expectScanState, flipUpdateByte, peerCapsule, qrBtn, scanFrame, showPanel } from "./qr-fixtures.js";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONES = [
  { w: 320, h: 568 },
  { w: 390, h: 664 },
  { w: 430, h: 739 },
  { w: 430, h: 932 },
] as const;

async function iphone(browser: Browser, w: number, h: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: IPHONE_UA });
  const page = await context.newPage();
  return { context, page };
}

/** Which readiness elements are actually visible (not clipped to a 1px box, not hidden). */
function visibleCues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vis = (el: Element | null): boolean => {
      if (el === null) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.visibility === "visible" && cs.display !== "none" && cs.clipPath === "none" && !el.closest("[hidden]");
    };
    return ["network-chip", "offline-indicator", "offline-banner"].filter((id) => vis(document.querySelector(`[data-testid="${id}"]`)));
  });
}

const box = async (page: Page, sel: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await page.locator(sel).first().boundingBox();
  if (b === null) throw new Error(`no box for ${sel}`);
  return b;
};

test("E2E-KW-PB-01: hero composition, copy, Board ID field and one-h1 structure (desktop and phone)", async ({ browser }) => {
  for (const [vp, desktop] of [[{ width: 1280, height: 800 }, true], [{ width: 390, height: 664 }, false]] as const) {
    const p = await newProfile(browser, { viewport: vp });
    const page = p.page;
    await page.goto("/");
    await expect(page.getByText("When the signal dies, the work goes on.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("When the signal dies, the work goes on.", { exact: true })).toBeVisible();
    await expect(page.getByText("Edit your board offline. Share updates by QR code or file.", { exact: true })).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText("PatchBoard");
    const field = page.getByLabel("Board ID");
    await expect(field).toHaveCount(1);
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("placeholder", "e.g. sprint-board");
    await expect(page.getByText("Use the same board ID on both devices.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open board", exact: true })).toHaveCount(1);
    await expect(page.locator("#board-rules")).toHaveText(/^Everyone who shares this board types the same ID\./);
    await expect(page.locator("#board-format")).toContainText("3 to 64 characters");
    // The rules stay reachable behind a disclosure, and validation text still appears.
    await field.fill("ab");
    await page.getByRole("button", { name: "Open board", exact: true }).click();
    await expect(page.locator("#board-error")).toContainText("not valid");
    await field.fill("  Sprint-Board ");
    await expect(page.locator("#board-preview")).toHaveText("Will open: sprint-board");
    await field.fill("");
    // Type: display serif for the headline only, sans and at least 16px inside the app.
    const fonts = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector(".gs-hero-title") as Element).fontFamily,
      body: getComputedStyle(document.querySelector("label[for=board-id]") as Element).fontFamily,
      input: parseFloat(getComputedStyle(document.getElementById("board-id") as Element).fontSize),
    }));
    expect(fonts.title).toMatch(/Iowan|Palatino|Georgia|serif/);
    expect(fonts.body).not.toMatch(/Iowan|Palatino|Georgia/);
    expect(fonts.input).toBeGreaterThanOrEqual(16);
    // Art: one shared courier symbol, two devices, the moon and a dotted flight path; all decorative.
    const art = page.locator("#hero-art");
    await expect(art.locator('use[href="#gs-courier"]')).toHaveCount(1);
    await expect(art.locator('use[href="#gs-phone"]')).toHaveCount(1);
    await expect(art.locator('use[href="#gs-laptop"]')).toHaveCount(1);
    await expect(art.locator('use[href="#gs-moon"]')).toHaveCount(1);
    expect(await art.locator("path[stroke-dasharray]").count()).toBeGreaterThan(0);
    const unnamedSvg = await page.evaluate(() => [...document.querySelectorAll("svg")].filter((s) => s.id !== "gs-sprite" && s.querySelector("title") === null && !(s.closest("[aria-hidden=true]") !== null || s.getAttribute("aria-hidden") === "true")).length);
    expect(unnamedSvg).toBe(0);
    expect(await page.evaluate(() => [...document.querySelectorAll("svg")].filter((s) => s.getAttribute("focusable") !== "false" && s.closest(".gs-mark") === null).length)).toBe(0);
    // One composition: beside the copy on desktop, stacked above it on a phone.
    const a = await box(page, "#hero-art");
    const c = await box(page, ".pb-hero-copy");
    if (desktop) expect(c.x + c.width).toBeLessThanOrEqual(a.x + 1);
    else expect(a.y + a.height).toBeLessThanOrEqual(c.y + 1);
    // No modal, no overlay, no focus theft, no <main> while choosing a board, and the controls are not covered.
    await expect(page.locator("main")).toHaveCount(0);
    await page.goto("/");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    expect(await page.locator("[aria-modal], dialog[open]").count()).toBe(0);
    for (const sel of ["#board-id", 'button:has-text("Open board")']) {
      const hit = await page.evaluate((s) => {
        const el = document.querySelector(s.startsWith("button") ? "form.pb-join button[type=submit]" : s) as HTMLElement;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === el || el.contains(top);
      }, sel);
      expect(hit, sel).toBe(true);
    }
    await p.context.close();
  }
});

test("E2E-KW-PB-02: at iPhone sizes Board ID and Open board are inside the first screen (Chromium emulation)", async ({ browser }) => {
  const report: string[] = [];
  for (const { w, h } of IPHONES) {
    const p = await iphone(browser, w, h);
    await p.page.goto("/");
    const open = p.page.getByRole("button", { name: "Open board", exact: true });
    await expect(open).toBeVisible();
    const r = await p.page.evaluate(() => {
      const el = document.querySelector("form.pb-join button[type=submit]") as HTMLElement;
      const input = document.getElementById("board-id") as HTMLElement;
      const b = el.getBoundingClientRect();
      const fixed = [...document.querySelectorAll("body *")].filter((e) => ["fixed", "sticky"].includes(getComputedStyle(e).position) && e.getBoundingClientRect().width > 0).map((e) => e.tagName);
      return {
        bottom: b.bottom,
        inputTop: input.getBoundingClientRect().top,
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        fixed,
        art: getComputedStyle(document.getElementById("hero-art") as Element).display !== "none",
      };
    });
    report.push(`${w}x${h}: Open board bottom ${Math.round(r.bottom)} of ${r.innerHeight}, art ${r.art ? "shown" : "hidden"}`);
    expect(r.bottom, `${w}x${h} Open board bottom`).toBeLessThanOrEqual(r.innerHeight);
    expect(r.inputTop, `${w}x${h} Board ID top`).toBeGreaterThanOrEqual(0);
    expect(r.scrollY).toBe(0);
    expect(r.overflow, `${w}x${h} horizontal overflow`).toBeLessThanOrEqual(0);
    expect(r.fixed, `${w}x${h} fixed or sticky elements`).toEqual([]);
    await p.context.close();
  }
  // 320x480 is reported, not gated: how far the action is from the first screen.
  const small = await iphone(browser, 320, 480);
  await small.page.goto("/");
  const m = await small.page.evaluate(() => {
    const el = document.querySelector("form.pb-join button[type=submit]") as HTMLElement;
    return { bottom: el.getBoundingClientRect().bottom, innerHeight: window.innerHeight };
  });
  report.push(`320x480: Open board bottom ${Math.round(m.bottom)} of ${m.innerHeight} (scroll needed ${Math.max(0, Math.round(m.bottom - m.innerHeight))}px)`);
  await small.page.getByRole("button", { name: "Open board", exact: true }).scrollIntoViewIfNeeded();
  await expect(small.page.getByRole("button", { name: "Open board", exact: true })).toBeInViewport();
  await small.context.close();
  test.info().annotations.push({ type: "EV-FIXTURE first-screen report", description: report.join("; ") });
  writeFileSync(test.info().outputPath("first-screen-report.txt"), report.join("\n"));
  console.log(`E2E-KW-PB-02 report (Chromium emulation): ${report.join(" | ")}`);
});

test("E2E-KW-PB-03: with a short viewport and Board ID focused, Open board stays reachable and uncovered (keyboard emulation by viewport)", async ({ browser }) => {
  const p = await iphone(browser, 390, 340);
  const page = p.page;
  await page.goto("/");
  await page.getByLabel("Board ID").focus();
  const open = page.getByRole("button", { name: "Open board", exact: true });
  await open.scrollIntoViewIfNeeded();
  await expect(open).toBeInViewport();
  const hit = await open.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top);
  });
  expect(hit).toBe(true);
  await p.context.close();
});

test("E2E-KW-PB-04: See how it works reveals three illustrated steps, by keyboard, without stealing focus; the credit is in the guide", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  await page.goto("/");
  const see = page.getByRole("button", { name: "See how it works", exact: true });
  const guide = page.locator("#guidance");
  await expect(see).toHaveAttribute("aria-expanded", "false");
  expect(await see.getAttribute("aria-controls")).toBe("guidance");
  await expect(guide).toBeHidden();
  await see.click();
  await expect(guide).toBeVisible();
  await expect(see).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Help", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(guide.getByRole("listitem")).toHaveCount(3);
  for (const id of ["scan", "review", "import"]) await expect(guide.locator(`use[href="#gs-courier-step-${id}"]`)).toHaveCount(1);
  await expect(guide.getByText("Built with Kiro for Kiroween", { exact: true })).toBeVisible();
  expect(await guide.locator("p.gs-credit").evaluate((el) => el.querySelector("img, svg") === null)).toBe(true);
  // Opening does not move focus off the button and does not cover the form.
  await expect(see).toBeFocused();
  await expect(page.getByLabel("Board ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open board", exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Close help", exact: true }).click();
  await expect(guide).toBeHidden();
  await expect(see).toBeFocused();
  // Keyboard: Enter opens, Escape closes, Space opens, the close button closes; focus returns each time.
  await see.focus();
  await page.keyboard.press("Enter");
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Close help", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(see).toBeFocused();
  await page.keyboard.press("Space");
  await expect(guide).toBeVisible();
  await page.keyboard.press("Space");
  await expect(guide).toBeHidden();
  await p.context.close();
});

test("E2E-KW-PB-05: small header and one visible readiness cue; every contract element stays in the DOM", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  await loadUntilOfflineReady(page);
  const header = await box(page, "header.gs-header");
  expect(header.height).toBeLessThanOrEqual(64);
  expect(await page.locator("header.gs-header button").count()).toBe(1);
  await expect(page.getByTestId("offline-indicator")).toHaveText("Ready to work offline.");
  await expect(page.getByTestId("offline-indicator")).toHaveAttribute("data-offline-state", "ready");
  await expect(page.getByTestId("network-chip")).toHaveText("Network: online");
  await expect(page.locator("#status-note")).toContainText("Online · Open a board to start working.");
  await expect(page.getByTestId("transfer-mode")).toHaveText("Transfer: file (.gscap)");
  await expect(page.getByTestId("transfer-mode")).toHaveAttribute("data-transfer-mode", "file");
  await expect(page.getByTestId("first-visit-notice")).toBeHidden();
  expect(await visibleCues(page)).toEqual(["offline-indicator"]);
  await join(page, BOARD);
  await expect(page.locator("#status-note")).toContainText("Online · Changes save on this device.");
  expect(await visibleCues(page)).toEqual(["offline-indicator"]);
  await p.context.setOffline(true);
  await expect(page.getByTestId("network-chip")).toHaveText("Network: offline");
  await expect(page.locator("#status-note")).toContainText("Offline · Changes still save on this device.");
  await expect(page.getByTestId("offline-indicator")).toHaveText("Ready to work offline.");
  expect(await visibleCues(page)).toEqual(["offline-banner"]);
  await expect(page.getByTestId("transfer-mode")).toHaveText("Transfer: file (.gscap)");
  await p.context.close();
  // Not ready yet: the indicator is the cue and the first-visit notice shows.
  const q = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  await q.page.addInitScript(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register = (): Promise<ServiceWorkerRegistration> => new Promise(() => undefined);
  });
  await q.page.goto("/");
  await expect(q.page.getByTestId("first-visit-notice")).toBeVisible();
  await expect(q.page.getByTestId("first-visit-notice")).toHaveText("Opening PatchBoard offline for the very first time will not work. Open it once while online.");
  expect(await visibleCues(q.page)).toEqual(["offline-indicator"]);
  await q.context.close();
});

test("E2E-KW-PB-06: going offline shows one banner without moving the layout, one short lantern reaction, then it stays still", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await join(page, BOARD);
  const banner = page.getByTestId("offline-banner");
  await expect(banner).toBeHidden();
  const yBefore = (await box(page, "main")).y;
  const barBefore = (await box(page, ".gs-statusbar")).height;
  await page.evaluate(() => {
    const w = window as unknown as { __lantern: Array<{ name: string; duration: string; iterations: string; at: number }> };
    w.__lantern = [];
    document.addEventListener("animationstart", (e) => {
      const cs = getComputedStyle(e.target as Element);
      w.__lantern.push({ name: e.animationName, duration: cs.animationDuration, iterations: cs.animationIterationCount, at: performance.now() });
    });
  });
  await p.context.setOffline(true);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The network vanished. Your work didn't.");
  await expect(banner).toContainText("Changes still save on this device.");
  await expect(banner.locator('use[href="#gs-courier-sm"]')).toHaveCount(1);
  expect(await banner.locator("[aria-live], [role=status], [role=alert]").count()).toBe(0);
  expect(Math.abs((await box(page, "main")).y - yBefore)).toBeLessThan(1);
  expect(Math.abs((await box(page, ".gs-statusbar")).height - barBefore)).toBeLessThan(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lantern: unknown[] }).__lantern.length)).toBe(1);
  const anim = await page.evaluate(() => (window as unknown as { __lantern: Array<{ name: string; duration: string; iterations: string }> }).__lantern[0]);
  expect(anim?.name).toBe("gs-lantern");
  expect(anim?.iterations).toBe("1");
  const seconds = Number.parseFloat(anim?.duration ?? "0");
  expect(seconds).toBeGreaterThanOrEqual(0.6);
  expect(seconds).toBeLessThanOrEqual(0.9);
  // Then it is still: no animation keeps running.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  // The user keeps working while offline.
  await addCardUi(page, "Keep working");
  await awaitSaved(page);
  await expect(banner).toBeVisible();
  // Coming back online hides it again.
  await p.context.setOffline(false);
  await expect(banner).toBeHidden();
  await p.context.close();
  // Reduced motion: the banner and its text appear, nothing animates.
  const r = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  await r.page.emulateMedia({ reducedMotion: "reduce" });
  await loadUntilOfflineReady(r.page);
  await join(r.page, BOARD);
  await r.context.setOffline(true);
  await expect(r.page.getByTestId("offline-banner")).toBeVisible();
  expect(await r.page.evaluate(() => document.getAnimations().length)).toBe(0);
  await addCardUi(r.page, "Still works");
  await r.context.close();
});

test("E2E-KW-PB-07: the banner never says changes save when saving failed", async ({ browser }) => {
  const p = await offlineProfileOnBoard(browser);
  const page = p.page;
  const banner = page.getByTestId("offline-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Changes still save on this device.");
  await armAbort(page);
  await page.getByLabel("New card title").fill("Will not save");
  await press(page, btn(page, "Add card"));
  await expect(page.getByTestId("save-indicator")).toHaveAttribute("data-save-state", "error");
  await expect(banner).toContainText("Changes are NOT saved to this device.");
  await expect(banner).not.toContainText("still save");
  await p.context.close();
});

test("E2E-KW-PB-08: the board is the centre: counts, Add card first, Share and Import reach the transfer area", async ({ browser }) => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 664 }]) {
    const p = await newProfile(browser, { viewport: vp });
    const page = p.page;
    await loadUntilOfflineReady(page);
    await join(page, BOARD);
    await addCardUi(page, "First card", "n");
    await addCardUi(page, "Second card");
    await btn(page, "Move to Doing: Second card").click();
    await awaitSaved(page);
    for (const [col, n] of [["todo", 1], ["doing", 1], ["done", 0]] as const) {
      const c = page.getByTestId(`column-${col}`);
      await expect(c.locator("li[data-card-id]")).toHaveCount(n);
      await expect(c.locator(".pb-count")).toHaveText(n === 1 ? "1 card" : `${n} cards`);
    }
    await expect(page.getByTestId("column-todo").getByRole("heading", { name: "To do" })).toHaveCount(1);
    // Add card is easy to find: its button sits above the first card of To do.
    const add = await box(page, "button.pb-add-btn");
    const firstCard = await box(page, '[data-testid="column-todo"] li[data-card-id]');
    expect(add.y).toBeLessThan(firstCard.y);
    // Share and Import keep their plain names and move focus to the existing targets.
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.locator("#transfer-h")).toBeFocused();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.locator("#import-file")).toBeFocused();
    // File export and import share one transfer panel, close together.
    const ex = await box(page, "#export-btn");
    const im = await box(page, "#import-file");
    expect(Math.abs(im.y - ex.y)).toBeLessThan(vp.height);
    await p.context.close();
  }
});

test("E2E-KW-PB-09: the QR sender stage is pure white with the full quiet zone and no effects", async ({ browser }) => {
  const p = await qrOnlineProfile(browser, BOARD, { width: 1280, height: 800 });
  const page = p.page;
  await addCardUi(page, "Draft spec v1", "Outline plus risks");
  await awaitSaved(page);
  await press(page, qrBtn(page, "qr-show-btn"));
  await expect(showPanel(page)).toHaveAttribute("data-qr-state", "ready");
  const r = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="qr-canvas"]') as HTMLCanvasElement;
    const px = c.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? [];
    const frame = c.closest(".gs-qr-frame") as HTMLElement;
    const chain: string[] = [];
    for (let n: Element | null = c; n !== null && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.filter !== "none" || cs.backdropFilter !== "none" || cs.transform !== "none" || cs.mixBlendMode !== "normal" || cs.animationName !== "none" || cs.opacity !== "1" || cs.clipPath !== "none" || cs.maskImage !== "none") {
        chain.push(`${n.tagName}.${n.className}`);
      }
    }
    return {
      modules: Number(c.dataset["qrModules"]),
      scale: Number(c.dataset["qrScale"]),
      width: c.width,
      cssWidth: c.getBoundingClientRect().width,
      px: [...px],
      stageBg: getComputedStyle(frame).backgroundColor,
      contains: frame.getBoundingClientRect().left <= c.getBoundingClientRect().left && frame.getBoundingClientRect().right >= c.getBoundingClientRect().right,
      chain,
      animations: c.getAnimations({ subtree: false }).length + (c.parentElement?.getAnimations().length ?? 0),
    };
  });
  expect(r.width).toBe((r.modules + 8) * r.scale);
  expect(Math.round(r.cssWidth)).toBe(r.width);
  expect(r.px).toEqual([255, 255, 255, 255]);
  expect(r.stageBg).toBe("rgb(255, 255, 255)");
  expect(r.contains).toBe(true);
  expect(r.chain).toEqual([]);
  expect(r.animations).toBe(0);
  await p.context.close();
});

async function holdNextDigest(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __releaseDigest: () => void };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    w.__releaseDigest = release;
    const original = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = async function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto["digest"]>): Promise<ArrayBuffer> {
      SubtleCrypto.prototype.digest = original;
      await gate;
      return original.apply(this, args);
    };
  });
}

/** Expected step states for a real controller state (the same table as tests/qr-steps.test.ts). */
const STEP_TABLE: Record<string, [string, string, string]> = {
  idle: ["pending", "pending", "pending"],
  scanning: ["current", "pending", "pending"],
  scanned: ["done", "current", "pending"],
  importing: ["done", "done", "current"],
  imported: ["done", "done", "done"],
  rejected: ["error", "pending", "pending"],
};
async function expectSteps(page: Page, state: string): Promise<void> {
  await expectScanState(page, state);
  const got = await page.locator('[data-testid="qr-steps"] > li').evaluateAll((els) => els.map((e) => e.getAttribute("data-step-state")));
  expect(got, `steps at ${state}`).toEqual(STEP_TABLE[state]);
  expect(await page.getByTestId("qr-scan-panel").getAttribute("data-qr-state")).toBe(state);
}

test("E2E-KW-PB-10: Scan, Review, Import follows the real scan states and adds nothing focusable or live", async ({ browser }) => {
  const p = await qrOnlineProfile(browser, BOARD, { width: 390, height: 844 });
  const page = p.page;
  const steps = page.getByTestId("qr-steps");
  await expectSteps(page, "idle");
  for (const label of ["Scan", "Review", "Import"]) await expect(steps.getByText(label, { exact: true })).toBeVisible();
  for (const id of ["scan", "review", "import"]) await expect(steps.locator(`use[href="#gs-courier-step-${id}"]`)).toHaveCount(1);
  await setCameraFrame(page, undefined);
  await press(page, qrBtn(page, "qr-scan-btn"));
  await expectSteps(page, "scanning");
  await press(page, qrBtn(page, "qr-scan-cancel"));
  await expectSteps(page, "idle");
  // A damaged code is rejected: the Scan step shows the problem and nothing is invented.
  await scanFrame(page, capsuleFrame(flipUpdateByte(await peerCapsule())), "rejected");
  await expectSteps(page, "rejected");
  // A real capsule: Review shows the board name and the import button.
  await scanFrame(page, capsuleFrame(await peerCapsule()));
  await expectSteps(page, "scanned");
  await expect(qrBtn(page, "qr-import-btn")).toBeVisible();
  await expect(page.getByTestId("qr-review-heading")).toBeFocused();
  await expect(qrBtn(page, "qr-discard-btn")).toBeVisible();
  await expect(page.getByTestId("qr-review-board")).toBeVisible();
  await expect(page.getByTestId("qr-review-board")).toHaveText((await page.getByTestId("qr-meta-document-id").textContent()) ?? "?");
  await expect(page.getByTestId("qr-scan-panel").locator(".gs-trust")).toBeVisible();
  expect(await steps.locator("a, button, input, select, textarea, summary, [tabindex], [role=alert], [aria-live], [role=status]").count()).toBe(0);
  // Importing (held open) and imported.
  await holdNextDigest(page);
  await press(page, qrBtn(page, "qr-import-btn"));
  await expectSteps(page, "importing");
  await page.evaluate(() => (window as unknown as { __releaseDigest: () => void }).__releaseDigest());
  await expectSteps(page, "imported");
  await expect(page.getByTestId("import-result")).toHaveAttribute("data-import-state", "applied-saved");
  // Tab order inside the block (Show, Hide, Scan) is asserted by the existing E2E-QR-08; the steps add no tab stop.
  await p.context.close();
});

test("E2E-KW-PB-11: the import result says whether it saved (saved, then applied but not saved)", async ({ browser }) => {
  const s = await qrOnlineProfile(browser, BOARD, { width: 390, height: 844 });
  await scanFrame(s.page, capsuleFrame(await peerCapsule()));
  await press(s.page, qrBtn(s.page, "qr-import-btn"));
  await expect(s.page.getByTestId("import-result")).toHaveAttribute("data-import-state", "applied-saved");
  await expect(s.page.getByTestId("merge-summary")).toContainText("Imported:");
  await expect(s.page.getByTestId("merge-summary")).toContainText("Saved on this device.");
  await s.context.close();
  const u = await qrOnlineProfile(browser, BOARD, { width: 390, height: 844 });
  await scanFrame(u.page, capsuleFrame(await peerCapsule()));
  await armAbort(u.page);
  await press(u.page, qrBtn(u.page, "qr-import-btn"));
  await expect(u.page.getByTestId("import-result")).toHaveAttribute("data-import-state", "applied-unsaved");
  const alert = u.page.getByTestId("save-error-alert");
  await expect(alert).toContainText("Capsule applied, but NOT saved to this device");
  await expect(alert.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await expect(u.page.getByTestId("merge-summary")).toContainText("Not saved to this device yet. Use Retry save.");
  await expect(u.page.getByTestId("merge-summary")).not.toContainText("Saved on this device.");
  await u.context.close();
});

test("E2E-KW-PB-12: offline reload shows the hero and the banner from the local cache with only same-origin requests", async ({ browser }) => {
  const p = await newProfile(browser, { viewport: { width: 390, height: 664 } });
  const page = p.page;
  await loadUntilOfflineReady(page);
  await p.context.setOffline(true);
  const origins = new Set<string>();
  page.on("request", (r) => origins.add(new URL(r.url()).origin));
  await page.reload();
  await expect(page.getByText("When the signal dies, the work goes on.", { exact: true })).toBeVisible();
  expect(await page.locator("#hero-art svg use").count()).toBeGreaterThan(0);
  expect((await box(page, "#hero-art svg")).width).toBeGreaterThan(0);
  await expect(page.getByLabel("Board ID")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open board", exact: true })).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toContainText("A board already opened on this device still opens.");
  expect([...origins]).toEqual([new URL(BASE).origin]);
  await p.context.close();
});

test("E2E-KW-PB-13: iPhone-sized layouts do not overflow, nothing sticks over controls, safe-area and dvh are in the build (Chromium emulation)", async ({ browser }) => {
  for (const { w, h } of IPHONES) {
    const p = await iphone(browser, w, h);
    const page = p.page;
    await loadUntilOfflineReady(page);
    await join(page, BOARD);
    await addCardUi(page, "Check generator fuel", "Before the night shift");
    await awaitSaved(page);
    const r = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      fixed: [...document.querySelectorAll("body *")].filter((e) => ["fixed", "sticky"].includes(getComputedStyle(e).position) && e.getBoundingClientRect().width > 0).map((e) => e.tagName),
    }));
    expect(r.overflow, `${w}x${h} overflow`).toBeLessThanOrEqual(0);
    expect(r.fixed).toEqual([]);
    await btn(page, "Add card").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Import", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeInViewport();
    await p.context.close();
  }
  const page = (await newProfile(browser)).page;
  await page.goto("/");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  const css = await page.evaluate(async () => {
    const hrefs = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href);
    return (await Promise.all(hrefs.map((u) => fetch(u).then((x) => x.text())))).join("\n");
  });
  expect(viewport).toContain("viewport-fit=cover");
  for (const edge of ["top", "right", "bottom", "left"]) expect(css).toContain(`env(safe-area-inset-${edge}`);
  expect(css.indexOf("100dvh")).toBeGreaterThan(css.indexOf("100vh"));
});

test("E2E-KW-PB-15: focus ring, 44px targets and reduced motion across join, Help, workspace, offline and QR review", async ({ browser }) => {
  for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 664 }]) {
    const p = await newProfile(browser, { viewport: vp });
    const page = p.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadUntilOfflineReady(page);
    const see = page.getByRole("button", { name: "See how it works", exact: true });
    await see.focus();
    await page.keyboard.press("Enter");
    const checkFocusable = async (label: string): Promise<void> => {
      const bad = await page.evaluate(() => {
        const sel = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button]";
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width <= 1 || r.height <= 1 || cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden]") !== null) continue;
          const d = `${el.tagName.toLowerCase()}#${el.id}"${(el.textContent ?? "").trim().slice(0, 24)}"`;
          if (r.width < 43.5 || r.height < 43.5) out.push(`${d} size ${Math.round(r.width)}x${Math.round(r.height)}`);
          el.focus();
          const f = getComputedStyle(el);
          if (document.activeElement === el && (f.outlineWidth !== "3px" || f.outlineStyle === "none")) out.push(`${d} outline ${f.outlineWidth} ${f.outlineStyle}`);
        }
        return out;
      });
      expect(bad, label).toEqual([]);
      expect(await page.evaluate(() => document.getAnimations().length), `${label} animations`).toBe(0);
    };
    await checkFocusable(`join+guide ${vp.width}`);
    await page.getByRole("button", { name: "Close help", exact: true }).focus();
    await page.keyboard.press("Enter");
    await join(page, BOARD);
    await addCardUi(page, "Check generator fuel");
    await checkFocusable(`workspace ${vp.width}`);
    await p.context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await checkFocusable(`offline ${vp.width}`);
    await p.context.close();
  }
  const q = await qrOnlineProfile(browser, BOARD, { width: 390, height: 844 });
  await q.page.emulateMedia({ reducedMotion: "reduce" });
  await scanFrame(q.page, capsuleFrame(await peerCapsule()));
  expect(await q.page.evaluate(() => document.getAnimations().length)).toBe(0);
  const visibleText = await q.page.locator('[data-testid="qr-steps"] > li').evaluateAll((els) => els.map((e) => e.textContent));
  expect(new Set(visibleText).size).toBe(3);
  await q.context.close();
});
