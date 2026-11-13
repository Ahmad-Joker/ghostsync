/**
 * Browser test harness (NOT an application UI). It wires `openReplica` from the
 * BUILT `@ghostsync/persist` entry plus a FieldLedger-style adapter, and exposes
 * `window.__gs` whose methods resolve on REAL lifecycle events (open resolved,
 * flush resolved which is gated on transaction.oncomplete). Readiness is
 * observable: tests await `window.__gs` being defined, never sleep.
 *
 * The harness uses the real browser IndexedDB, real crypto.subtle SHA-256, and
 * the real navigator.locks API — this is the acceptance surface (REQ-BP-007).
 */
import {
  CAPSULE_EXTENSION,
  CAPSULE_MEDIA_TYPE,
  DEFAULT_MAX_CAPSULE_BYTES,
  encodeCapsule,
  importCapsuleIntoPersisted,
  isCapsuleError,
  type PersistTarget,
} from "@ghostsync/capsule";
import { createKit } from "@ghostsync/kit";

import { initOfflineReadiness } from "./sw-register.js";
import {
  isPersistenceError,
  openReplica,
  type ApplyOutcome,
  type EntityAdapter,
  type Fields,
  type OpenOptions,
  type PersistSession,
  type SaveState,
} from "@ghostsync/persist";

interface Incident {
  id: string;
  title: string;
  priority: number;
}

const incidentAdapter: EntityAdapter<Incident> = {
  schema: { app: "fieldledger", schemaVersion: 1, entityType: "incident" },
  validate(entity: Incident): void {
    if (typeof entity.id !== "string" || entity.id.length === 0) {
      throw new TypeError("incident.id must be a non-empty string");
    }
    if (typeof entity.title !== "string") {
      throw new TypeError("incident.title must be a string");
    }
    if (typeof entity.priority !== "number" || !Number.isFinite(entity.priority)) {
      throw new TypeError("incident.priority must be a finite number");
    }
  },
  toFields: (e) => ({ id: e.id, title: e.title, priority: e.priority }),
  fromFields: (f: Fields) => ({
    id: String(f["id"]),
    title: String(f["title"]),
    priority: Number(f["priority"]),
  }),
};

interface ErrorInfo {
  readonly ok: false;
  readonly code: string | undefined;
  readonly message: string;
}

function asError(err: unknown): ErrorInfo {
  if (isPersistenceError(err)) {
    return { ok: false, code: err.code, message: err.message };
  }
  return {
    ok: false,
    code: undefined,
    message: err instanceof Error ? err.message : String(err),
  };
}

/** Hex-encode bytes so tests can compare snapshots across reloads. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

const sessions = new Map<string, PersistSession>();
const stateLog = new Map<string, SaveState[]>();
/** TEST-ONLY: collection handles captured while a session was open (fix 4). */
type GuardedIncidentCollection = ReturnType<PersistSession["collection"]>;
const capturedCollections = new Map<string, GuardedIncidentCollection>();

/**
 * TEST-ONLY one-shot real-IndexedDB abort. When armed, the NEXT readwrite
 * transaction opened via IDBDatabase.prototype.transaction aborts immediately
 * after its first underlying put, producing a genuine mid-transaction abort so
 * the session's TransactionAbortError recovery path is exercised in a real
 * browser. This patches a PROTOTYPE only in the harness; the shipped package has
 * no such hook.
 */
let abortArmed = false;
/**
 * TEST-ONLY lifecycle event order log (fix 2). Records, in occurrence order, the
 * terminal transaction abort, the actual Web Lock release, and dispose
 * resolution so a Chromium regression can assert the ordering explicitly. This
 * is harness-side instrumentation only; the shipped package has no such hook.
 */
const lifecycleLog: string[] = [];
function installWriteAbortHook(): void {
  const proto = IDBDatabase.prototype;
  const realTransaction = proto.transaction;
  proto.transaction = function patchedTransaction(
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase["transaction"]>
  ): IDBTransaction {
    const tx = realTransaction.apply(this, args);
    const mode = args[1];
    if (abortArmed && mode === "readwrite") {
      abortArmed = false;
      // STACK with writeRecord's own onabort handler (do not overwrite it).
      tx.addEventListener("abort", () => {
        lifecycleLog.push("tx:abort");
      });
      const realObjectStore = tx.objectStore.bind(tx);
      tx.objectStore = (name: string): IDBObjectStore => {
        const store = realObjectStore(name);
        const realPut = store.put.bind(store);
        store.put = (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> => {
          const req = realPut(value as never, key as never);
          // Abort the live transaction right after the put is enqueued — a real
          // mid-transaction abort (tx.onabort fires; oncomplete never does).
          try {
            tx.abort();
          } catch {
            // Already settling — ignore.
          }
          return req;
        };
        return store;
      };
    }
    return tx;
  } as IDBDatabase["transaction"];
}
installWriteAbortHook();

/**
 * TEST-ONLY: wrap navigator.locks.request so the REAL lock release (the held
 * callback promise resolving) is recorded in `lifecycleLog`. Harness-side only.
 */
function installLockReleaseObserver(): void {
  const locks = navigator.locks as unknown as {
    request: (
      name: string,
      options: unknown,
      callback: (lock: unknown) => Promise<void> | void,
    ) => Promise<unknown>;
  };
  const realRequest = locks.request.bind(locks);
  locks.request = (
    name: string,
    options: unknown,
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown> => {
    const wrapped = (lock: unknown): Promise<void> | void => {
      const result = callback(lock);
      if (lock !== null && result instanceof Promise) {
        return result.then(() => {
          lifecycleLog.push("lock:release");
        });
      }
      return result;
    };
    return realRequest(name, options, wrapped);
  };
}
installLockReleaseObserver();

export interface GhostSyncApi {
  readonly ready: true;
  open(handle: string, options: OpenOptions): Promise<unknown>;
  set(handle: string, key: string, value: string | number | boolean | null): unknown;
  get(handle: string, key: string): string | number | boolean | null | undefined;
  putIncident(handle: string, id: string, incident: Incident): unknown;
  getIncident(handle: string, id: string): Incident | undefined;
  listIncidentIds(handle: string): string[];
  listInvalidIncidentIds(handle: string): string[];
  putPartialIncident(handle: string, id: string, title: string): unknown;
  applyUpdate(handle: string, documentId: string, hexBytes: string, kind: "full" | "diff"): ApplyOutcome | ErrorInfo;
  flush(handle: string): Promise<unknown>;
  state(handle: string): SaveState | undefined;
  stateLog(handle: string): SaveState[];
  exportHex(handle: string): string | ErrorInfo;
  close(handle: string): Promise<unknown>;
  dispose(handle: string): Promise<unknown>;
  /** Build chained updates (first full + dependent diff) for routed-import tests. */
  buildChained(documentId: string): { first: string; second: string };
  /** Plant a raw record directly into IndexedDB (for corrupt/oversize tests). */
  plantRecord(dbName: string, record: Record<string, unknown>): Promise<unknown>;
  /** Read a stored record's bytes as hex (to assert byte-identical preservation). */
  readRecordHex(dbName: string, storageKey: string): Promise<string | null>;
  /**
   * TEST-ONLY (offline-assets): echo a short human-readable summary of restored
   * data into the #restored-data DOM node so an offline screenshot visibly shows
   * the recovered replica. Purely presentational; no persistence effect.
   */
  showRestored(text: string): void;
  /**
   * TEST-ONLY failure instrumentation (NOT part of the shipped package surface).
   * Arm a ONE-SHOT real IndexedDB abort: the NEXT readwrite transaction opened on
   * ANY connection aborts after its first write, exercising genuine transaction
   * recovery (a mid-transaction abort, not a pre-write maxBytes rejection). Auto-
   * disarms after firing. Returns a disarm function in case it never fires.
   */
  armWriteAbortOnce(): () => void;
  /**
   * TEST-ONLY (fix 4): capture a collection handle NOW (while the session is
   * open), then later probe each READ route through that SAME handle, returning
   * the PersistenceError code (or "ok") so a test can assert a typed ClosedError
   * after a terminal close — not a raw destroyed-doc throw.
   */
  captureIncidentCollection(handle: string): unknown;
  probeCapturedReads(handle: string): Record<string, string>;
  /** TEST-ONLY (fix 4): attempt subscribe() and report "ok" or the error code. */
  subscribeProbe(handle: string): string;
  /** TEST-ONLY (fix 3): attempt onStateChange() and report "ok" or error code. */
  onStateChangeProbe(handle: string): string;
  /**
   * TEST-ONLY (fix 2): the recorded lifecycle event order
   * (tx:abort / lock:release / dispose:resolve) across the instrumented dispose.
   */
  lifecycleLog(): string[];
  /** TEST-ONLY (fix 2): clear the lifecycle event log before a scenario. */
  resetLifecycleLog(): void;
  /** TEST-ONLY (fix 2): start a flush, then dispose, recording resolution order. */
  flushThenDisposeOrdered(handle: string): Promise<string[]>;
  /**
   * file-capsules: real Blob download of the session's full-state capsule via an
   * anchor click (a genuine browser download). Resolves the suggested filename.
   */
  downloadCapsule(handle: string): Promise<CapsuleDownloadView | ErrorInfo>;
  /**
   * file-capsules: import a user-picked File through the real session. The
   * File.size is checked against the configured raw limit BEFORE arrayBuffer().
   * The result is also rendered into the visible #capsule-result region.
   */
  importCapsuleFile(handle: string, file: File): Promise<CapsuleImportView>;
  /** TEST hook: capsule bytes as hex (same encode call as downloadCapsule). */
  exportCapsuleHex(handle: string): Promise<string | ErrorInfo>;
  /** TEST hook: import capsule bytes given as hex through the real session. */
  importCapsuleHex(handle: string, hex: string): Promise<CapsuleImportView>;
  /** TEST hook: configure the raw capsule size limit used by file import. */
  setCapsuleMaxBytes(maxBytes: number): void;
  /** TEST hook: object URLs created/revoked by downloadCapsule (real counters). */
  capsuleUrlStats(): { created: number; revoked: number };
}

interface CapsuleDownloadView {
  readonly ok: true;
  readonly filename: string;
  readonly size: number;
}

interface CapsuleErrorView {
  readonly code: string | undefined;
  readonly message: string;
}

/** Result of an import: what was applied and what was durably persisted. */
interface CapsuleImportView {
  readonly ok: boolean;
  readonly applied: boolean;
  readonly persisted: boolean | undefined;
  readonly saveError: CapsuleErrorView | undefined;
  readonly error: CapsuleErrorView | undefined;
  readonly recovery: string;
}

function session(handle: string): PersistSession {
  const s = sessions.get(handle);
  if (s === undefined) {
    throw new Error(`no session for handle "${handle}"`);
  }
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// file-capsules: harness-only glue between the BUILT @ghostsync/capsule and the
// real PersistSession. No sync/merge/persistence logic lives here.
// ---------------------------------------------------------------------------

let capsuleMaxBytes = DEFAULT_MAX_CAPSULE_BYTES;
let urlCreated = 0;
let urlRevoked = 0;

function errorView(err: unknown): CapsuleErrorView {
  if (isCapsuleError(err)) {
    return { code: err.code, message: err.message };
  }
  if (isPersistenceError(err)) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof TypeError) {
    return { code: "TypeError", message: err.message };
  }
  return { code: undefined, message: err instanceof Error ? err.message : String(err) };
}

function recoveryFor(applied: boolean, persisted: boolean | undefined, code: string | undefined): string {
  if (applied && persisted === true) {
    return "Import applied and saved.";
  }
  if (applied) {
    return `Applied in memory but NOT saved${code === undefined ? "" : ` (${code})`}. The data is readable; fix the cause and flush again to retry.`;
  }
  switch (code) {
    case "OversizedRaw":
    case "OversizedDecoded":
      return "Nothing was applied: the file is larger than the configured limit.";
    case "AppIdentityMismatch":
    case "DocumentIdentityMismatch":
      return "Nothing was applied: this capsule belongs to a different app or document.";
    case "TargetUnavailable":
      return "Nothing was applied: the session is closed. Reopen the document and try again.";
    case "CryptoUnavailable":
      return "Nothing was applied: this browser cannot verify the checksum.";
    default:
      return "Nothing was applied: the file is damaged or not a supported capsule. Export it again from the source.";
  }
}

function failedImport(err: unknown): CapsuleImportView {
  return failedView(errorView(err));
}

function failedView(error: CapsuleErrorView): CapsuleImportView {
  return {
    ok: false,
    applied: false,
    persisted: undefined,
    saveError: undefined,
    error,
    recovery: recoveryFor(false, undefined, error.code),
  };
}

/** Render a result into the visible #capsule-result region (live, keyboard-neutral). */
function renderCapsuleStatus(state: "working" | "done" | "error", text: string, view?: CapsuleImportView): void {
  const el = document.getElementById("capsule-result");
  if (el === null) {
    return;
  }
  el.textContent = text;
  el.dataset["state"] = state;
  el.dataset["applied"] = view === undefined ? "" : String(view.applied);
  el.dataset["persisted"] = view?.persisted === undefined ? "" : String(view.persisted);
  el.dataset["errorCode"] = view?.error?.code ?? view?.saveError?.code ?? "";
  el.className = state === "error" ? "failed" : state === "done" ? "ready" : "";
}

function renderImportView(view: CapsuleImportView): void {
  const parts = [`applied: ${view.applied}`];
  if (view.persisted !== undefined) {
    parts.push(`persisted: ${view.persisted}`);
  }
  if (view.error !== undefined) {
    parts.push(`error: ${view.error.code ?? "unknown"} — ${view.error.message}`);
  }
  if (view.saveError !== undefined) {
    parts.push(`save error: ${view.saveError.code ?? "unknown"} — ${view.saveError.message}`);
  }
  parts.push(view.recovery);
  const failed = !view.applied || view.persisted === false;
  renderCapsuleStatus(failed ? "error" : "done", parts.join(" | "), view);
}

/** Import capsule bytes through the REAL session; results come from the real call. */
async function importBytes(handle: string, bytes: Uint8Array): Promise<CapsuleImportView> {
  try {
    const target: PersistSession = session(handle);
    // Compile-time guard (AC-CAP-003-5): a real PersistSession IS a PersistTarget,
    // with no cast, no `any` and no wrapper. `pnpm -F @ghostsync/persist typecheck`
    // fails here if that ever stops being true.
    const asTarget: PersistTarget = target;
    void asTarget;
    const result = await importCapsuleIntoPersisted(target, bytes, { maxCapsuleBytes: capsuleMaxBytes });
    const saveError =
      result.saveError === undefined
        ? undefined
        : { code: result.saveError.code, message: result.saveError.message };
    return {
      ok: result.persisted,
      applied: true,
      persisted: result.persisted,
      saveError,
      error: undefined,
      recovery: recoveryFor(true, result.persisted, saveError?.code),
    };
  } catch (err) {
    return failedImport(err);
  }
}

async function exportCapsuleBytes(handle: string): Promise<Uint8Array> {
  const s = session(handle);
  return encodeCapsule({
    app: s.identity.app,
    documentId: s.identity.documentId,
    update: s.exportState(),
  });
}

const api: GhostSyncApi = {
  ready: true,
  async downloadCapsule(handle) {
    try {
      const s = session(handle);
      const bytes = await exportCapsuleBytes(handle);
      const safe = `${s.identity.documentId}-${s.identity.replicaId}`.replace(/[^A-Za-z0-9._-]/g, "_");
      const filename = `${safe}${CAPSULE_EXTENSION}`;
      // Copy into an ArrayBuffer-backed array: a valid BlobPart on every lib target.
      const blob = new Blob([new Uint8Array(bytes)], { type: CAPSULE_MEDIA_TYPE });
      const url = URL.createObjectURL(blob);
      urlCreated += 1;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Revoke once the browser has had a turn to start the download.
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urlRevoked += 1;
      }, 1000);
      renderCapsuleStatus("done", `downloaded ${filename} (${bytes.length} bytes)`);
      return { ok: true, filename, size: bytes.length };
    } catch (err) {
      const e = errorView(err);
      renderCapsuleStatus("error", `download failed: ${e.code ?? "unknown"} — ${e.message}`);
      return asError(err);
    }
  },
  async importCapsuleFile(handle, file) {
    renderCapsuleStatus("working", `importing ${file.name}…`);
    // Cheap bound FIRST: never read a file that is already over the raw limit.
    if (file.size > capsuleMaxBytes) {
      const view = failedView({
        code: "OversizedRaw",
        message: `file is ${file.size} bytes, over the ${capsuleMaxBytes}-byte limit`,
      });
      renderImportView(view);
      return view;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      const view = failedImport(err);
      renderImportView(view);
      return view;
    }
    const view = await importBytes(handle, bytes);
    renderImportView(view);
    return view;
  },
  async exportCapsuleHex(handle) {
    try {
      return toHex(await exportCapsuleBytes(handle));
    } catch (err) {
      return asError(err);
    }
  },
  async importCapsuleHex(handle, hex) {
    const view = await importBytes(handle, fromHex(hex));
    renderImportView(view);
    return view;
  },
  setCapsuleMaxBytes(maxBytes) {
    capsuleMaxBytes = maxBytes;
  },
  capsuleUrlStats() {
    return { created: urlCreated, revoked: urlRevoked };
  },
  async open(handle, options) {
    try {
      const s = await openReplica(options);
      sessions.set(handle, s);
      const log: SaveState[] = [];
      stateLog.set(handle, log);
      s.onStateChange((st) => log.push(st));
      return {
        ok: true,
        restored: s.restored,
        storageKey: s.storageKey,
        replicaId: s.identity.replicaId,
      };
    } catch (err) {
      return asError(err);
    }
  },
  set(handle, key, value) {
    try {
      session(handle).set(key, value);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  },
  get(handle, key) {
    return session(handle).get(key);
  },
  putIncident(handle, id, incident) {
    try {
      session(handle).collection(incidentAdapter).put(id, incident);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  },
  getIncident(handle, id) {
    return session(handle).collection(incidentAdapter).get(id);
  },
  listIncidentIds(handle) {
    return session(handle)
      .collection(incidentAdapter)
      .list()
      .map(([id]) => id);
  },
  listInvalidIncidentIds(handle) {
    return session(handle)
      .collection(incidentAdapter)
      .listResults()
      .filter(([, r]) => !r.ok && r.reason === "invalidRecord")
      .map(([id]) => id);
  },
  putPartialIncident(handle, id, title) {
    // A "writer" adapter that shares the incident schema identity but omits the
    // `priority` field, so the normal reader adapter cannot reconstruct a valid
    // Incident — it becomes an `invalidRecord` surfaced via listResults().
    const writer: EntityAdapter<{ id: string; title: string }> = {
      schema: { app: "fieldledger", schemaVersion: 1, entityType: "incident" },
      validate: () => undefined,
      toFields: (e) => ({ id: e.id, title: e.title }),
      fromFields: (f: Fields) => ({ id: String(f["id"]), title: String(f["title"]) }),
    };
    try {
      session(handle).collection(writer).put(id, { id, title });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  },
  applyUpdate(handle, documentId, hexBytes, kind) {
    try {
      return session(handle).applyUpdate({ documentId, kind, bytes: fromHex(hexBytes) });
    } catch (err) {
      return asError(err);
    }
  },
  async flush(handle) {
    try {
      await session(handle).flush();
      return { ok: true, state: session(handle).state };
    } catch (err) {
      return asError(err);
    }
  },
  state(handle) {
    return sessions.get(handle)?.state;
  },
  stateLog(handle) {
    return stateLog.get(handle) ?? [];
  },
  exportHex(handle) {
    try {
      return toHex(session(handle).exportBytes());
    } catch (err) {
      return asError(err);
    }
  },
  async close(handle) {
    try {
      await session(handle).close();
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  },
  async dispose(handle) {
    try {
      await session(handle).dispose();
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  },
  subscribeProbe(handle) {
    try {
      const unsub = session(handle).subscribe(() => undefined);
      unsub();
      return "ok";
    } catch (err) {
      return isPersistenceError(err) ? (err.code ?? "unknown") : "non-persistence-error";
    }
  },
  onStateChangeProbe(handle) {
    try {
      const unsub = session(handle).onStateChange(() => undefined);
      unsub();
      return "ok";
    } catch (err) {
      return isPersistenceError(err) ? (err.code ?? "unknown") : "non-persistence-error";
    }
  },
  lifecycleLog() {
    return [...lifecycleLog];
  },
  resetLifecycleLog() {
    lifecycleLog.length = 0;
  },
  async flushThenDisposeOrdered(handle) {
    const s = session(handle);
    // Start a flush we do NOT await so the write transaction is live; it will be
    // aborted by the armed one-shot hook.
    const flushing = s.flush().catch(() => undefined);
    // Wait for the terminal transaction abort to be recorded before disposing,
    // so dispose runs WHILE the write transaction is the session's active write.
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (lifecycleLog.includes("tx:abort")) {
          resolve();
          return;
        }
        setTimeout(check, 0);
      };
      check();
    });
    await s.dispose();
    lifecycleLog.push("dispose:resolve");
    await flushing;
    return [...lifecycleLog];
  },
  armWriteAbortOnce() {
    abortArmed = true;
    return () => {
      abortArmed = false;
    };
  },
  captureIncidentCollection(handle) {
    const col = session(handle).collection(incidentAdapter);
    capturedCollections.set(handle, col);
    return { ok: true };
  },
  probeCapturedReads(handle) {
    const col = capturedCollections.get(handle);
    if (col === undefined) {
      return { error: "no-captured-collection" };
    }
    const probe = (fn: () => unknown): string => {
      try {
        fn();
        return "ok";
      } catch (err) {
        return isPersistenceError(err) ? (err.code ?? "unknown") : "non-persistence-error";
      }
    };
    return {
      get: probe(() => col.get("i1")),
      getResult: probe(() => col.getResult("i1")),
      list: probe(() => col.list()),
      listResults: probe(() => col.listResults()),
      has: probe(() => col.has("i1")),
    };
  },
  buildChained(documentId) {
    // Build a dependent (out-of-order) update via the PUBLIC Kit API: write "a",
    // snapshot the state vector, write "b"; the "b" diff depends on the "a"
    // update, so applying it alone is accepted as PENDING (ok, no observable
    // change). `first` is the full-state carrying "a".
    const source = createKit().createReplica(documentId);
    source.set("a", 1);
    const svAfterA = source.exportStateVector();
    const first = toHex(source.exportState().bytes);
    source.set("b", 2);
    const secondDiff = source.exportDiff(svAfterA);
    source.destroy();
    if (!secondDiff.ok) {
      throw new Error("failed to build chained update");
    }
    return { first, second: toHex(secondDiff.update.bytes) };
  },
  async plantRecord(dbName, record) {
    await planter(dbName, "put", record);
    return { ok: true };
  },
  async readRecordHex(dbName, storageKey) {
    const value = (await planter(dbName, "get", storageKey)) as
      | { bytes?: Uint8Array }
      | undefined;
    if (value === undefined || !(value.bytes instanceof Uint8Array)) {
      return null;
    }
    return toHex(value.bytes);
  },
  showRestored(text) {
    const el = document.getElementById("restored-data");
    if (el !== null) {
      el.textContent = `restored-data: ${text}`;
      el.className = "ready";
    }
  },
};

/** Minimal direct IndexedDB access for planting / reading raw records in tests. */
function planter(dbName: string, op: "put" | "get", payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("replicas")) {
        db.createObjectStore("replicas", { keyPath: "storageKey" });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("replicas", op === "put" ? "readwrite" : "readonly");
      const store = tx.objectStore("replicas");
      let result: unknown;
      const r = op === "put" ? store.put(payload) : store.get(payload as string);
      r.onsuccess = () => {
        result = op === "get" ? r.result : undefined;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

declare global {
  interface Window {
    __gs: GhostSyncApi;
  }
}

window.__gs = api;

/** Wire the visible, keyboard-reachable capsule controls to the same API the tests drive. */
function wireCapsuleControls(): void {
  const handleField = document.getElementById("capsule-handle");
  const download = document.getElementById("capsule-download");
  const picker = document.getElementById("capsule-file");
  if (!(handleField instanceof HTMLInputElement) || !(picker instanceof HTMLInputElement)) {
    return;
  }
  const currentHandle = (): string => (handleField.value.length > 0 ? handleField.value : "s");
  if (download instanceof HTMLButtonElement) {
    download.addEventListener("click", () => {
      void api.downloadCapsule(currentHandle());
    });
  }
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      return;
    }
    void api.importCapsuleFile(currentHandle(), file).finally(() => {
      // Allow picking the same file again.
      picker.value = "";
    });
  });
}
wireCapsuleControls();

const status = document.getElementById("status");
if (status !== null) {
  status.textContent = "ready — window.__gs installed";
  status.className = "ready";
}

// offline-assets milestone: register the Service Worker + drive observable
// offline-readiness on window.__gsOffline. This is independent of window.__gs
// (the existing persistence surface) and does not alter CRDT/persistence logic.
initOfflineReadiness();
