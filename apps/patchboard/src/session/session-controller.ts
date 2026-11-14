import {
  decodeCapsule,
  DEFAULT_MAX_CAPSULE_BYTES,
  encodeCapsule,
  importCapsuleIntoPersisted,
  isCapsuleError,
} from "@ghostsync/capsule";
import type { CapsuleErrorCode, CapsuleMetadata } from "@ghostsync/capsule";
import { isPersistenceError, openReplica } from "@ghostsync/persist";
import type { GuardedCollection, PersistSession, SaveState, SaveStateInfo } from "@ghostsync/persist";
import { APP_ID, DB_NAME, LAST_BOARD_KEY, MAX_BYTES } from "../config.js";
import { formatRoute, parseRoute, validateBoardId } from "../identity/board-id.js";
import { getOrCreateReplicaId } from "../identity/replica-id.js";
import { cardAdapter, type Card } from "../model/adapters.js";
import { diffBoards } from "../model/diff.js";
import { newCardId } from "../model/ids.js";
import type { ColumnId } from "../model/placement.js";
import { nextPosition } from "../model/position.js";
import { readBoard, type Model } from "../model/read-model.js";
import {
  addCard,
  commitCardFields,
  deleteCard,
  moveCard,
  reorderCard,
  restoreCard,
  type WriteOutcome,
} from "../model/write.js";
import {
  isSchemaMismatch,
  mapCapsuleError,
  mapEditError,
  mapPersistError,
  SCHEMA_MISMATCH_MESSAGE,
  UNEXPECTED_ERROR,
  type EditErrorInfo,
} from "../state/errors.js";
import { capsuleFilename } from "../transfer/filename.js";
import { announceAdd, announceDelete, announceMove, announceReorder } from "../ui/announce.js";

export type Phase = "join" | "in-use" | "error" | "ready" | "recovery";

export interface ImportView {
  readonly state: "importing" | "applied-saved" | "applied-unsaved" | "rejected";
  readonly code?: string;
  readonly message: string;
  /** Change lines from the before and after boards. Absent while importing, on rejection and when the re-read failed. */
  readonly diff?: ReadonlyArray<string>;
  readonly metadata?: CapsuleMetadata;
  /** True when the post-import re-read failed: the workspace shows its LAST READABLE data and no diff is given. */
  readonly workspaceStale?: true;
}

export interface SaveView {
  readonly state: SaveState;
  readonly info: SaveStateInfo;
}

/** What the view should focus after the next render. Consumed once. */
export type FocusRequest =
  | { readonly kind: "card"; readonly cardId: string; readonly action?: string }
  | { readonly kind: "column"; readonly column: ColumnId }
  | { readonly kind: "invalid-heading" };

export interface SessionDeps {
  readonly openReplica: typeof openReplica;
}

export const NOT_APPLIED_NOTICE = "That card was changed or removed elsewhere and cannot be edited now. Nothing was written.";

/** Session ownership, save state and import/export flow. The ONLY module that holds the session. */
export class SessionController {
  phase: Phase = "join";
  boardId: string | undefined;
  replicaId: string | undefined;
  restored = false;
  model: Model | undefined;
  /** +1 after every successful read of the board. Rendered as data-board-revision. */
  revision = 0;
  save: SaveView = { state: "saved", info: { sequence: 0 } };
  importView: ImportView | undefined;
  errorMessage = "";
  errorAllowsRetry = false;
  editError: EditErrorInfo | undefined;
  /** Shown when an action found its card absent or incomplete and wrote nothing. */
  notice: string | undefined;
  joinMessage = "";
  recoveryMessage = "";
  busy = false;
  focusRequest: FocusRequest | undefined;

  /** Bumped whenever the session is replaced or dropped. An import captures it at start and is discarded if it changed. */
  private generation = 0;
  private session: PersistSession | undefined;
  private cards: GuardedCollection<Card> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly notify: () => void,
    private readonly announce: (text: string, channel?: "save") => void,
    private readonly deps: SessionDeps = { openReplica },
  ) {}

  /** Resolve the board from the route, then the remembered one; otherwise show the join form. */
  async start(hash: string): Promise<void> {
    let id = parseRoute(hash);
    if (id === undefined) {
      try {
        const remembered = this.storage.getItem(LAST_BOARD_KEY);
        if (remembered !== null) {
          const v = validateBoardId(remembered);
          if (v.ok) id = v.boardId;
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
    const v = validateBoardId(raw);
    if (!v.ok) {
      this.joinMessage = v.message;
      this.phase = "join";
      this.notify();
      return false;
    }
    this.busy = true;
    try {
      this.joinMessage = "";
      this.boardId = v.boardId;
      let replicaId: string;
      try {
        replicaId = getOrCreateReplicaId(this.storage, v.boardId, () => crypto.randomUUID());
      } catch {
        return this.fail(
          "This browser blocks local storage, so PatchBoard cannot keep a stable device identity. Allow site storage, then reload.",
          false,
        );
      }
      this.replicaId = replicaId;
      let session: PersistSession;
      try {
        session = await this.deps.openReplica({
          app: APP_ID,
          documentId: v.boardId,
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
        this.cards = session.collection(cardAdapter);
        this.model = readBoard(this.cards);
        this.revision += 1;
      } catch (err) {
        await session.dispose().catch(() => undefined);
        this.cards = undefined;
        return this.fail(isSchemaMismatch(err) ? SCHEMA_MISMATCH_MESSAGE : UNEXPECTED_ERROR, false);
      }
      this.generation += 1;
      this.session = session;
      this.restored = session.restored;
      this.save = { state: session.state, info: this.save.info };
      this.unsubscribe = session.subscribe(() => this.refresh());
      try {
        this.storage.setItem(LAST_BOARD_KEY, v.boardId);
      } catch {
        /* remembering the board is optional */
      }
      history.replaceState(null, "", formatRoute(v.boardId));
      this.importView = undefined;
      this.editError = undefined;
      this.notice = undefined;
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
      if (state === "saved" && info.sequence > 0) this.announce("Saved locally", "save");
      else if (state === "error") this.announce("Changes are NOT saved to this device", "save");
    }
    this.notify();
  }

  /**
   * Re-read the board with listResults(). If the read throws, the LAST SUCCESSFULLY READ model is kept and
   * `revision` does not change. Returns whether the read succeeded.
   */
  refresh(): boolean {
    if (this.cards === undefined) return false;
    let ok = true;
    try {
      this.model = readBoard(this.cards);
      this.revision += 1;
    } catch {
      ok = false;
    }
    this.notify();
    return ok;
  }

  // ---- edits: each takes a card ID, reads the CURRENT stored card and writes only what changed ----
  private guard(fn: () => WriteOutcome | void): boolean {
    if (this.phase !== "ready") return false;
    let outcome: WriteOutcome | void;
    try {
      outcome = fn();
    } catch (err) {
      // No re-read: a rejected put validates before it mutates, and on a schema mismatch every collection
      // operation (including listResults) would throw the same error, so the last good model is kept.
      this.editError = mapEditError(isSchemaMismatch(err) ? "schema-mismatch" : "unexpected");
      this.notify();
      return false;
    }
    this.editError = undefined;
    if (outcome === "absent" || outcome === "invalid") {
      this.notice = NOT_APPLIED_NOTICE;
      this.refresh();
      return false;
    }
    this.notice = undefined;
    this.refresh();
    return outcome !== "noop";
  }

  dismissEditError(): void {
    if (this.editError === undefined) return;
    this.editError = undefined;
    this.notify();
  }

  dismissNotice(): void {
    if (this.notice === undefined) return;
    this.notice = undefined;
    this.notify();
  }

  private locate(id: string): { column: ColumnId; index: number; total: number; title: string } | undefined {
    const m = this.model;
    if (m === undefined) return undefined;
    for (const column of ["todo", "doing", "done"] as const) {
      const list = m.columns[column];
      const index = list.findIndex((p) => p.id === id);
      const p = list[index];
      if (p !== undefined) return { column, index, total: list.length, title: p.card.title };
    }
    return undefined;
  }

  addCard(title: string, notes: string): void {
    const id = newCardId(() => crypto.randomUUID());
    const ok = this.guard(() => {
      if (this.cards === undefined) return;
      return addCard(this.cards, id, title, notes);
    });
    if (!ok) return;
    const at = this.locate(id);
    if (at !== undefined) {
      this.focusRequest = { kind: "card", cardId: id };
      this.announce(announceAdd(at.title, at.column, at.index + 1, at.total));
      this.notify();
    }
  }

  saveCard(id: string, changes: { title?: string; notes?: string }): void {
    this.guard(() => {
      if (this.cards === undefined) return;
      return commitCardFields(this.cards, id, changes);
    });
  }

  move(id: string, column: ColumnId): void {
    const ok = this.guard(() => {
      if (this.cards === undefined) return;
      return moveCard(this.cards, id, column);
    });
    if (!ok) return;
    const at = this.locate(id);
    if (at === undefined) return;
    this.focusRequest = { kind: "card", cardId: id, action: `move-${column}` };
    this.announce(announceMove(at.title, at.column, at.index + 1, at.total));
    this.notify();
  }

  reorder(id: string, delta: -1 | 1): void {
    const ok = this.guard(() => {
      if (this.cards === undefined) return;
      return reorderCard(this.cards, id, delta);
    });
    if (!ok) return;
    const at = this.locate(id);
    if (at === undefined) return;
    this.focusRequest = { kind: "card", cardId: id, action: delta === -1 ? "up" : "down" };
    this.announce(announceReorder(at.title, delta === -1 ? "up" : "down", at.column, at.index + 1, at.total));
    this.notify();
  }

  deleteCard(id: string): void {
    const before = this.locate(id);
    const ok = this.guard(() => {
      if (this.cards === undefined) return;
      deleteCard(this.cards, id);
      return "ok";
    });
    if (!ok || before === undefined) return;
    this.focusRequest = { kind: "column", column: before.column };
    this.announce(announceDelete(before.title));
    this.notify();
  }

  restoreInvalid(id: string): void {
    const ok = this.guard(() => {
      const cards = this.cards;
      if (cards === undefined) return;
      return restoreCard(cards, id, () => nextPosition(readBoard(cards).columns.todo.map((p) => p.position)));
    });
    if (!ok) return;
    this.focusRequest = { kind: "card", cardId: id };
    this.notify();
  }

  discardInvalid(id: string): void {
    const ok = this.guard(() => {
      if (this.cards === undefined) return;
      deleteCard(this.cards, id);
      return "ok";
    });
    if (!ok) return;
    this.focusRequest = { kind: "invalid-heading" };
    this.notify();
  }

  takeFocusRequest(): FocusRequest | undefined {
    const r = this.focusRequest;
    this.focusRequest = undefined;
    return r;
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
    if (s === undefined || this.boardId === undefined) return;
    if (this.importView?.state === "importing") return;
    const boardId = this.boardId;
    const gen = this.generation;
    const stale = (): boolean => this.generation !== gen || this.session !== s;
    this.importView = { state: "importing", message: "Importing capsule..." };
    this.notify();
    const reject = (
      code: CapsuleErrorCode | "TypeError" | "ReadFailed",
      meta?: { app?: string; documentId?: string },
    ): void => {
      if (stale()) return;
      this.importView = { state: "rejected", code, message: mapCapsuleError(code, { documentId: boardId }, meta) };
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
    if (stale()) return;
    const before = this.model;
    try {
      const r = await importCapsuleIntoPersisted(s, bytes);
      if (stale()) return;
      const readable = this.refresh();
      const after = this.model;
      // A failed re-read keeps the last good model, so a diff would be empty and misleading: suppress it.
      const diff = readable && before !== undefined && after !== undefined ? diffBoards(before, after) : undefined;
      const staleFlag = readable ? {} : { workspaceStale: true as const };
      if (r.persisted) {
        this.importView = {
          state: "applied-saved",
          message: "Capsule applied and saved locally.",
          metadata: r.metadata,
          ...(diff !== undefined ? { diff } : {}),
          ...staleFlag,
        };
      } else {
        this.importView = {
          state: "applied-unsaved",
          code: r.saveError?.code ?? "Unknown",
          message: "Capsule applied, but NOT saved to this device",
          metadata: r.metadata,
          ...(diff !== undefined ? { diff } : {}),
          ...staleFlag,
        };
      }
      this.notify();
    } catch (err) {
      if (stale()) return;
      if (isCapsuleError(err)) {
        let meta: { app?: string; documentId?: string } | undefined;
        if (err.code === "DocumentIdentityMismatch" || err.code === "AppIdentityMismatch") {
          try {
            const d = await decodeCapsule(bytes);
            meta = { app: d.metadata.app, documentId: d.metadata.documentId };
          } catch {
            meta = undefined;
          }
          if (stale()) return;
        }
        reject(err.code, meta);
      } else {
        reject("TypeError");
      }
    }
  }

  /** True while a capsule import is running. Change board and Update now refuse to run meanwhile. */
  get importPending(): boolean {
    return this.importView?.state === "importing";
  }

  /** Update now: settle pending edits, then run `apply` only if the flush succeeded. Refused while an import is pending. */
  async requestUpdate(apply: () => void): Promise<boolean> {
    if (this.importPending) return false;
    const ok = await this.settle();
    if (ok && !this.importPending) apply();
    return ok;
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
    this.boardId = undefined;
    this.phase = "join";
    this.notify();
  }

  // ---- leaving ----
  /** Settle pending edits (close flushes), release the lock. A failed close keeps a recovery-only session. */
  async changeBoard(): Promise<void> {
    const s = this.session;
    if (s === undefined || this.busy || this.importPending) return;
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
    this.generation += 1;
    if (this.importView?.state === "importing") this.importView = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session = undefined;
    this.cards = undefined;
    this.model = undefined;
  }

  private toJoin(): void {
    try {
      this.storage.removeItem(LAST_BOARD_KEY);
    } catch {
      /* ignore */
    }
    history.replaceState(null, "", location.pathname + location.search);
    this.boardId = undefined;
    this.importView = undefined;
    this.editError = undefined;
    this.notice = undefined;
    this.save = { state: "saved", info: { sequence: 0 } };
    this.phase = "join";
    this.notify();
  }
}
