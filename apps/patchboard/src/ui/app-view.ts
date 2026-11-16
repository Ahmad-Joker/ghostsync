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
import { QR_ENABLED } from "../config.js";
import type { QrTransferController } from "../transfer/qr/qr-controller.js";
import { QrView } from "../transfer/qr/qr-view.js";
import { TRANSFER_MODE_LABEL } from "../transfer/qr/transfer-mode.js";
import { CardRow, IncompleteRow } from "./card-row.js";
import { Guidance } from "./guidance.js";
import { clear, h } from "./h.js";

/** Horizontal padding and borders of the QR panel plus its frame (see patchboard-ui.css). */
const QR_CHROME_PX = 88;
const EMPTY_COPY: Record<ColumnId, string> = {
  todo: "Nothing here yet. Type a title under Add a card, then choose Add card.",
  doing: "Nothing in progress. Use Move to Doing on a card when work starts.",
  done: "Nothing finished yet. Use Move to Done on a card when it is complete.",
};
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
  private readonly offlineEl = h("p", { "data-testid": "offline-indicator", class: "gs-chip gs-chip--icon gs-chip--warn pb-offline" });
  private readonly networkEl = h("span", { "data-testid": "network-chip", class: "gs-chip gs-chip--icon gs-chip--ok" });
  private readonly noticeEl = h("p", { "data-testid": "first-visit-notice", class: "gs-help-text" });
  private readonly noteEl = h("p", { class: "gs-help-text pb-status-note", id: "status-note" });
  private readonly guidance = new Guidance(() => document.getElementById("board-id") ?? document.getElementById("new-title") ?? undefined);
  private readonly bannerEl = h("div", { "data-testid": "update-banner", class: "pb-banner", hidden: true });
  private readonly updateBtn: HTMLButtonElement = h("button", { type: "button", onclick: () => void this.updateNow() }, "Update now");
  private readonly announcer = h("div", { "data-testid": "announcer", role: "status", "aria-live": "polite", "aria-atomic": "true", class: "sr-only" });
  private readonly saveAnnouncer = h("div", { "data-testid": "save-announcer", role: "status", "aria-live": "polite", "aria-atomic": "true", class: "sr-only" });
  private readonly view = h("div", { id: "view" });
  private ws: Workspace | undefined;
  private joinInput: HTMLInputElement | undefined;
  private joinPreview: HTMLElement | undefined;
  private joinError: HTMLElement | undefined;
  private guardInstalled = false;
  private online = true;
  private readonly modeEl = h("span", { "data-testid": "transfer-mode", "data-transfer-mode": "file", class: "gs-chip gs-chip--icon gs-chip--info" }, TRANSFER_MODE_LABEL.file);

  constructor(
    private readonly root: HTMLElement,
    private readonly c: SessionController,
    private readonly qr?: QrTransferController,
  ) {
    this.status = h(
      "section",
      { class: "status", "aria-label": "Device status" },
      h("div", { class: "gs-chips" }, this.networkEl, this.modeEl),
      this.offlineEl,
      this.noteEl,
      this.noticeEl,
      this.bannerEl,
    );
    const header = h(
      "header",
      { class: "gs-header" },
      h(
        "div",
        { class: "gs-brand" },
        h("span", { class: "gs-mark pb-mark", "aria-hidden": "true" }),
        h(
          "div",
          { class: "gs-brand-text" },
          h("p", { class: "gs-brand-name" }, "GhostSync"),
          h("h1", { class: "gs-app-name" }, "PatchBoard"),
          h("p", { class: "gs-tagline" }, "Collaboration beyond the signal"),
        ),
      ),
      h("div", { class: "gs-header-actions" }, this.guidance.helpBtn),
    );
    this.root.append(header, this.status, this.guidance.root, this.announcer, this.saveAnnouncer, this.view);
    const net = (): void => {
      const online = navigator.onLine;
      this.networkEl.textContent = online ? "Network: online" : "Network: offline";
      this.networkEl.className = `gs-chip gs-chip--icon ${online ? "gs-chip--ok" : "gs-chip--warn"}`;
      this.online = online;
      this.renderNote();
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
    const tone = s.state === "ready" ? "ok" : s.state === "failed" || s.state === "unsupported" ? "bad" : "warn";
    this.offlineEl.className = `gs-chip gs-chip--icon gs-chip--${tone} pb-offline`;
    this.renderNote();
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

  private renderNote(): void {
    const parts: string[] = [];
    if (!this.online) parts.push("Signal lost. Your work remains.");
    if (this.offline.state === "ready") parts.push("You can disconnect from the network and continue working.");
    this.noteEl.textContent = parts.join(" ");
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
      h("p", { class: "gs-help-text" }, "Type the board ID your team shares. The board opens on this device and your changes are stored here."),
      h("label", { for: "board-id" }, "Board ID"),
      input,
      h("p", { id: "board-rules", class: "gs-help-text" }, `Everyone who shares this board types the same ID. ${BOARD_ID_RULES}`),
      this.joinPreview,
      this.joinError,
      h("button", { type: "submit", class: "gs-btn--primary" }, "Open board"),
    );
    form.className = "pb-join";
    this.view.append(h("section", { class: "gs-panel gs-panel--glow pb-join-panel", "aria-label": "Open a board" }, form));
  }

  private buildMessage(title: string, retry: boolean): void {
    this.view.append(
      h(
        "section",
        { "data-testid": "session-message", role: "alert", class: "gs-panel pb-message" },
        h("h2", {}, title),
        h("p", { id: "session-message-text" }, this.c.errorMessage),
        h("p", { class: "gs-help-text" }, retry ? "Choose Try again once the problem is fixed, or open a different board." : "Open a different board, or reload the page and try again."),
        h(
          "div",
          { class: "actions" },
          retry ? h("button", { type: "button", class: "gs-btn--primary", onclick: () => void this.c.open(this.c.boardId ?? "") }, "Try again") : null,
          h("button", { type: "button", onclick: () => this.c.openJoin() }, "Open a different board"),
        ),
      ),
    );
  }

  private buildWorkspace(): void {
    this.ws = new Workspace(this.c, QR_ENABLED ? this.qr : undefined);
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
    const mode = this.qr?.mode ?? "file";
    this.modeEl.textContent = TRANSFER_MODE_LABEL[mode];
    this.modeEl.setAttribute("data-transfer-mode", mode);
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
  private readonly importResult = h("div", { "data-testid": "import-result", role: "status", "aria-live": "polite", class: "pb-import" });
  private readonly mergeSummary = h("div", { "data-testid": "merge-summary", class: "pb-merge" });
  private readonly importInput: HTMLInputElement;
  private readonly importHelp = h("p", { id: "import-help", class: "gs-help-text" });
  private changeBtn: HTMLButtonElement | undefined;
  private readonly recoveryHost = h("div");
  private readonly idLine = h("p");
  private readonly newTitle: HTMLInputElement;
  private readonly newNotes: HTMLTextAreaElement;
  private readonly addError = h("p", { id: "add-error", role: "alert", class: "error-text" });
  private readonly board: HTMLElement;
  private readonly lists = new Map<ColumnId, HTMLElement>();
  private readonly headings = new Map<ColumnId, HTMLElement>();
  private readonly counts = new Map<ColumnId, HTMLElement>();
  private readonly empties = new Map<ColumnId, HTMLElement>();
  private readonly saveHelp = h("p", { class: "gs-help-text pb-save-help" });
  private readonly invalidIntro = h("p", { class: "gs-help-text" }, "These cards have missing or conflicting fields, so they cannot be shown as normal cards. Restore rebuilds a card from what could be read and puts it in To do. Discard removes it from this device.");
  private readonly invalidHeading = h("h3", { tabindex: "-1" });
  private readonly invalidList = h("ul", { class: "cards" });
  private readonly rows = new Map<string, CardRow>();
  private readonly incomplete = new Map<string, IncompleteRow>();

  private readonly qrView: QrView | undefined;

  constructor(private readonly c: SessionController, qr?: QrTransferController) {
    // The code sits inside a padded frame and panel; reserve that chrome so the canvas never overflows it.
    if (qr !== undefined) {
      this.qrView = new QrView(
        qr,
        () => Math.max(0, (this.qrView?.root.clientWidth ?? 0) - QR_CHROME_PX),
        () => this.c.boardId,
      );
    }
    this.importInput = h("input", {
      id: "import-file",
      type: "file",
      accept: ".gscap,application/vnd.ghostsync.capsule",
      "aria-describedby": "import-help",
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
            this.newTitle.setAttribute("aria-invalid", "true");
            return;
          }
          this.addError.textContent = "";
          this.newTitle.removeAttribute("aria-invalid");
          this.c.addCard(title, this.newNotes.value);
          if (this.c.editError === undefined) {
            this.newTitle.value = "";
            this.newNotes.value = "";
          }
        },
      },
      h(
        "div",
        { class: "pb-field" },
        h("label", { for: "new-title" }, "New card title"),
        this.newTitle,
        h("p", { id: "add-title-help", class: "gs-help-text" }, "A short name for the task. It is added to To do."),
        this.addError,
      ),
      h(
        "div",
        { class: "pb-field" },
        h("label", { for: "new-notes" }, "Notes (optional)"),
        this.newNotes,
        h("p", { id: "add-notes-help", class: "gs-help-text" }, "Extra detail for whoever picks the card up."),
      ),
      h("button", { type: "submit", class: "gs-btn--primary pb-add-btn" }, "Add card"),
    );
    this.newTitle.setAttribute("aria-describedby", "add-title-help add-error");
    this.newNotes.setAttribute("aria-describedby", "add-notes-help");
    this.board = h("div", { id: "board", "data-testid": "board" });
    for (const col of COLUMNS) {
      const heading = h("h3", { tabindex: "-1" }, COLUMN_LABEL[col]);
      const list = h("ul", { class: "cards" });
      const count = h("span", { class: "pb-count" });
      const empty = h("p", { class: "pb-empty gs-help-text" }, EMPTY_COPY[col]);
      this.headings.set(col, heading);
      this.lists.set(col, list);
      this.counts.set(col, count);
      this.empties.set(col, empty);
      this.board.append(
        h(
          "section",
          { "data-testid": `column-${col}`, "data-column": col, class: "column" },
          h("div", { class: "pb-col-head" }, heading, count),
          list,
          empty,
        ),
      );
    }
    this.changeBtn = h("button", { type: "button", "data-testid": "change-board", onclick: () => void this.c.changeBoard() }, "Change board");
    this.root = h(
      "main",
      {},
      h(
        "header",
        { class: "row pb-board-head" },
        this.idLine,
        this.changeBtn,
      ),
      h("p", { class: "status-line" }, h("span", {}, "Save status: "), this.saveEl),
      this.saveHelp,
      this.alertHost,
      this.editErrorHost,
      this.noticeHost,
      this.recoveryHost,
      h("section", { "aria-labelledby": "add-h", class: "gs-panel pb-add" }, h("h2", { id: "add-h" }, "Add a card"), addForm),
      h("section", { "aria-labelledby": "board-h", class: "pb-board-section" }, h("h2", { id: "board-h" }, "Board"), this.board),
      h(
        "section",
        { "data-testid": "invalid-cards", "aria-labelledby": "invalid-h", class: "pb-invalid-section" },
        h("h2", { id: "invalid-h", class: "visually-subtle" }, "Incomplete cards"),
        this.invalidHeading,
        this.invalidIntro,
        this.invalidList,
      ),
      h(
        "section",
        { "aria-labelledby": "transfer-h", class: "gs-panel gs-panel--glow pb-portal" },
        h("h2", { id: "transfer-h" }, "Transfer Portal"),
        h(
          "p",
          {},
          "Carry this board's changes to another device. A capsule is a small file containing this board's changes. Changes carried safely between devices.",
        ),
        h(
          "p",
          { class: "gs-help-text" },
          "Which should I use? File transfer always works. Use a QR code only when the capsule is small and both devices are side by side.",
        ),
        h(
          "div",
          { class: "pb-card pb-file", role: "group", "aria-labelledby": "file-h" },
          h("h3", { id: "file-h" }, "File transfer"),
          h("p", { class: "gs-help-text" }, "Always works, even with a large board."),
          h(
            "ol",
            { class: "pb-seq" },
            h("li", {}, "Export a capsule on this device."),
            h("li", {}, "Send the file to the other device any way you like."),
            h("li", {}, "On that device, choose the file under Import."),
          ),
          h("button", { type: "button", id: "export-btn", class: "gs-btn--primary", onclick: () => void this.download("export") }, "Export capsule (.gscap)"),
          h(
            "div",
            { class: "pb-field" },
            h("label", { for: "import-file" }, "Import capsule file (.gscap)"),
            this.importInput,
            this.importHelp,
          ),
          h("p", { class: "gs-help-text" }, "Files are not authenticated: only import capsules from people you trust."),
          h(
            "details",
            { class: "gs-learn" },
            h("summary", {}, "Learn more: checksum and backups"),
            h("p", {}, "The checksum detects damaged data. It does not prove who created or sent the capsule."),
            h("p", {}, "If saving ever fails, a button to download a backup capsule appears at the top of this page. Use it before closing or reloading."),
            h("p", { "data-testid": "merge-help" }, MERGE_HELP),
          ),
        ),
        this.importResult,
        this.mergeSummary,
        this.qrView?.root,
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
    const tone = c.save.state === "saved" ? "ok" : c.save.state === "error" ? "bad" : c.save.state === "saving" ? "info" : "warn";
    this.saveEl.className = `gs-chip gs-chip--${tone}`;
    this.saveHelp.textContent =
      c.save.state === "saved"
        ? "Your latest changes are stored safely on this device. Saved beyond the signal."
        : c.save.state === "error"
          ? "Saving failed. Use Retry save below, or download a backup capsule so nothing is lost."
          : c.save.state === "saving"
            ? "Saving your changes to this device. Keep this page open."
            : "Your changes are saved to this device automatically.";

    this.renderAlert();
    this.renderEditError();
    this.renderNotice();
    this.renderRecovery();
    this.renderImport();
    this.qrView?.update();
    this.importInput.disabled = c.importPending || c.phase !== "ready";
    this.importHelp.textContent = this.importInput.disabled
      ? c.importPending
        ? "Import is paused while another import finishes."
        : "Import is unavailable until the board has finished saving or reopening."
      : "Choosing a file imports it straight away. A summary of what changed appears below.";
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
        h("p", { class: "gs-help-text" }, "What to do next: choose Retry save. If it keeps failing, download a backup capsule before you close this page."),
        h("button", { type: "button", class: "gs-btn--primary", onclick: () => void this.c.retrySave() }, "Retry save"),
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
        h("p", { class: "gs-help-text" }, "What to do next: download a backup capsule first. Discarding permanently drops the unsaved changes and opens the board chooser."),
        h("button", { type: "button", class: "gs-btn--primary", onclick: () => void this.download("backup") }, "Download backup capsule"),
        h("button", { type: "button", class: "gs-btn--danger", onclick: () => void this.c.discardAndSwitch() }, "Discard unsaved changes and switch"),
      ),
    );
  }

  private renderImport(): void {
    const v = this.c.importView;
    clear(this.importResult);
    clear(this.mergeSummary);
    this.importResult.removeAttribute("data-import-state");
    this.importResult.removeAttribute("data-import-code");
    this.importResult.removeAttribute("data-import-source");
    if (v === undefined) return;
    if (v.source !== undefined) this.importResult.setAttribute("data-import-source", v.source);
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
    this.invalidIntro.hidden = m.invalid.length === 0;
    for (const col of COLUMNS) {
      const n = m.columns[col].length;
      const count = this.counts.get(col);
      if (count !== undefined) count.textContent = n === 1 ? "1 card" : `${n} cards`;
      const empty = this.empties.get(col);
      if (empty !== undefined) empty.hidden = n > 0;
    }
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
