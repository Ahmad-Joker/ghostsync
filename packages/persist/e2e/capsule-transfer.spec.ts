/**
 * file-capsules — REAL file transfer between TWO INDEPENDENT browser contexts
 * (separate profiles: separate IndexedDB, storage, service workers) with
 * DISTINCT replicaIds. The sender produces a genuine browser download (Blob +
 * anchor, captured through Playwright's download event and saved as a real
 * file); the receiver imports that real file through the real <input
 * type="file">. Both pages are loaded with networking ENABLED and then taken
 * OFFLINE (context.setOffline(true)) BEFORE any session is opened or any
 * transfer happens, so the transfer itself needs no network.
 *
 * Nothing here is mocked: results are read from the real harness DOM
 * (#capsule-result) and the real PersistSession.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";

import { loadHarnessOffline, reloadHarnessOffline, uniqueDbName } from "./helpers.js";

const APP = "fieldledger";
const DOC = "incident-42";

interface Peer {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly db: string;
}

async function bootOfflinePeer(browser: Browser, baseURL: string | undefined): Promise<Peer> {
  // A brand-new context is an isolated profile (own IndexedDB / caches / SWs).
  const context = await browser.newContext({ baseURL: baseURL ?? "", acceptDownloads: true });
  const page = await context.newPage();
  await loadHarnessOffline(page, context);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  return { context, page, db: uniqueDbName("capsule") };
}

async function openPeer(peer: Peer, replicaId: string): Promise<void> {
  const opened = await peer.page.evaluate(
    async (a: { db: string; replicaId: string; app: string; doc: string }) =>
      window.__gs.open("s", { app: a.app, documentId: a.doc, replicaId: a.replicaId, dbName: a.db }),
    { db: peer.db, replicaId, app: APP, doc: DOC },
  );
  expect(opened).toMatchObject({ ok: true, replicaId });
}

async function downloadTo(peer: Peer, path: string): Promise<string> {
  const [download] = await Promise.all([
    peer.page.waitForEvent("download"),
    peer.page.locator("#capsule-download").click(),
  ]);
  await download.saveAs(path);
  return download.suggestedFilename();
}

test.describe("capsule file transfer between independent contexts (offline)", () => {
  test("download -> upload both ways converges with networking disabled", async ({ browser, baseURL }, testInfo) => {
    const a = await bootOfflinePeer(browser, baseURL);
    const b = await bootOfflinePeer(browser, baseURL);
    try {
      await openPeer(a, "replica-A");
      await openPeer(b, "replica-B");

      await a.page.evaluate(() => {
        window.__gs.set("s", "status", "triage");
        window.__gs.set("s", "shared", "from-A");
        window.__gs.putIncident("s", "i1", { id: "i1", title: "Spill", priority: 1 });
      });
      await b.page.evaluate(() => {
        window.__gs.set("s", "owner", "bob");
        window.__gs.set("s", "shared", "from-B");
        window.__gs.putIncident("s", "i2", { id: "i2", title: "Leak", priority: 2 });
      });

      // --- A -> B: genuine download, saved as a real file, then a real upload.
      const fileA = testInfo.outputPath("from-A.gscap");
      const nameA = await downloadTo(a, fileA);
      expect(nameA.endsWith(".gscap")).toBe(true);
      const onDiskA = readFileSync(fileA);
      expect(onDiskA.subarray(0, 5).toString("latin1")).toBe("GSCAP");
      expect(onDiskA.length).toBeGreaterThan(100);

      await b.page.locator("#capsule-file").setInputFiles(fileA);
      const resultB = b.page.locator("#capsule-result");
      await expect(resultB).toHaveAttribute("data-applied", "true");
      await expect(resultB).toHaveAttribute("data-persisted", "true");
      await expect(resultB).toHaveAttribute("data-state", "done");
      await expect(resultB).toContainText("applied: true");
      await expect(resultB).toContainText("persisted: true");

      // --- B -> A (B now holds both sides' data; the file is B's full state).
      const fileB = testInfo.outputPath("from-B.gscap");
      const nameB = await downloadTo(b, fileB);
      expect(nameB.endsWith(".gscap")).toBe(true);
      expect(nameB).not.toBe(nameA); // distinct replicaIds in the suggested names
      await a.page.locator("#capsule-file").setInputFiles(fileB);
      const resultA = a.page.locator("#capsule-result");
      await expect(resultA).toHaveAttribute("data-applied", "true");
      await expect(resultA).toHaveAttribute("data-persisted", "true");

      // --- Convergence: the same data is visible on both independent replicas.
      const read = (p: Page) =>
        p.evaluate(() => ({
          status: window.__gs.get("s", "status"),
          owner: window.__gs.get("s", "owner"),
          shared: window.__gs.get("s", "shared"),
          ids: window.__gs.listIncidentIds("s").sort(),
          i1: window.__gs.getIncident("s", "i1"),
          i2: window.__gs.getIncident("s", "i2"),
          state: window.__gs.state("s"),
        }));
      const viewA = await read(a.page);
      const viewB = await read(b.page);
      expect(viewA).toEqual(viewB);
      expect(viewA.status).toBe("triage");
      expect(viewA.owner).toBe("bob");
      expect(["from-A", "from-B"]).toContain(viewA.shared);
      expect(viewA.ids).toEqual(["i1", "i2"]);
      expect(viewA.i1).toEqual({ id: "i1", title: "Spill", priority: 1 });
      expect(viewA.i2).toEqual({ id: "i2", title: "Leak", priority: 2 });
      expect(viewA.state).toBe("saved");

      // The two contexts really had distinct replica identities and stayed offline.
      expect(await a.page.evaluate(() => navigator.onLine)).toBe(false);
      expect(await b.page.evaluate(() => navigator.onLine)).toBe(false);

      // Download object URLs are revoked once no longer needed.
      await a.page.waitForFunction(() => {
        const s = window.__gs.capsuleUrlStats();
        return s.created > 0 && s.revoked === s.created;
      });

      // Imported data was flushed (persisted:true): it survives a reload of B.
      await reloadHarnessOffline(b.page, b.context);
      const restored = await b.page.evaluate(async (db: string) => {
        const o = await window.__gs.open("s", { app: "fieldledger", documentId: "incident-42", replicaId: "replica-B", dbName: db });
        const out = {
          opened: o,
          status: window.__gs.get("s", "status"),
          owner: window.__gs.get("s", "owner"),
          ids: window.__gs.listIncidentIds("s").sort(),
        };
        await window.__gs.close("s");
        return out;
      }, b.db);
      expect(restored.opened).toMatchObject({ ok: true, restored: true });
      expect(restored.status).toBe("triage");
      expect(restored.owner).toBe("bob");
      expect(restored.ids).toEqual(["i1", "i2"]);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("invalid and mislabelled files: rejected visibly with nothing applied; file name is only a hint", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const a = await bootOfflinePeer(browser, baseURL);
    const b = await bootOfflinePeer(browser, baseURL);
    try {
      await openPeer(a, "replica-A");
      await openPeer(b, "replica-B");
      await a.page.evaluate(() => window.__gs.set("s", "k", "from-A"));
      await b.page.evaluate(() => window.__gs.set("s", "own", 1));

      // Garbage that CLAIMS to be a capsule by extension: rejected from its bytes.
      const result = b.page.locator("#capsule-result");
      await b.page.locator("#capsule-file").setInputFiles({
        name: "fake.gscap",
        mimeType: "application/vnd.ghostsync.capsule",
        buffer: Buffer.from("this is not a capsule, whatever its name says"),
      });
      await expect(result).toHaveAttribute("data-applied", "false");
      await expect(result).toHaveAttribute("data-state", "error");
      await expect(result).toHaveAttribute("data-error-code", "Malformed");
      await expect(result).toContainText("Nothing was applied");
      expect(await b.page.evaluate(() => window.__gs.get("s", "k"))).toBeUndefined();
      expect(await b.page.evaluate(() => window.__gs.get("s", "own"))).toBe(1);

      // A genuine capsule with a misleading name/type is accepted: hints are not validation.
      const real = testInfo.outputPath("real.gscap");
      await downloadTo(a, real);
      await b.page.locator("#capsule-file").setInputFiles({
        name: "holiday-photo.png",
        mimeType: "image/png",
        buffer: readFileSync(real),
      });
      await expect(result).toHaveAttribute("data-applied", "true");
      expect(await b.page.evaluate(() => window.__gs.get("s", "k"))).toBe("from-A");

      // A capsule for another document is refused by identity, not applied.
      await a.page.evaluate(async (db: string) => {
        await window.__gs.open("other", { app: "fieldledger", documentId: "someone-elses-doc", replicaId: "replica-X", dbName: db });
        window.__gs.set("other", "leak", "no");
      }, a.db);
      const otherHex = (await a.page.evaluate(() => window.__gs.exportCapsuleHex("other"))) as string;
      const otherPath = testInfo.outputPath("other.gscap");
      writeFileSync(otherPath, Buffer.from(otherHex, "hex"));
      await b.page.locator("#capsule-file").setInputFiles(otherPath);
      await expect(result).toHaveAttribute("data-error-code", "DocumentIdentityMismatch");
      expect(await b.page.evaluate(() => window.__gs.get("s", "leak"))).toBeUndefined();
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("a file over the configured raw limit is rejected from File.size BEFORE arrayBuffer() is read", async ({
    browser,
    baseURL,
  }) => {
    const a = await bootOfflinePeer(browser, baseURL);
    try {
      await openPeer(a, "replica-A");
      const outcome = await a.page.evaluate(async () => {
        window.__gs.setCapsuleMaxBytes(100);
        const file = new File([new Uint8Array(5000)], "huge.gscap", { type: "application/octet-stream" });
        let read = false;
        const realArrayBuffer = file.arrayBuffer.bind(file);
        file.arrayBuffer = (): Promise<ArrayBuffer> => {
          read = true;
          return realArrayBuffer();
        };
        const view = await window.__gs.importCapsuleFile("s", file);
        return { view, read };
      });
      expect(outcome.read).toBe(false);
      expect(outcome.view).toMatchObject({ ok: false, applied: false, error: { code: "OversizedRaw" } });
      const result = a.page.locator("#capsule-result");
      await expect(result).toHaveAttribute("data-error-code", "OversizedRaw");
      await expect(result).toContainText("Nothing was applied");
    } finally {
      await a.context.close();
    }
  });

  test("the file input and download button are keyboard reachable with a visible focus ring", async ({
    browser,
    baseURL,
  }) => {
    const a = await bootOfflinePeer(browser, baseURL);
    try {
      await a.page.locator("#capsule-handle").focus();
      await a.page.keyboard.press("Tab");
      await expect(a.page.locator("#capsule-download")).toBeFocused();
      const outline = await a.page
        .locator("#capsule-download")
        .evaluate((el) => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth);
      expect(outline).toContain("solid");
      expect(outline).toContain("3px");
      await a.page.keyboard.press("Tab");
      await expect(a.page.locator("#capsule-file")).toBeFocused();
    } finally {
      await a.context.close();
    }
  });
});
