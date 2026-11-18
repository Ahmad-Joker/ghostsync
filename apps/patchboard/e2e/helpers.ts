/**
 * Shared Playwright helpers. Test-only failure injection lives here (addInitScript); the shipped
 * bundle contains none of it (asserted by tests/dist-scan.test.ts).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { decodeCapsule, encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import type { EntityAdapter, Fields, GetResult, Replica } from "@ghostsync/kit";
import { cardAdapter, type Card } from "../src/model/adapters.js";

export const BOARD = "sprint-board";
export const BASE = "http://localhost:4339";

export interface Profile {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** Test-only hooks injected into the page BEFORE any app script runs. */
function installTestHooks(): void {
  interface Hooks {
    armWriteAbortOnce(): void;
    setWriteAbortSticky(on: boolean): void;
  }
  let abortArmed = false;
  let abortSticky = false;
  const w = window as unknown as { __ghostsyncTest: Hooks };
  w.__ghostsyncTest = {
    armWriteAbortOnce: () => {
      abortArmed = true;
    },
    setWriteAbortSticky: (on: boolean) => {
      abortSticky = on;
    },
  };
  const proto = IDBDatabase.prototype;
  const realTransaction = proto.transaction;
  proto.transaction = function patched(this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>): IDBTransaction {
    const tx = realTransaction.apply(this, args);
    if ((abortArmed || abortSticky) && args[1] === "readwrite") {
      abortArmed = false;
      const realObjectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name: string): IDBObjectStore => {
        const store = realObjectStore(name);
        const realPut = store.put.bind(store);
        store.put = (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> => {
          const req = realPut(value as never, key as never);
          try {
            tx.abort();
          } catch {
            /* already settling */
          }
          return req;
        };
        return store;
      };
    }
    return tx;
  } as IDBDatabase["transaction"];
}

/** Test-side recorder: appends every observed offline attribute value on <html> to an in-page array. */
function installOfflineRecorder(): void {
  const w = window as unknown as { __offlineStates: Array<{ state: string | null; ready: string | null; notice: boolean }> };
  w.__offlineStates = [];
  const record = (): void => {
    const el = document.documentElement;
    const n = document.querySelector<HTMLElement>('[data-testid="first-visit-notice"]');
    w.__offlineStates.push({ state: el.getAttribute("data-offline-state"), ready: el.getAttribute("data-offline-ready"), notice: n !== null && !n.hidden });
  };
  new MutationObserver(record).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-offline-state", "data-offline-ready"] });
  record();
}

export async function newProfile(browser: Browser, opts: { viewport?: { width: number; height: number }; recordOffline?: boolean } = {}): Promise<Profile> {
  const { recordOffline, ...ctxOpts } = opts;
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true, ...ctxOpts });
  await context.addInitScript(installTestHooks);
  if (recordOffline === true) await context.addInitScript(installOfflineRecorder);
  const page = await context.newPage();
  return { context, page };
}

export function recordedOfflineStates(page: Page): Promise<Array<{ state: string | null; ready: string | null; notice: boolean }>> {
  return page.evaluate(() => (window as unknown as { __offlineStates: Array<{ state: string | null; ready: string | null; notice: boolean }> }).__offlineStates);
}

/** Load online and wait until the app reports GENUINE offline readiness. */
export async function loadUntilOfflineReady(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
}

export async function join(page: Page, rawId: string): Promise<void> {
  await page.getByLabel("Board ID").fill(rawId);
  await press(page, btn(page, "Open board"));
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
}

/** Open a fresh profile, load until offline-ready, go offline, reload from the worker, join. */
export async function offlineProfileOnBoard(browser: Browser, boardId = BOARD): Promise<Profile> {
  const p = await newProfile(browser);
  await loadUntilOfflineReady(p.page);
  await p.context.setOffline(true);
  await p.page.reload();
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await join(p.page, boardId);
  return p;
}

/** Focus the control (asserted, with a 3 px focus outline) and press ONE key. Never clicks. */
export async function press(page: Page, locator: Locator, key = "Enter"): Promise<void> {
  await locator.focus();
  await expect(locator).toBeFocused();
  expect(await locator.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("3px");
  await page.keyboard.press(key);
}

/** The data-card-id of the card that contains the focused element, if any. */
export function activeCardId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.closest("[data-card-id]")?.getAttribute("data-card-id") ?? null);
}

export function activeIsBody(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement === document.body || document.activeElement === null);
}

export const announcer = (page: Page): Locator => page.getByTestId("announcer");

export const btn = (page: Page, name: string): Locator => page.getByRole("button", { name, exact: true });

export const saveIndicator = (page: Page): Locator => page.locator('[data-testid="save-indicator"]');

export async function awaitSaved(page: Page): Promise<void> {
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect(saveIndicator(page)).toHaveText(/Saved locally/);
}

export async function saveSequence(page: Page): Promise<number> {
  return Number(await saveIndicator(page).getAttribute("data-save-sequence"));
}

/** Wait until the indicator is saved with a sequence greater than `after`. */
export async function awaitSavedAfter(page: Page, after: number): Promise<number> {
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect.poll(async () => saveSequence(page)).toBeGreaterThan(after);
  return saveSequence(page);
}

/** Add a card by pointer or keyboard. Returns the new card's ID. */
export async function addCardUi(page: Page, title: string, notes = "", viaKeyboard = true): Promise<string> {
  await page.getByLabel("New card title").fill(title);
  if (notes !== "") await page.getByLabel("Notes (optional)").fill(notes);
  const add = btn(page, "Add card");
  if (viaKeyboard) await press(page, add);
  else await add.click();
  const card = page.locator("li[data-card-id]", { has: page.getByTestId("card-title").filter({ hasText: new RegExp(`^${escapeRe(title)}$`) }) });
  await expect(card).toHaveCount(1);
  return (await card.getAttribute("data-card-id")) ?? "";
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface UiCard {
  id: string;
  title: string;
  notes: string;
}
export interface UiBoard {
  todo: UiCard[];
  doing: UiCard[];
  done: UiCard[];
  invalid: string[];
}

export async function readUiBoard(page: Page): Promise<UiBoard> {
  return page.evaluate(() => {
    const col = (c: string): Array<{ id: string; title: string; notes: string }> =>
      [...document.querySelectorAll(`[data-testid="column-${c}"] li[data-card-id]`)].map((li) => ({
        id: li.getAttribute("data-card-id") ?? "",
        title: li.querySelector('[data-testid="card-title"]')?.textContent ?? "",
        notes: li.querySelector('[data-testid="card-notes"]')?.textContent ?? "",
      }));
    return {
      todo: col("todo"),
      doing: col("doing"),
      done: col("done"),
      invalid: [...document.querySelectorAll('[data-testid="invalid-cards"] li[data-card-id]')].map((li) => li.getAttribute("data-card-id") ?? ""),
    };
  });
}

export const column = (page: Page, c: "todo" | "doing" | "done"): Locator => page.locator(`[data-testid="column-${c}"]`);
export const cardIn = (page: Page, c: "todo" | "doing" | "done", id: string): Locator => column(page, c).locator(`li[data-card-id="${id}"]`);

// ---------------- persisted state ----------------

export interface StoredRecordView {
  app: string;
  documentId: string;
  replicaId: string;
  sequence: number;
  checksum: string;
  savedAt: number;
  bytes: number[];
}

export async function readStoredRecords(page: Page): Promise<StoredRecordView[]> {
  return page.evaluate(
    () =>
      new Promise<StoredRecordView[]>((resolve, reject) => {
        // Never create the database as a side effect of observing it.
        void indexedDB.databases().then((dbs) => {
          if (!dbs.some((d) => d.name === "patchboard")) {
            resolve([]);
            return;
          }
          readAll();
        });
        const readAll = (): void => {
        const open = indexedDB.open("patchboard");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("replicas")) {
            db.close();
            resolve([]);
            return;
          }
          const req = db.transaction("replicas", "readonly").objectStore("replicas").getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve(
              (req.result as Array<Record<string, unknown>>).map((r) => ({
                app: String(r["app"]),
                documentId: String(r["documentId"]),
                replicaId: String(r["replicaId"]),
                sequence: Number(r["sequence"]),
                checksum: String(r["checksum"]),
                savedAt: Number(r["savedAt"]),
                bytes: [...(r["bytes"] as Uint8Array)],
              })),
            );
          };
        };
        };
      }),
  );
}

export type DecodedCards = Array<[string, GetResult<Card>]>;

function normalize(r: GetResult<Card>): GetResult<Card> {
  return r.ok || r.reason !== "invalidRecord" ? r : { ok: false, reason: "invalidRecord", id: r.id, fields: r.fields, cause: "invalid" };
}

/** Decode raw persisted bytes with the REAL Kit in Node. Sorted by ID, causes normalized. */
export function decodeBytes(bytes: ArrayLike<number>, documentId = BOARD): DecodedCards {
  const r = createKit().createReplica(documentId, Uint8Array.from(bytes));
  try {
    const list = [...r.collection(cardAdapter).listResults()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return list.map(([id, res]) => [id, normalize(res)] as [string, GetResult<Card>]);
  } finally {
    r.destroy();
  }
}

export async function storedState(page: Page): Promise<{ record: StoredRecordView; cards: DecodedCards }> {
  const recs = await readStoredRecords(page);
  expect(recs).toHaveLength(1);
  const record = recs[0] as StoredRecordView;
  return { record, cards: decodeBytes(record.bytes, record.documentId) };
}

export function validCard(cards: DecodedCards, id: string): Card | undefined {
  const hit = cards.find(([i]) => i === id)?.[1];
  return hit?.ok === true ? hit.entity : undefined;
}

export async function decodeCapsuleFile(path: string): Promise<DecodedCards> {
  const d = await decodeCapsule(new Uint8Array(readFileSync(path)));
  return decodeBytes(d.update, d.metadata.documentId);
}

// ---------------- file exchange ----------------

export async function exportCapsule(page: Page, testInfo: TestInfo, name: string, viaKeyboard = true): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  const b = btn(page, "Export capsule (.gscap)");
  if (viaKeyboard) await press(page, b);
  else await b.click();
  const download = await downloadPromise;
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  return path;
}

export async function importFile(page: Page, path: string): Promise<void> {
  await page.getByTestId("import-input").setInputFiles(path);
}

export const importResult = (page: Page): Locator => page.locator('[data-testid="import-result"]');

/** Assert the displayed capsule metadata equals what the Node-side decode of the file says. */
export async function expectImportMeta(page: Page, capsulePath: string, boardId = BOARD): Promise<void> {
  const { metadata } = await decodeCapsule(new Uint8Array(readFileSync(capsulePath)));
  const region = importResult(page);
  await expect(region.getByTestId("import-meta-app")).toHaveText(metadata.app);
  await expect(region.getByTestId("import-meta-app")).toHaveText("patchboard");
  await expect(region.getByTestId("import-meta-document-id")).toHaveText(metadata.documentId);
  await expect(region.getByTestId("import-meta-document-id")).toHaveText(boardId);
  await expect(region.getByTestId("import-meta-created-at")).toHaveText(metadata.createdAt);
}

// ---------------- capsule building in Node ----------------

export const probeAdapter: EntityAdapter<Fields> = {
  schema: cardAdapter.schema,
  validate(): void {
    /* accepts anything */
  },
  toFields: (e) => ({ ...e }),
  fromFields: (f) => ({ ...f }),
};

/** Build a capsule from a Node-side replica using the built Kit + Capsule. */
export async function buildCapsule(documentId: string, app: string, fill: (r: Replica) => void): Promise<Uint8Array> {
  const r = createKit().createReplica(documentId);
  try {
    fill(r);
    return await encodeCapsule({ app, documentId, update: r.exportState() });
  } finally {
    r.destroy();
  }
}

// ---------------- failure injection (test side only) ----------------

export function armAbort(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as { __ghostsyncTest: { armWriteAbortOnce(): void } }).__ghostsyncTest.armWriteAbortOnce());
}

/** TEST-ONLY: every readwrite transaction aborts until switched off (makes a close() fail for real). */
export function setStickyAbort(page: Page, on: boolean): Promise<void> {
  return page.evaluate((v) => (window as unknown as { __ghostsyncTest: { setWriteAbortSticky(on: boolean): void } }).__ghostsyncTest.setWriteAbortSticky(v), on);
}

// ---------------- test-server controls (failed precache fixture) ----------------

export interface RequestLogEntry {
  n: number;
  method: string;
  path: string;
  status: number;
  cacheControl: string;
}

export async function serverFailAsset(path: string, skip = 1): Promise<void> {
  const r = await fetch(`${BASE}/__test/fail-asset?path=${encodeURIComponent(path)}&skip=${skip}`, { method: "POST" });
  expect(r.status).toBe(204);
}
export async function serverRequestLog(): Promise<RequestLogEntry[]> {
  return (await (await fetch(`${BASE}/__test/request-log`)).json()) as RequestLogEntry[];
}
export async function serverReset(): Promise<void> {
  const r = await fetch(`${BASE}/__test/reset`, { method: "POST" });
  expect(r.status).toBe(204);
}

export function readManifestUrls(): string[] {
  const raw = readFileSync(new URL("../dist/precache-manifest.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { entries: Array<{ url: string }> }).entries.map((e) => e.url);
}

// ---------------- real schema mismatch (test side only) ----------------

interface YjsLike {
  Doc: new () => { getMap(name: string): { set(key: string, value: string): void } };
  applyUpdate(doc: unknown, update: Uint8Array): void;
  encodeStateAsUpdate(doc: unknown): Uint8Array;
}
const kitRequire = createRequire(new URL("../../../packages/kit/package.json", import.meta.url));
const RECORDS_MAP = "ghostsync:records:v1";
const metaKeyFor = (app: string, entityType: string): string => `\u0001m\u001f${app}\u0000\u001f${entityType}`;

/** A capsule that is a causal successor of the stored bytes and declares a NEWER schemaVersion for the card collection. */
export async function newerSchemaCapsule(storedBytes: ArrayLike<number>, documentId = BOARD): Promise<Uint8Array> {
  const Y = (await import(pathToFileURL(kitRequire.resolve("yjs").replace(/yjs\.cjs$/, "yjs.mjs")).href)) as YjsLike;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(storedBytes));
  const s = { ...cardAdapter.schema, schemaVersion: cardAdapter.schema.schemaVersion + 1 };
  doc.getMap(RECORDS_MAP).set(metaKeyFor(s.app, s.entityType), JSON.stringify(s));
  return encodeCapsule({ app: "patchboard", documentId, update: { documentId, kind: "full", bytes: Y.encodeStateAsUpdate(doc) } });
}
