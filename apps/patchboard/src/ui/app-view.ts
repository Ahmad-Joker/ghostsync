import { BOARD_ID_RULES, previewBoardId } from "../identity/board-id.js";
import { LIMITS } from "../model/adapters.js";
import { COLUMNS, COLUMN_LABEL, type ColumnId } from "../model/placement.js";
import { FIRST_VISIT_NOTICE, offlineCopy, showFirstVisitNotice } from "../offline/status-copy.js";
import type { OfflineHandle, OfflineSnapshot } from "../offline/sw-register.js";
import type { SessionController } from "../session/session-controller.js";
import { LOSS_WARNING, mapSaveError } from "../state/errors.js";
import { saveLabel } from "../state/save-label.js";
import { metaLines } from "../transfer/capsule-meta.js";
import { downloadBytes } from "../transfer/export.js";
import { CardRow, IncompleteRow } from "./card-row.js";
import { clear, h } from "./h.js";

const STALE_WORKSPACE_NOTICE =
  "The board could not be re-read after this import, so it is showing its last readable data. Reload the app, or download a backup capsule first.";
const MERGE_HELP =
  "If two people change the same field of a card while offline, one of the two values is kept after you exchange files. Which one is not decided by clock time. Changes to different fields of a card, or to different cards, are both kept.";

/** DOM views. Reads state from the controller; never owns session state. */
export class AppView {
  private offline: OfflineSnapshot = { state: "registering", ready: false };
  private shownKey = "";
  private offlineHandle: OfflineHandle | undefined;
  private readonly status: HTMLElement;
  private readonly offlineEl = h("p", { "data-testid": "offline-indicator" });
  private readonly networkEl = h("span", { "data-testid": "network-chip" });
  private readonly noticeEl = h("p", { "data-testid": "first-visit-notice" });
  private readonly bannerEl = h("div", { "data-testid": "update-banner", hidden: true });
  private readonly updateBtn: HTMLButtonElement = h("button", { type: "button", onclick: () => void this.updateNow() }, "Update now");
  private readonly announcer = h("div", { "data-testid": "announcer", role: "status", "aria-live": "polite", "aria-atomic": "true", class: "sr-only" });
  private readonly saveAnnouncer = h("div", { "data-testid": "save-announcer", role: "status", "aria-live": "polite", "aria-atomic": "true", class: "sr-only" });
  private readonly view = h("div", { id: "view" });
  private ws: Workspace | undefined;
  private joinInput: HTMLInputElement | undefined;
  private joinPreview: HTMLElement | undefined;
  private joinError: HTMLElement | undefined;
  private guardInstalled = false;

  constructor(private readonly root: HTMLElement, private readonly c: SessionController) {
    this.status = h(
      "section",
      { class: "status", "aria-label": "Device status" },
      this.networkEl,
      h("span", { "data-testid": "transfer-mode" }, "Transfer: file (.gscap)"),
      this.offlineEl,
      this.noticeEl,
      this.bannerEl,
    );
    this.root.append(h("h1", {}, "PatchBoard"), this.status, this.announcer, this.saveAnnouncer, this.view);
    const net = (): void => {
      this.networkEl.textContent = navigator.onLine ? "Network: online" : "Network: offline";
    };
    net();
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    this.renderOffline();
  }

  /** Card announcements go to one live region, save announcements to another, so neither overwrites the other. */
  announce(text: string, channel?: "save"): void {
    const el = channel === "save" ? this.saveAnnouncer : this.announcer;
    el.textContent = "";
    window.setTimeout(() => {
      el.textContent = text;
    }, 0);
  }

  setOfflineHandle(handle: OfflineHandle): void {
    this.offlineHandle = handle;
  }

  setOffline(s: OfflineSnapshot): void {
    this.offline = s;
    this.renderOffline();
  }

  private renderOffline(): void {
    const s = this.offline;
    this.offlineEl.textContent = offlineCopy(s.state, s.error);
    this.offlineEl.setAttribute("data-offline-state", s.state);
    this.noticeEl.textContent = FIRST_VISIT_NOTICE;
    this.noticeEl.hidden = !showFirstVisitNotice(s.state);
    clear(this.bannerEl);
    this.updateBtn.disabled = this.c.importPending;
    if (s.state === "waiting") {
      this.bannerEl.hidden = false;
      this.bannerEl.append(
        h("span", {}, "A new version is ready. Save your work, then update. "),
        this.updateBtn,
      );
    } else {
      this.bannerEl.hidden = true;
    }
  }

  /** Settle pending edits first; only activate the new worker when the flush succeeds. */
  private async updateNow(): Promise<void> {
    const ok = await this.c.requestUpdate(() => this.offlineHandle?.applyUpdate());
    if (!ok) this.update();
  }

  render(): void {
    const c = this.c;
    document.documentElement.setAttribute("data-session", c.phase);
    this.manageUnloadGuard();
    const key = `${c.phase}|${c.boardId ?? ""}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.ws = undefined;
      clear(this.view);
      this.joinInput = undefined;
      if (c.phase === "join") this.buildJoin();
      else if (c.phase === "in-use") this.buildMessage("This board is already open elsewhere", true);
      else if (c.phase === "error") this.buildMessage("PatchBoard could not open this board", c.errorAllowsRetry);
      else this.buildWorkspace();
    }
    this.update();
  }

  private manageUnloadGuard(): void {
    const want = this.c.save.state === "error";
    if (want && !this.guardInstalled) {
      window.addEventListener("beforeunload", beforeUnloadGuard);
      this.guardInstalled = true;
    } else if (!want && this.guardInstalled) {
      window.removeEventListener("beforeunload", beforeUnloadGuard);
      this.guardInstalled = false;
    }
  }

  private buildJoin(): void {
    const input = h("input", {
      id: "board-id",
      type: "text",
      name: "board-id",
      autocomplete: "off",
      spellcheck: "false",
      "aria-describedby": "board-rules board-preview board-error",
      oninput: () => {
        if (this.joinPreview !== undefined) this.joinPreview.textContent = previewBoardId(input.value);
      },
    });
    this.joinInput = input;
    this.joinPreview = h("p", { id: "board-preview" });
    this.joinError = h("p", { id: "board-error", role: "alert", class: "error-text" });
    const form = h(
      "form",
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          void this.c.open(input.value).then((ok) => {
            if (!ok && this.c.phase === "join") input.focus();
          });
        },
      },
      h("h2", {}, "Open a shared board"),
      h("label", { for: "board-id" }, "Board ID"),
      input,
      h("p", { id: "board-rules" }, `Everyone who shares this board types the same ID. ${BOARD_ID_RULES}`),
      this.joinPreview,
      this.joinError,
      h("button", { type: "submit" }, "Open board"),
    );
    this.view.append(form);
  }

  private buildMessage(title: string, retry: boolean): void {
    this.view.append(
      h(
        "section",
        { "data-testid": "session-message", role: "alert" },
        h("h2", {}, title),
        h("p", { id: "session-message-text" }, this.c.errorMessage),
        retry ? h("button", { type: "button", onclick: () => void this.c.open(this.c.boardId ?? "") }, "Try again") : null,
        h("button", { type: "button", onclick: () => this.c.openJoin() }, "Open a different board"),
      ),
    );
  }

  private buildWorkspace(): void {
    this.ws = new Workspace(this.c);
    this.view.append(this.ws.root);
  }

  update(): void {
    const c = this.c;
    if (c.phase === "join") {
      if (this.joinError !== undefined) this.joinError.textContent = c.joinMessage;
      return;
    }
    const msg = document.getElementById("session-message-text");
    if (msg !== null) msg.textContent = c.errorMessage;
    this.updateBtn.disabled = this.c.importPending;
    this.ws?.update();
  }
}

function beforeUnloadGuard(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = "";
}

class Workspace {
  readonly root: HTMLElement;
  private readonly saveEl = h("span", { "data-testid": "save-indicator" });
  private readonly alertHost = h("div");
  private readonly editErrorHost = h("div");
  private shownEditError: SessionController["editError"];
  private readonly noticeHost = h("div");
  private readonly importResult = h("div", { "data-testid": "import-result", role: "status", "aria-live": "polite" });
  private readonly mergeSummary = h("div", { "data-testid": "merge-summary" });
  private readonly importInput: HTMLInputElement;
  private changeBtn: HTMLButtonElement | undefined;
  private readonly recoveryHost = h("div");
  private readonly idLine = h("p");
  private readonly newTitle: HTMLInputElement;
  private readonly newNotes: HTMLTextAreaElement;
  private readonly addError = h("p", { id: "add-error", role: "alert", class: "error-text" });
  private readonly board: HTMLElement;
  private readonly lists = new Map<ColumnId, HTMLElement>();
  private readonly headings = new Map<ColumnId, HTMLElement>();
  private readonly invalidHeading = h("h3", { tabindex: "-1" });
  private readonly invalidList = h("ul", { class: "cards" });
  private readonly rows = new Map<string, CardRow>();
  private readonly incomplete = new Map<string, IncompleteRow>();

  constructor(private readonly c: SessionController) {
    this.importInput = h("input", {
      id: "import-file",
      type: "file",
      accept: ".gscap,application/vnd.ghostsync.capsule",
      "data-testid": "import-input",
      onchange: () => {
        const f = this.importInput.files?.[0];
        if (f !== undefined) void this.c.importFile(f);
      },
    });
    this.newTitle = h("input", { id: "new-title", name: "new-title", type: "text", maxlength: String(LIMITS.title), autocomplete: "off" });
    this.newNotes = h("textarea", { id: "new-notes", name: "new-notes", rows: "2", maxlength: String(LIMITS.notes) });
    const addForm = h(
      "form",
      {
        class: "add-form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          const title = this.newTitle.value.trim();
          if (title === "") {
            this.addError.textContent = "Enter a title.";
            return;
          }
          this.addError.textContent = "";
          this.c.addCard(title, this.newNotes.value);
          if (this.c.editError === undefined) {
            this.newTitle.value = "";
            this.newNotes.value = "";
          }
        },
      },
      h("p", {}, h("label", { for: "new-title" }, "New card title"), this.newTitle),
      h("p", {}, h("label", { for: "new-notes" }, "Notes (optional)"), this.newNotes),
      this.addError,
      h("button", { type: "submit" }, "Add card"),
    );
    this.board = h("div", { id: "board", "data-testid": "board" });
    for (const col of COLUMNS) {
      const heading = h("h3", { tabindex: "-1" }, COLUMN_LABEL[col]);
      const list = h("ul", { class: "cards" });
      this.headings.set(col, heading);
      this.lists.set(col, list);
      this.board.append(h("section", { "data-testid": `column-${col}`, "data-column": col, class: "column" }, heading, list));
    }
    this.changeBtn = h("button", { type: "button", "data-testid": "change-board", onclick: () => void this.c.changeBoard() }, "Change board");
    this.root = h(
      "main",
      {},
      h(
        "header",
        { class: "row" },
        this.idLine,
        this.changeBtn,
      ),
      h("p", { class: "status-line" }, h("span", {}, "Save status: "), this.saveEl),
      this.alertHost,
      this.editErrorHost,
      this.noticeHost,
      this.recoveryHost,
      h("p", { "data-testid": "merge-help" }, MERGE_HELP),
      h("section", { "aria-labelledby": "add-h" }, h("h2", { id: "add-h" }, "Add a card"), addForm),
      h("section", { "aria-labelledby": "board-h" }, h("h2", { id: "board-h" }, "Board"), this.board),
      h(
        "section",
        { "data-testid": "invalid-cards", "aria-labelledby": "invalid-h" },
        h("h2", { id: "invalid-h", class: "visually-subtle" }, "Incomplete cards"),
        this.invalidHeading,
        this.invalidList,
      ),
      h(
        "section",
        { "aria-labelledby": "transfer-h" },
        h("h2", { id: "transfer-h" }, "Transfer (file)"),
        h("p", {}, "Capsule files are integrity-checked (a checksum detects corruption). They are not authenticated: a checksum does not prove who sent a file."),
        h("button", { type: "button", id: "export-btn", onclick: () => void this.download("export") }, "Export capsule (.gscap)"),
        h("p", {}, h("label", { for: "import-file" }, "Import capsule file (.gscap)"), this.importInput),
        this.importResult,
        this.mergeSummary,
      ),
    );
  }

  private async download(kind: "export" | "backup"): Promise<void> {
    const built = await this.c.buildCapsule(kind);
    if (built !== undefined) downloadBytes(built.bytes, built.filename);
  }

  update(): void {
    const c = this.c;
    const main = this.root;
    if (c.boardId !== undefined) main.setAttribute("data-board-id", c.boardId);
    if (c.replicaId !== undefined) main.setAttribute("data-replica-id", c.replicaId);
    this.idLine.textContent = `Board ${c.boardId ?? ""} · This device: ${(c.replicaId ?? "").slice(0, 8)} · ${c.restored ? "Restored saved data" : "New on this device"}`;

    const l = saveLabel(c.save.state, c.save.info);
    this.saveEl.textContent = `${l.symbol} ${l.label}`;
    this.saveEl.setAttribute("data-save-state", c.save.state);
    this.saveEl.setAttribute("data-save-sequence", String(c.save.info.sequence));

    this.renderAlert();
    this.renderEditError();
    this.renderNotice();
    this.renderRecovery();
    this.renderImport();
    this.importInput.disabled = c.importPending || c.phase !== "ready";
    if (this.changeBtn !== undefined) this.changeBtn.disabled = c.importPending;
    if (c.importView?.state !== "importing" && this.importInput.value !== "" && c.importView !== undefined) {
      this.importInput.value = "";
    }
    this.renderBoard();
    this.applyFocus();
  }

  private renderAlert(): void {
    const c = this.c;
    clear(this.alertHost);
    if (c.save.state !== "error") return;
    const isImport = c.importView?.state === "applied-unsaved";
    const code = c.save.info.error?.code ?? c.importView?.code ?? "Unknown";
    const mapped = mapSaveError(code);
    this.alertHost.append(
      h(
        "div",
        {
          "data-testid": "save-error-alert",
          role: "alert",
          class: "alert",
          "data-save-error-kind": isImport ? "import" : "edit",
          "data-save-error-code": code,
        },
        h("h2", {}, isImport ? "Capsule applied, but NOT saved to this device" : "Your latest changes are NOT saved to this device."),
        h("p", {}, mapped.message),
        h("p", {}, LOSS_WARNING),
        h("button", { type: "button", onclick: () => void this.c.retrySave() }, "Retry save"),
        h("button", { type: "button", onclick: () => void this.download("backup") }, "Download backup capsule"),
      ),
    );
  }

  /** Rebuilt only when the error changes, so button focus is kept across updates. */
  private renderEditError(): void {
    const e = this.c.editError;
    if (e === this.shownEditError) return;
    const hadFocus = this.editErrorHost.contains(document.activeElement);
    this.shownEditError = e;
    clear(this.editErrorHost);
    if (e === undefined) {
      if (hadFocus) this.newTitle.focus();
      return;
    }
    this.editErrorHost.append(
      h(
        "div",
        { "data-testid": "edit-error-alert", role: "alert", class: "alert", "data-edit-error-kind": e.kind },
        h("h2", {}, e.title),
        h("p", {}, e.message),
        h("button", { type: "button", "data-testid": "edit-error-dismiss", onclick: () => this.c.dismissEditError() }, "Dismiss"),
        h("button", { type: "button", onclick: () => void this.download("backup") }, "Download backup capsule"),
        e.kind === "schema-mismatch" ? h("button", { type: "button", onclick: () => location.reload() }, "Reload app") : null,
      ),
    );
  }

  private renderNotice(): void {
    const n = this.c.notice;
    clear(this.noticeHost);
    if (n === undefined) return;
    this.noticeHost.append(
      h(
        "div",
        { "data-testid": "card-notice", role: "alert", class: "alert" },
        h("p", {}, n),
        h("button", { type: "button", onclick: () => this.c.dismissNotice() }, "Dismiss notice"),
      ),
    );
  }

  private renderRecovery(): void {
    clear(this.recoveryHost);
    if (this.c.phase !== "recovery") return;
    this.recoveryHost.append(
      h(
        "section",
        { "data-testid": "recovery-panel", role: "alert", class: "alert" },
        h("h2", {}, "Could not save before closing"),
        h("p", {}, this.c.recoveryMessage),
        h("button", { type: "button", onclick: () => void this.download("backup") }, "Download backup capsule"),
        h("button", { type: "button", onclick: () => void this.c.discardAndSwitch() }, "Discard unsaved changes and switch"),
      ),
    );
  }

  private renderImport(): void {
    const v = this.c.importView;
    clear(this.importResult);
    clear(this.mergeSummary);
    this.importResult.removeAttribute("data-import-state");
    this.importResult.removeAttribute("data-import-code");
    if (v === undefined) return;
    this.importResult.setAttribute("data-import-state", v.state);
    if (v.code !== undefined) this.importResult.setAttribute("data-import-code", v.code);
    this.importResult.append(h("p", {}, v.message));
    const lines = metaLines(v.metadata);
    if (lines.length > 0) {
      const dl = h("dl", { "data-testid": "import-meta" });
      for (const l of lines) dl.append(h("dt", {}, l.label), h("dd", { "data-testid": l.testId }, l.value));
      this.importResult.append(dl);
    }
    if (v.workspaceStale === true) {
      this.importResult.append(
        h(
          "div",
          { "data-testid": "import-stale-notice" },
          h("p", {}, STALE_WORKSPACE_NOTICE),
          h("button", { type: "button", onclick: () => void this.download("backup") }, "Download backup capsule"),
        ),
      );
    }
    if (v.diff !== undefined) {
      const ul = h("ul", {});
      if (v.diff.length === 0) ul.append(h("li", {}, "No changes: everything in this capsule was already here."));
      for (const line of v.diff) ul.append(h("li", {}, line));
      this.mergeSummary.append(h("h3", {}, "What changed"), ul);
    }
  }

  private renderBoard(): void {
    const c = this.c;
    const m = c.model;
    if (m === undefined) return;
    const editable = c.phase === "ready";
    this.board.setAttribute("data-board-revision", String(c.revision));
    const validIds = new Set<string>();
    for (const col of COLUMNS) for (const p of m.columns[col]) validIds.add(p.id);
    for (const [id, row] of this.rows) {
      // A card whose edit form is open stays so the draft is never lost; Save then reports it as gone.
      if (!validIds.has(id) && !row.editing) {
        row.el.remove();
        this.rows.delete(id);
      }
    }
    for (const col of COLUMNS) {
      const list = this.lists.get(col);
      if (list === undefined) continue;
      const cards = m.columns[col];
      let prev: Element | null = null;
      cards.forEach((p, i) => {
        let row = this.rows.get(p.id);
        if (row === undefined) {
          row = new CardRow(c, p.id);
          this.rows.set(p.id, row);
        }
        row.fill(p, editable);
        row.setEnds(i === 0, i === cards.length - 1);
        this.place(list, row.el, prev);
        prev = row.el;
      });
    }
    const invalidIds = new Set(m.invalid.map((r) => r.id));
    for (const [id, row] of this.incomplete) {
      if (!invalidIds.has(id)) {
        row.el.remove();
        this.incomplete.delete(id);
      }
    }
    this.invalidHeading.textContent = `Conflicted or incomplete cards (${m.invalid.length})`;
    let prevInvalid: Element | null = null;
    for (const inv of m.invalid) {
      let row = this.incomplete.get(inv.id);
      if (row === undefined) {
        row = new IncompleteRow(c, inv.id);
        this.incomplete.set(inv.id, row);
      }
      row.fill(inv, editable);
      this.place(this.invalidList, row.el, prevInvalid);
      prevInvalid = row.el;
    }
  }

  /** Put `el` right after `prev` (or first) only when it is not already there, keeping focus inside it. */
  private place(list: HTMLElement, el: HTMLElement, prev: Element | null): void {
    const current = prev === null ? list.firstElementChild : prev.nextElementSibling;
    if (current === el) return;
    const active = document.activeElement;
    list.insertBefore(el, current);
    if (active instanceof HTMLElement && active !== document.activeElement && el.contains(active)) active.focus();
  }

  private applyFocus(): void {
    const req = this.c.takeFocusRequest();
    if (req === undefined) return;
    if (req.kind === "column") {
      this.headings.get(req.column)?.focus();
    } else if (req.kind === "invalid-heading") {
      this.invalidHeading.focus();
    } else {
      const row = this.rows.get(req.cardId) ?? this.incomplete.get(req.cardId);
      if (row === undefined) return;
      const button = req.action !== undefined && row instanceof CardRow ? row.action(req.action) : undefined;
      (button ?? row.el).focus();
    }
  }
}
