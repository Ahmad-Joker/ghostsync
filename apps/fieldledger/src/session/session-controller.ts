import { decodeCapsule, DEFAULT_MAX_CAPSULE_BYTES, encodeCapsule, importCapsuleIntoPersisted, isCapsuleError } from "@ghostsync/capsule";
import type { CapsuleErrorCode, CapsuleMetadata } from "@ghostsync/capsule";
import { isPersistenceError, openReplica } from "@ghostsync/persist";
import type { GuardedCollection, PersistSession, SaveState, SaveStateInfo } from "@ghostsync/persist";
import { APP_ID, DB_NAME, LAST_DOCUMENT_KEY, MAX_BYTES } from "../config.js";
import { formatRoute, parseRoute, validateDocumentId } from "../identity/document-id.js";
import { getOrCreateReplicaId } from "../identity/replica-id.js";
import { checklistItemAdapter, incidentAdapter, type ChecklistItem, type IncidentDetails } from "../model/adapters.js";
import { diffModels, type ModelDiff } from "../model/diff.js";
import { newItemId } from "../model/ids.js";
import { readModel, type Model } from "../model/read-model.js";
import {
  addItem,
  commitIncidentField,
  commitItemField,
  createIncident,
  discardItem,
  moveItem,
  restoreIncident,
  restoreItem,
} from "../model/write.js";
import {
  isSchemaMismatch,
  mapCapsuleError,
  mapEditError,
  type EditErrorInfo,
  mapPersistError,
  SCHEMA_MISMATCH_MESSAGE,
  UNEXPECTED_ERROR,
} from "../state/errors.js";
import { capsuleFilename } from "../transfer/filename.js";

export type Phase = "join" | "in-use" | "error" | "ready" | "recovery";

export interface ImportView {
  readonly state: "importing" | "applied-saved" | "applied-unsaved" | "rejected";
  readonly code?: string;
  readonly message: string;
  readonly diff?: ModelDiff;
  /** Metadata of the applied capsule (AC-FL-013-7). Absent while importing and for rejected results. */
  readonly metadata?: CapsuleMetadata;
  /** True when the post-import re-read failed: the workspace shows its LAST READABLE data and no diff is given. */
  readonly workspaceStale?: true;
}

export interface SaveView {
  readonly state: SaveState;
  readonly info: SaveStateInfo;
}

/** Session ownership, save state and import/export flow. The ONLY module that holds the session. */
export class SessionController {
  phase: Phase = "join";
  documentId: string | undefined;
  replicaId: string | undefined;
  restored = false;
  model: Model | undefined;
  save: SaveView = { state: "saved", info: { sequence: 0 } };
  importView: ImportView | undefined;
  errorMessage = "";
  errorAllowsRetry = false;
  /** Last failed edit in the ready workspace (REQ-FL-009 edit-error visibility). Separate from save and import state. */
  editError: EditErrorInfo | undefined;
  joinMessage = "";
  recoveryMessage = "";
  busy = false;

  private session: PersistSession | undefined;
  private incidents: GuardedCollection<IncidentDetails> | undefined;
  private items: GuardedCollection<ChecklistItem> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly notify: () => void,
    private readonly announce: (text: string) => void,
  ) {}

  /** Resolve the document from the route, then the remembered one; otherwise show the join form. */
  async start(hash: string): Promise<void> {
    let id = parseRoute(hash);
    if (id === undefined) {
      try {
        const remembered = this.storage.getItem(LAST_DOCUMENT_KEY);
        if (remembered !== null) {
          const v = validateDocumentId(remembered);
          if (v.ok) id = v.documentId;
        }
      } catch {
        /* storage failure is reported when opening */
      }
    }
    if (id === undefined) {
      this.phase = "join";
      this.notify();
      return;
    }
    await this.open(id);
  }

  async open(raw: string): Promise<boolean> {
    if (this.busy) return false;
    const v = validateDocumentId(raw);
    if (!v.ok) {
      this.joinMessage = v.message;
      this.phase = "join";
      this.notify();
      return false;
    }
    this.busy = true;
    try {
      this.joinMessage = "";
      this.documentId = v.documentId;
      let replicaId: string;
      try {
        replicaId = getOrCreateReplicaId(this.storage, v.documentId, () => crypto.randomUUID());
      } catch {
        return this.fail(
          "This browser blocks local storage, so FieldLedger cannot keep a stable device identity. Allow site storage, then reload.",
          false,
        );
      }
      this.replicaId = replicaId;
      let session: PersistSession;
      try {
        session = await openReplica({
          app: APP_ID,
          documentId: v.documentId,
          replicaId,
          dbName: DB_NAME,
          maxBytes: MAX_BYTES,
          onStateChange: (state, info) => this.onSaveState(state, info),
        });
      } catch (err) {
        const code = isPersistenceError(err) ? err.code : "Unknown";
        const mapped = mapPersistError(code);
        this.phase = code === "StorageInUseError" ? "in-use" : "error";
        this.errorMessage = mapped.message;
        this.errorAllowsRetry = mapped.actions.includes("Try again");
        this.notify();
        return false;
      }
      try {
        this.incidents = session.collection(incidentAdapter);
        this.items = session.collection(checklistItemAdapter);
        this.model = readModel(this.incidents, this.items);
      } catch (err) {
        await session.dispose().catch(() => undefined);
        return this.fail(isSchemaMismatch(err) ? SCHEMA_MISMATCH_MESSAGE : UNEXPECTED_ERROR, false);
      }
      this.session = session;
      this.restored = session.restored;
      this.save = { state: session.state, info: this.save.info };
      this.unsubscribe = session.subscribe(() => this.refresh());
      try {
        this.storage.setItem(LAST_DOCUMENT_KEY, v.documentId);
      } catch {
        /* remembering the document is optional */
      }
      history.replaceState(null, "", formatRoute(v.documentId));
      this.importView = undefined;
      this.editError = undefined;
      this.phase = "ready";
      this.notify();
      return true;
    } finally {
      this.busy = false;
    }
  }

  private fail(message: string, retry: boolean): false {
    this.phase = "error";
    this.errorMessage = message;
    this.errorAllowsRetry = retry;
    this.notify();
    return false;
  }

  private onSaveState(state: SaveState, info: SaveStateInfo): void {
    const prev = this.save.state;
    this.save = { state, info };
    if (state === "saved" && this.importView?.state === "applied-unsaved") {
      this.importView = {
        ...this.importView,
        state: "applied-saved",
        message: "Saved locally. The imported changes are now stored on this device.",
      };
    }
    if (state !== prev) {
      if (state === "saved" && info.sequence > 0) this.announce("Saved locally");
      else if (state === "error") this.announce("Changes are NOT saved to this device");
    }
    this.notify();
  }

  /**
   * Re-read the model from listResults(). If the read throws (for example a schema mismatch brought in by a remote
   * change, which makes every collection operation throw), the LAST SUCCESSFULLY READ model is kept: no phase change,
   * no thrown exception. Returns whether the read succeeded. Schema problems at OPEN are handled in open().
   */
  refresh(): boolean {
    if (this.incidents === undefined || this.items === undefined) return false;
    let ok = true;
    try {
      this.model = readModel(this.incidents, this.items);
    } catch {
      ok = false;
    }
    this.notify();
    return ok;
  }

  // ---- edits (each reads CURRENT state and writes only the changed field) ----
  private guard(fn: () => void): void {
    if (this.phase !== "ready") return;
    try {
      fn();
    } catch (err) {
      // A failed edit stays in the ready workspace: phase, save state and the last good model are untouched.
      // No re-read: a rejected put validates before it mutates, and on a schema mismatch every collection
      // operation (including listResults) would throw the same error.
      this.editError = mapEditError(isSchemaMismatch(err) ? "schema-mismatch" : "unexpected");
      this.notify();
      return;
    }
    this.editError = undefined;
    this.refresh();
  }

  /** Clear the edit error (explicit Dismiss). */
  dismissEditError(): void {
    if (this.editError === undefined) return;
    this.editError = undefined;
    this.notify();
  }

  createIncidentDetails(title: string): void {
    this.guard(() => {
      if (this.incidents !== undefined) createIncident(this.incidents, title);
    });
  }
  setIncidentField<K extends keyof IncidentDetails>(field: K, value: IncidentDetails[K]): void {
    this.guard(() => {
      if (this.incidents !== undefined) commitIncidentField(this.incidents, field, value);
    });
  }
  addChecklistItem(text: string): void {
    this.guard(() => {
      if (this.items !== undefined && this.replicaId !== undefined) {
        addItem(this.items, newItemId(() => crypto.randomUUID()), text, this.replicaId, Date.now());
      }
    });
  }
  setItemField<K extends keyof ChecklistItem>(id: string, field: K, value: ChecklistItem[K]): void {
    this.guard(() => {
      if (this.items !== undefined) commitItemField(this.items, id, field, value);
    });
  }
  move(id: string, delta: -1 | 1): void {
    this.guard(() => {
      if (this.items !== undefined) moveItem(this.items, id, delta);
    });
  }
  deleteItem(id: string): void {
    this.guard(() => {
      if (this.items !== undefined) discardItem(this.items, id);
    });
  }
  restoreInvalidItem(id: string): void {
    const row = this.model?.invalid.find((r) => r.id === id);
    this.guard(() => {
      if (this.items !== undefined && row !== undefined && this.replicaId !== undefined) {
        restoreItem(this.items, id, row.fields, this.replicaId, Date.now());
      }
    });
  }
  restoreInvalidIncident(): void {
    const inc = this.model?.incident;
    this.guard(() => {
      if (this.incidents !== undefined && inc?.kind === "invalid") restoreIncident(this.incidents, inc.fields);
    });
  }
  discardInvalidIncident(): void {
    this.guard(() => {
      if (this.incidents !== undefined) this.incidents.delete("incident");
    });
  }

  // ---- save control ----
  async retrySave(): Promise<void> {
    const s = this.session;
    if (s === undefined) return;
    try {
      await s.flush();
    } catch {
      /* state stays `error`; the alert remains */
    }
  }

  // ---- transfer ----
  async buildCapsule(kind: "export" | "backup"): Promise<{ bytes: Uint8Array; filename: string } | undefined> {
    const s = this.session;
    if (s === undefined) return undefined;
    const bytes = await encodeCapsule({
      app: s.identity.app,
      documentId: s.identity.documentId,
      update: s.exportState(),
    });
    return { bytes, filename: capsuleFilename(s.identity.documentId, s.identity.replicaId, new Date(), kind) };
  }

  async importFile(file: File): Promise<void> {
    const s = this.session;
    if (s === undefined || this.documentId === undefined) return;
    const documentId = this.documentId;
    this.importView = { state: "importing", message: "Importing capsule..." };
    this.notify();
    const reject = (code: CapsuleErrorCode | "TypeError" | "ReadFailed", meta?: { app?: string; documentId?: string }): void => {
      this.importView = { state: "rejected", code, message: mapCapsuleError(code, { documentId }, meta) };
      this.notify();
    };
    if (file.size > DEFAULT_MAX_CAPSULE_BYTES) {
      reject("OversizedRaw");
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      reject("ReadFailed");
      return;
    }
    const before = this.model;
    try {
      const r = await importCapsuleIntoPersisted(s, bytes);
      const readable = this.refresh();
      const after = this.model;
      // A failed re-read keeps the last good model, so a diff would be empty and misleading: suppress it.
      const diff = readable && before !== undefined && after !== undefined ? diffModels(before, after) : undefined;
      const stale = readable ? {} : { workspaceStale: true as const };
      if (r.persisted) {
        this.importView = {
          state: "applied-saved",
          message: "Capsule applied and saved locally.",
          metadata: r.metadata,
          ...(diff !== undefined ? { diff } : {}),
          ...stale,
        };
      } else {
        this.importView = {
          state: "applied-unsaved",
          code: r.saveError?.code ?? "Unknown",
          message: "Capsule applied, but NOT saved to this device",
          metadata: r.metadata,
          ...(diff !== undefined ? { diff } : {}),
          ...stale,
        };
      }
      this.notify();
    } catch (err) {
      if (isCapsuleError(err)) {
        let meta: { app?: string; documentId?: string } | undefined;
        if (err.code === "DocumentIdentityMismatch" || err.code === "AppIdentityMismatch") {
          try {
            const d = await decodeCapsule(bytes);
            meta = { app: d.metadata.app, documentId: d.metadata.documentId };
          } catch {
            meta = undefined;
          }
        }
        reject(err.code, meta);
      } else {
        reject("TypeError");
      }
    }
  }

  /** Settle pending edits: flush. Returns false (and keeps the error alert) if saving fails. */
  async settle(): Promise<boolean> {
    const s = this.session;
    if (s === undefined) return true;
    try {
      await s.flush();
      return true;
    } catch {
      return false;
    }
  }

  /** Leave an error screen for the join form, releasing any session still held. */
  openJoin(): void {
    const s = this.session;
    this.dropSession();
    if (s !== undefined) void s.dispose().catch(() => undefined);
    this.documentId = undefined;
    this.phase = "join";
    this.notify();
  }

  // ---- leaving ----
  /** Settle pending edits (close flushes), release the lock. A failed close keeps a recovery-only session. */
  async changeIncident(): Promise<void> {
    const s = this.session;
    if (s === undefined || this.busy) return;
    this.busy = true;
    try {
      await s.close();
      this.dropSession();
      this.toJoin();
    } catch (err) {
      if (isPersistenceError(err, "CloseFailedError")) {
        this.phase = "recovery";
        this.recoveryMessage =
          "Could not save before closing. Your changes are still shown below but are NOT saved to this device. Download a backup capsule, or discard the unsaved changes and switch.";
        try {
          this.model = this.incidents !== undefined && this.items !== undefined ? readModel(this.incidents, this.items) : this.model;
        } catch {
          /* keep last model */
        }
        this.notify();
      } else {
        this.dropSession();
        this.fail(UNEXPECTED_ERROR, false);
      }
    } finally {
      this.busy = false;
    }
  }

  async discardAndSwitch(): Promise<void> {
    const s = this.session;
    if (s === undefined) return;
    try {
      await s.dispose();
    } catch {
      /* the session is dropped either way */
    }
    this.dropSession();
    this.toJoin();
  }

  private dropSession(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session = undefined;
    this.incidents = undefined;
    this.items = undefined;
    this.model = undefined;
  }

  private toJoin(): void {
    try {
      this.storage.removeItem(LAST_DOCUMENT_KEY);
    } catch {
      /* ignore */
    }
    history.replaceState(null, "", location.pathname + location.search);
    this.documentId = undefined;
    this.importView = undefined;
    this.editError = undefined;
    this.save = { state: "saved", info: { sequence: 0 } };
    this.phase = "join";
    this.notify();
  }

  /** Best-effort: commit a focused draft on page hide. Durability is only claimed after Persist confirms. */
  onPageHide(): void {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  }
}
