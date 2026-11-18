/**
 * Shared Playwright helpers. Test-only failure injection lives here (addInitScript); the shipped
 * bundle contains none of it (asserted by tests/dist-scan.test.ts).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { decodeCapsule, encodeCapsule } from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";
import type { EntityAdapter, GetResult } from "@ghostsync/kit";
import {
  checklistItemAdapter,
  incidentAdapter,
  type ChecklistItem,
  type IncidentDetails,
} from "../src/model/adapters.js";

export const DOC = "inc-2026-0042";
export const BASE = "http://localhost:4329";

export interface Profile {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** Test-only hooks injected into the page BEFORE any app script runs. */
function installTestHooks(): void {
  interface Hooks {
    armWriteAbortOnce(): void;
    setWriteAbortSticky(on: boolean): void;
    holdNextFileRead(): void;
    releaseFileRead(): void;
  }
  let abortArmed = false;
  let abortSticky = false;
  let holdArmed = false;
  let release: (() => void) | undefined;
  const gate = (): Promise<void> => new Promise<void>((resolve) => (release = resolve));
  const w = window as unknown as { __ghostsyncTest: Hooks };
  w.__ghostsyncTest = {
    armWriteAbortOnce: () => {
      abortArmed = true;
    },
    setWriteAbortSticky: (on: boolean) => {
      abortSticky = on;
    },
    holdNextFileRead: () => {
      holdArmed = true;
    },
    releaseFileRead: () => release?.(),
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
  const realArrayBuffer = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = async function held(this: File): Promise<ArrayBuffer> {
    if (holdArmed) {
      holdArmed = false;
      await gate();
    }
    return realArrayBuffer.call(this);
  };
}

export async function newProfile(browser: Browser, opts: { viewport?: { width: number; height: number } } = {}): Promise<Profile> {
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true, ...opts });
  await context.addInitScript(installTestHooks);
  const page = await context.newPage();
  return { context, page };
}

/** Load online and wait until the app reports GENUINE offline readiness. */
export async function loadUntilOfflineReady(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true");
}

export async function join(page: Page, rawId: string): Promise<void> {
  await page.getByLabel("Incident ID").fill(rawId);
  await page.getByRole("button", { name: "Open incident" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-session", "ready");
}

export const saveIndicator = (page: Page) => page.locator('[data-testid="save-indicator"]');

export async function awaitSaved(page: Page): Promise<void> {
  await expect(saveIndicator(page)).toHaveAttribute("data-save-state", "saved");
  await expect(saveIndicator(page)).toHaveText(/Saved locally/);
}

export async function saveSequence(page: Page): Promise<number> {
  return Number(await saveIndicator(page).getAttribute("data-save-sequence"));
}

/** Wait until the indicator is saved with a sequence greater than `after`. */
export async function awaitSavedAfter(page: Page, after: number): Promise<number> {
  await awaitSaved(page);
  await expect.poll(async () => saveSequence(page)).toBeGreaterThan(after);
  return saveSequence(page);
}

export async function createDetails(page: Page, title: string): Promise<void> {
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create incident details" }).click();
  await expect(page.locator("#f-title")).toHaveValue(title);
}

export async function addItemUi(page: Page, text: string): Promise<void> {
  await page.getByLabel("New checklist item").fill(text);
  await page.getByRole("button", { name: "Add item" }).click();
  await expect.poll(async () => (await itemTexts(page)).includes(text)).toBe(true);
}

export async function itemIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="checklist"] li[data-item-id]').evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id") ?? ""));
}

export async function itemTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="checklist"] li:not([data-invalid]) input[aria-label="Item text"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

export interface UiModel {
  readonly title: string;
  readonly items: Array<{ id: string; text: string; done: boolean } | { id: string; invalid: true }>;
}

export async function readUiModel(page: Page): Promise<UiModel> {
  return page.evaluate(() => {
    const title = (document.getElementById("f-title") as HTMLInputElement | null)?.value ?? "";
    const items = [...document.querySelectorAll('[data-testid="checklist"] li[data-item-id]')].map((li) => {
      const id = li.getAttribute("data-item-id") ?? "";
      if (li.hasAttribute("data-invalid")) return { id, invalid: true as const };
      const text = (li.querySelector('input[type="text"]') as HTMLInputElement).value;
      const done = (li.querySelector('input[type="checkbox"]') as HTMLInputElement).checked;
      return { id, text, done };
    });
    return { title, items };
  });
}

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
        const open = indexedDB.open("fieldledger");
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
                app: String(r.app),
                documentId: String(r.documentId),
                replicaId: String(r.replicaId),
                sequence: Number(r.sequence),
                checksum: String(r.checksum),
                savedAt: Number(r.savedAt),
                bytes: [...(r.bytes as Uint8Array)],
              })),
            );
          };
        };
      }),
  );
}

export interface DecodedState {
  readonly incident: GetResult<IncidentDetails>;
  readonly items: Array<[string, GetResult<ChecklistItem>]>;
}

/** Decode raw persisted bytes with the REAL Kit in Node. */
export function decodeBytes(bytes: ArrayLike<number>, documentId = DOC): DecodedState {
  const r = createKit().createReplica(documentId, Uint8Array.from(bytes));
  try {
    const incidents = r.collection(incidentAdapter);
    const items = r.collection(checklistItemAdapter);
    const list = [...items.listResults()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { incident: incidents.getResult("incident"), items: list.map(([id, res]) => [id, normalize(res)] as [string, GetResult<ChecklistItem>]) };
  } finally {
    r.destroy();
  }
}

/** Replace the (non-comparable) `cause` of an invalid result so states can be deep-compared. */
function normalize(r: GetResult<ChecklistItem>): GetResult<ChecklistItem> {
  return r.ok || r.reason !== "invalidRecord" ? r : { ok: false, reason: "invalidRecord", id: r.id, fields: r.fields, cause: "invalid" };
}

export async function storedState(page: Page): Promise<{ record: StoredRecordView; state: DecodedState }> {
  const recs = await readStoredRecords(page);
  expect(recs).toHaveLength(1);
  const record = recs[0] as StoredRecordView;
  return { record, state: decodeBytes(record.bytes, record.documentId) };
}

export function storedTexts(state: DecodedState): string[] {
  return state.items.flatMap(([, r]) => (r.ok ? [r.entity.text] : []));
}

/** Decode a downloaded capsule file with the REAL Capsule + Kit in Node. */
export async function decodeCapsuleFile(path: string): Promise<DecodedState> {
  const d = await decodeCapsule(new Uint8Array(readFileSync(path)));
  return decodeBytes(d.update, d.metadata.documentId);
}

// ---------------- file exchange ----------------

export let lastDownloadName = "";
export async function exportCapsule(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export capsule (.gscap)" }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath(name);
  lastDownloadName = download.suggestedFilename();
  await download.saveAs(path);
  return path;
}

export async function importFile(page: Page, path: string): Promise<void> {
  await page.getByTestId("import-input").setInputFiles(path);
}

export const importResult = (page: Page) => page.locator('[data-testid="import-result"]');

/** Assert the displayed capsule metadata (AC-FL-013-7) equals what the Node-side decode of the file says. */
export async function expectImportMeta(page: Page, capsulePath: string): Promise<void> {
  const { metadata } = await decodeCapsule(new Uint8Array(readFileSync(capsulePath)));
  const region = importResult(page);
  await expect(region.getByTestId("import-meta-app")).toHaveText("fieldledger");
  await expect(region.getByTestId("import-meta-app")).toHaveText(metadata.app);
  await expect(region.getByTestId("import-meta-document-id")).toHaveText(metadata.documentId);
  await expect(region.getByTestId("import-meta-document-id")).toHaveText(DOC);
  await expect(region.getByTestId("import-meta-created-at")).toHaveText(metadata.createdAt);
}

// ---------------- capsule building in Node ----------------

/** Build a capsule from a Node-side replica using the built Kit + Capsule. */
export async function buildCapsule(documentId: string, app: string, fill: (r: ReturnType<ReturnType<typeof createKit>["createReplica"]>) => void): Promise<Uint8Array> {
  const r = createKit().createReplica(documentId);
  try {
    fill(r);
    return await encodeCapsule({ app, documentId, update: r.exportState() });
  } finally {
    r.destroy();
  }
}

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** ID of the checklist row whose text input currently holds `text`. */
export async function rowId(page: Page, text: string): Promise<string> {
  const model = await readUiModel(page);
  const hit = model.items.find((i) => "text" in i && i.text === text);
  expect(hit, `row with text "${text}"`).toBeDefined();
  return hit?.id ?? "";
}

export async function editText(page: Page, id: string, text: string): Promise<void> {
  const input = page.locator(`li[data-item-id="${id}"]`).getByLabel("Item text");
  await input.fill(text);
  await input.press("Enter");
}

/** Open a fresh profile, load until offline-ready, go offline, reload from the worker, join. */
export async function offlineProfileInIncident(browser: Browser, documentId = DOC): Promise<Profile> {
  const p = await newProfile(browser);
  await loadUntilOfflineReady(p.page);
  await p.context.setOffline(true);
  await p.page.reload();
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await join(p.page, documentId);
  return p;
}

export function armAbort(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as { __ghostsyncTest: { armWriteAbortOnce(): void } }).__ghostsyncTest.armWriteAbortOnce());
}

/** TEST-ONLY: every readwrite transaction aborts until switched off (used to make a close() fail for real). */
export function setStickyAbort(page: Page, on: boolean): Promise<void> {
  return page.evaluate((v) => (window as unknown as { __ghostsyncTest: { setWriteAbortSticky(on: boolean): void } }).__ghostsyncTest.setWriteAbortSticky(v), on);
}

// ---------------- real schema mismatch (test side only) ----------------

/** Minimal surface of Yjs, resolved from the Kit package (the app has no yjs dependency of its own). */
interface YjsLike {
  Doc: new () => { getMap(name: string): { set(key: string, value: string): void } };
  applyUpdate(doc: unknown, update: Uint8Array): void;
  encodeStateAsUpdate(doc: unknown): Uint8Array;
}
const kitRequire = createRequire(new URL("../../../packages/kit/package.json", import.meta.url));

/** The Kit's records-map name and meta-key grammar (packages/kit/src/keys.ts) for the two FieldLedger collections. */
const RECORDS_MAP = "ghostsync:records:v1";
/** metaKey(collectionId(app, entityType)): the collection id's own separator is escaped inside the meta key. */
const metaKeyFor = (app: string, entityType: string): string => `\u0001m\u001f${app}\u0000\u001f${entityType}`;

/** A copy of an adapter with the SAME schema identity (app/entityType) but a higher schemaVersion. */
export function withHigherSchema<T>(adapter: EntityAdapter<T>): EntityAdapter<T> {
  return { ...adapter, schema: { ...adapter.schema, schemaVersion: adapter.schema.schemaVersion + 1 } };
}

/**
 * Build a capsule that is a causal successor of `storedBytes` (the page's persisted record) and whose
 * schema metadata for both FieldLedger collections declares a NEWER schemaVersion. Importing it into a
 * ready workspace makes every later collection operation throw the Kit's real schema-mismatch error.
 */
export async function newerSchemaCapsule(storedBytes: ArrayLike<number>, documentId = DOC): Promise<Uint8Array> {
  // Load the same ESM build the Kit uses, so Yjs is not imported twice in this process.
  const Y = (await import(pathToFileURL(kitRequire.resolve("yjs").replace(/yjs\.cjs$/, "yjs.mjs")).href)) as YjsLike;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(storedBytes));
  const records = doc.getMap(RECORDS_MAP);
  for (const a of [incidentAdapter, checklistItemAdapter] as Array<EntityAdapter<unknown>>) {
    const s = withHigherSchema(a).schema;
    records.set(metaKeyFor(s.app, s.entityType), JSON.stringify(s));
  }
  return encodeCapsule({ app: "fieldledger", documentId, update: { documentId, kind: "full", bytes: Y.encodeStateAsUpdate(doc) } });
}

/** Decode raw bytes whose schema meta is the NEWER version, with test-local adapters of that version. */
export function decodeBytesNewer(bytes: ArrayLike<number>, documentId = DOC): DecodedState {
  const r = createKit().createReplica(documentId, Uint8Array.from(bytes));
  try {
    const incidents = r.collection(withHigherSchema(incidentAdapter));
    const items = r.collection(withHigherSchema(checklistItemAdapter));
    const list = [...items.listResults()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { incident: incidents.getResult("incident"), items: list.map(([id, res]) => [id, normalize(res)] as [string, GetResult<ChecklistItem>]) };
  } finally {
    r.destroy();
  }
}

export async function decodeCapsuleFileNewer(path: string): Promise<DecodedState> {
  const d = await decodeCapsule(new Uint8Array(readFileSync(path)));
  return decodeBytesNewer(d.update, d.metadata.documentId);
}