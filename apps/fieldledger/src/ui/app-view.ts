import { DOCUMENT_ID_RULES, previewDocumentId } from "../identity/document-id.js";
import { LIMITS, SEVERITIES, STATUSES, type IncidentDetails } from "../model/adapters.js";
import type { ModelDiff } from "../model/diff.js";
import { FIRST_VISIT_NOTICE, offlineCopy, showFirstVisitNotice } from "../offline/status-copy.js";
import type { OfflineHandle, OfflineSnapshot } from "../offline/sw-register.js";
import type { SessionController } from "../session/session-controller.js";
import { LOSS_WARNING, mapSaveError } from "../state/errors.js";
import { saveLabel } from "../state/save-label.js";
import { metaLines } from "../transfer/capsule-meta.js";
import { downloadBytes } from "../transfer/export.js";
import { Guidance } from "./guidance.js";
import { clear, h } from "./h.js";
import { heroArt, icon } from "./icon.js";
import { offlineBannerView } from "./offline-banner.js";
import { connectionNote, countModelDiff, importHeadline } from "./status-text.js";

const NOTICE_MIN_VISIBLE_MS = 1500;
/** Titles longer than these are also shown in full, wrapped, under the field (see .fl-record-full in fieldledger.css). */
const SHORT_TITLE = 28;
const LONG_TITLE = 64;
const STALE_WORKSPACE_NOTICE =
  "This workspace is showing the last data it could read. The imported capsule was applied, but this version of FieldLedger cannot read the result, so the checklist above may be out of date. Download a backup capsule before you reload or update the app.";
const truncate = (s: string): string => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

function describeDiff(d: ModelDiff): string[] {
  if (d.noChanges) return ["No changes: everything in this capsule was already here."];
  const lines: string[] = [];
  if (d.addedItems.length > 0) lines.push(`Added ${d.addedItems.length} checklist item(s).`);
  if (d.removedItems.length > 0) lines.push(`Removed ${d.removedItems.length} checklist item(s).`);
  for (const c of d.changedItems) lines.push(`Item ${truncate(c.id)}: ${c.field} changed from "${truncate(String(c.before))}" to "${truncate(String(c.after))}".`);
  for (const c of d.changedIncident) lines.push(`Incident ${c.field} changed from "${truncate(String(c.before))}" to "${truncate(String(c.after))}".`);
  if (d.becameInvalid.length > 0) lines.push(`${d.becameInvalid.length} item(s) are now conflicted or incomplete.`);
  lines.push("If both devices edited the same field, only one value is kept.");
  return lines;
}

/** DOM views. Reads state from the controller; never owns session state. */
export class AppView {
  private offline: OfflineSnapshot = { state: "registering", ready: false };
  private shownKey = "";
  private offlineHandle: OfflineHandle | undefined;
  private readonly status: HTMLElement;
  private readonly offlineEl = h("p", { "data-testid": "offline-indicator", class: "gs-chip gs-chip--icon gs-chip--info" });
  private readonly networkEl = h("span", { "data-testid": "network-chip", class: "gs-chip gs-chip--icon gs-chip--ok" });
  private readonly noticeEl: HTMLElement =
    document.querySelector<HTMLElement>('[data-testid="first-visit-notice"]') ?? h("p", { "data-testid": "first-visit-notice", class: "gs-note" });
  private readonly offlineTitle = h("p", { class: "gs-offline-title" });
  private readonly offlineState = h("p", { class: "gs-offline-state" });
  private readonly offlineBanner = h(
    "div",
    {
      class: "gs-offline fl-offline",
      "data-testid": "offline-banner",
      onanimationend: () => this.offlineBanner.classList.remove("is-reacting"),
    },
    h("span", { class: "gs-courier-sm" }, icon("gs-courier-sm"), h("span", { class: "gs-lantern" })),
    h("div", {}, this.offlineTitle, this.offlineState),
  );
  private readonly bannerEl = h("div", { "data-testid": "update-banner", class: "gs-banner", hidden: true });
  private readonly noteEl = h("p", { class: "gs-status-note", id: "status-note" });
  private readonly guidance = new Guidance();
  private readonly announcer = h("div", { id: "save-announcer", role: "status", "aria-live": "polite", "aria-atomic": "true", class: "sr-only" });
  private readonly view = h("div", { id: "view" });
  private ws: Workspace | undefined;
  private joinInput: HTMLInputElement | undefined;
  private joinPreview: HTMLElement | undefined;
  private joinError: HTMLElement | undefined;
  private lastAnnounced = "";
  private guardInstalled = false;
  private noticeTimer: number | undefined;
  private online = true;

  constructor(private readonly root: HTMLElement, private readonly c: SessionController) {
    // One visible readiness cue at a time: the offline indicator while online, the banner while offline.
    // The network chip and the plain status note stay in the DOM as visually hidden text (see fieldledger.css).
    this.status = h(
      "section",
      { class: "status gs-statusbar", "aria-label": "Device status", "data-network": "online" },
      h("div", { class: "fl-cue" }, h("div", { class: "fl-readiness" }, this.offlineEl), this.offlineBanner),
      h(
        "div",
        { class: "gs-chips" },
        this.networkEl,
        h("span", { "data-testid": "transfer-mode", class: "gs-chip gs-chip--icon gs-chip--info" }, "Transfer: file (.gscap)"),
      ),
      this.noteEl,
      this.bannerEl,
    );
    document.getElementById("gs-header-actions")?.append(this.guidance.helpBtn);
    this.root.append(this.status, this.guidance.root, h("div", { class: "fl-notices" }, this.noticeEl), this.announcer, this.view);
    const net = (react: boolean): void => {
      const wasOnline = this.online;
      this.online = navigator.onLine;
      this.networkEl.textContent = this.online ? "Network: online" : "Network: offline";
      this.networkEl.className = `gs-chip gs-chip--icon ${this.online ? "gs-chip--ok" : "gs-chip--warn"}`;
      this.renderNote();
      // The lantern reacts once, only when the device really goes offline while the page is open.
      this.offlineBanner.classList.remove("is-reacting");
      if (react && wasOnline && !this.online) {
        void this.offlineBanner.offsetWidth;
        this.offlineBanner.classList.add("is-reacting");
      }
    };
    net(false);
    window.addEventListener("online", () => net(false));
    window.addEventListener("offline", () => net(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.c.onPageHide();
    });
    window.addEventListener("pagehide", () => this.c.onPageHide());
    this.renderOffline();
  }

  /**
   * Show the first-visit notice while not ready. When readiness arrives within
   * NOTICE_MIN_VISIBLE_MS of page start (offline readiness can complete in a few
   * milliseconds), the hide is deferred so the notice is readable, not a flash.
   * Readiness attributes and the offline indicator are not delayed.
   */
  private updateNotice(show: boolean): void {
    if (this.noticeTimer !== undefined) {
      window.clearTimeout(this.noticeTimer);
      this.noticeTimer = undefined;
    }
    if (show) {
      this.noticeEl.hidden = false;
      return;
    }
    const wait = NOTICE_MIN_VISIBLE_MS - performance.now();
    if (wait > 0 && !this.noticeEl.hidden) {
      this.noticeTimer = window.setTimeout(() => {
        this.noticeTimer = undefined;
        this.noticeEl.hidden = true;
      }, wait);
      return;
    }
    this.noticeEl.hidden = true;
  }

  announce(text: string): void {
    // De-duplicate so repeated identical transitions do not chatter.
    if (text === this.lastAnnounced) {
      this.announcer.textContent = "";
    }
    this.lastAnnounced = text;
    window.setTimeout(() => {
      this.announcer.textContent = text;
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
    const tone = s.state === "ready" ? "ok" : s.state === "failed" ? "bad" : s.state === "unsupported" || s.state === "waiting" ? "warn" : "info";
    this.offlineEl.className = `gs-chip gs-chip--icon gs-chip--${tone}`;
    this.noticeEl.textContent = FIRST_VISIT_NOTICE;
    this.updateNotice(showFirstVisitNotice(s.state));
    clear(this.bannerEl);
    if (s.state === "waiting") {
      this.bannerEl.hidden = false;
      this.bannerEl.append(
        h("span", {}, "A new version is ready. Save your work, then update."),
        h("button", { type: "button", class: "gs-btn--primary", onclick: () => void this.updateNow() }, "Update now"),
      );
    } else {
      this.bannerEl.hidden = true;
    }
  }

  /** Connection cue and plain status text, from the real network state and the real save state. */
  private renderNote(): void {
    this.status.setAttribute("data-network", this.online ? "online" : "offline");
    this.noteEl.textContent = connectionNote(this.online, this.c.phase, this.c.save.state);
    const b = offlineBannerView(this.online, this.c.phase, this.c.save.state);
    this.offlineTitle.textContent = b.title;
    this.offlineState.textContent = b.state;
    this.offlineBanner.setAttribute("aria-hidden", b.visible ? "false" : "true");
  }

  /** Settle pending edits first; only activate the new worker when the flush succeeds. */
  private async updateNow(): Promise<void> {
    const ok = await this.c.settle();
    if (ok) this.offlineHandle?.applyUpdate();
    else this.update();
  }

  render(): void {
    const c = this.c;
    document.documentElement.setAttribute("data-session", c.phase);
    this.manageUnloadGuard();
    const key = `${c.phase}|${c.documentId ?? ""}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.ws = undefined;
      // The guide lives under the hero's "See how it works" while choosing an incident, and under the status bar otherwise.
      this.status.after(this.guidance.root);
      clear(this.view);
      this.joinInput = undefined;
      if (c.phase === "join") this.buildJoin();
      else if (c.phase === "in-use") this.buildMessage("This incident is already open elsewhere", true);
      else if (c.phase === "error") this.buildMessage("FieldLedger could not open this incident", c.errorAllowsRetry);
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

  // ---------------- join / error screens ----------------
  private buildJoin(): void {
    const input = h("input", {
      id: "incident-id",
      type: "text",
      name: "incident-id",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false",
      placeholder: "e.g. pump-station-7",
      "aria-describedby": "incident-hint incident-rules incident-format incident-preview incident-error",
      oninput: () => {
        if (this.joinPreview !== undefined) this.joinPreview.textContent = previewDocumentId(input.value);
      },
    });
    this.joinInput = input;
    this.joinPreview = h("p", { id: "incident-preview" });
    this.joinError = h("p", { id: "incident-error", role: "alert", class: "error-text" });
    this.joinPreview.className = "gs-help-text fl-preview";
    const form = h(
      "form",
      {
        class: "fl-join gs-paper gs-torn",
        onsubmit: (e: Event) => {
          e.preventDefault();
          void this.c.open(input.value).then((ok) => {
            if (!ok && this.c.phase === "join") input.focus();
          });
        },
      },
      h("h2", { class: "sr-only" }, "Open a shared incident"),
      h("label", { for: "incident-id", class: "fl-label" }, "Incident ID"),
      h("p", { id: "incident-hint", class: "gs-help-text fl-hint" }, "Use the same incident ID on both devices."),
      h("div", { class: "fl-join-row" }, input, h("button", { type: "submit", class: "gs-btn--primary" }, "Open incident")),
      this.joinPreview,
      this.joinError,
      h(
        "details",
        { class: "gs-learn fl-rules" },
        h("summary", {}, "What counts as an incident ID"),
        h("p", { id: "incident-rules", class: "fl-rule-text" }, "Both people enter the same incident ID."),
        h("p", { id: "incident-format", class: "fl-rule-text" }, DOCUMENT_ID_RULES),
      ),
    );
    this.view.append(
      h(
        "section",
        { class: "fl-hero", "aria-label": "Open an incident" },
        h("div", { class: "fl-hero-art", id: "hero-art" }, heroArt()),
        h(
          "div",
          { class: "fl-hero-copy" },
          h("h2", { class: "gs-hero-title" }, "The checklist survives the dead zone."),
          h("p", { class: "gs-hero-lede" }, "Open an incident, work offline, share a file."),
          form,
          h("div", { class: "fl-see-how-row" }, this.guidance.seeHowBtn),
          this.guidance.root,
        ),
      ),
    );
  }

  private buildMessage(title: string, retry: boolean): void {
    this.view.append(
      h(
        "section",
        { "data-testid": "session-message", role: "alert", class: "alert fl-message" },
        h("h2", {}, title),
        h("p", { id: "session-message-text" }, this.c.errorMessage),
        retry
          ? h("p", { class: "gs-help-text" }, "What to do next: choose Try again. If it keeps failing, close other tabs or windows that have this incident open. Nothing was changed.")
          : null,
        retry
          ? h("button", { type: "button", id: "try-again", class: "gs-btn--primary", onclick: () => void this.c.open(this.c.documentId ?? "") }, "Try again")
          : null,
        h("p", {}, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); this.c.openJoin(); } }, "Open a different incident")),
      ),
    );
  }

  // ---------------- workspace ----------------
  private buildWorkspace(): void {
    this.ws = new Workspace(this.c, () => this.update());
    this.view.append(this.ws.root);
  }

  update(): void {
    const c = this.c;
    this.renderNote();
    if (c.phase === "join") {
      if (this.joinError !== undefined) this.joinError.textContent = c.joinMessage;
      return;
    }
    const msg = document.getElementById("session-message-text");
    if (msg !== null) msg.textContent = c.errorMessage;
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
  private readonly detailsHost = h("section", { "aria-labelledby": "details-h", class: "gs-panel fl-details fl-sheet" });
  private readonly listEl = h("ol", { "data-testid": "checklist" });
  private readonly invalidHost = h("div");
  private readonly importResult = h("div", { "data-testid": "import-result", role: "status", "aria-live": "polite", class: "gs-result" });
  private readonly mergeSummary = h("div", { "data-testid": "merge-summary", class: "gs-result" });
  private readonly importInput: HTMLInputElement;
  private readonly recoveryHost = h("div");
  private readonly titleId = h("strong", { class: "fl-title-id" });
  private readonly metaEl = h("p", { class: "fl-meta" });
  private readonly savedHelp = h("p", { class: "gs-help-text fl-saved-help" });
  private readonly progressText = h("span", { class: "fl-progress-text" });
  private readonly progressBar = h("progress", { class: "fl-progress-bar", "aria-hidden": "true", max: "1", value: "0" });
  private readonly transferHeading = h("h2", { id: "transfer-h", tabindex: "-1", class: "gs-panel-title" }, "Transfer (file)");
  private readonly pausedNote = h(
    "p",
    { id: "paused-note", class: "gs-help-text fl-paused", hidden: true },
    "Editing and importing are paused until the unsaved changes are resolved. Use the message below to download a backup or discard them.",
  );
  private readonly emptyEl: HTMLElement;
  private readonly newItem: HTMLInputElement;
  private readonly rows = new Map<string, Row>();
  private detailsBuilt = false;
  /** Set when an edit just failed: redraw fields from the last good model even if one is focused (the draft was not applied). */
  private resyncFocused = false;
  private fields: Partial<Record<keyof IncidentDetails, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>> = {};
  private createTitle: HTMLInputElement | undefined;
  private createBtn: HTMLButtonElement | undefined;

  constructor(private readonly c: SessionController, private readonly requestUpdate: () => void) {
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
    this.newItem = h("input", { id: "new-item", type: "text", maxlength: String(LIMITS.itemText), autocomplete: "off" });
    const addForm = h(
      "form",
      {
        class: "fl-add-form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          const text = this.newItem.value.trim();
          if (text.length === 0) return;
          this.c.addChecklistItem(text);
          this.newItem.value = "";
        },
      },
      h("label", { for: "new-item", class: "fl-label" }, "New checklist item"),
      h("div", { class: "fl-add" }, this.newItem, h("button", { type: "submit", class: "gs-btn--primary" }, "Add item")),
      h("p", { id: "new-item-help", class: "gs-help-text" }, "Type a task for this incident, then press Enter or Add item."),
    );
    this.newItem.setAttribute("aria-describedby", "new-item-help");
    this.emptyEl = h("p", { class: "fl-empty", hidden: true }, "No checklist items yet. Add the first one above; it is saved on this device straight away.");
    const toTransfer = (focus: HTMLElement): void => {
      focus.scrollIntoView({ block: "start" });
      focus.focus();
    };
    this.root = h(
      "main",
      { class: "fl-workspace" },
      h(
        "section",
        { class: "gs-panel fl-command", "aria-label": "Incident overview" },
        h(
          "header",
          { class: "fl-command-head" },
          h("div", { class: "fl-titleblock" }, h("p", { class: "fl-title" }, h("span", { class: "fl-title-label" }, "Incident "), this.titleId), this.metaEl),
          h(
            "div",
            { class: "fl-head-actions" },
            h("button", { type: "button", class: "gs-btn--quiet", onclick: () => toTransfer(this.transferHeading) }, "Share"),
            h("button", { type: "button", class: "gs-btn--quiet", onclick: () => toTransfer(this.importInput.disabled ? this.transferHeading : this.importInput) }, "Import"),
            h("button", { type: "button", "data-testid": "change-incident", class: "gs-btn--quiet", onclick: () => void this.c.changeIncident() }, "Change incident"),
          ),
        ),
        h("p", { class: "status-line fl-save-line" }, h("span", { class: "fl-save-label" }, "Save status: "), this.saveEl),
        this.savedHelp,
        this.pausedNote,
      ),
      this.alertHost,
      this.editErrorHost,
      this.recoveryHost,
      this.mergeSummary,
      this.detailsHost,
      h(
        "section",
        { class: "gs-panel gs-paper fl-records fl-notebook", "aria-labelledby": "list-h" },
        h("div", { class: "fl-records-head" }, h("h2", { id: "list-h", class: "gs-panel-title" }, "Checklist"), h("p", { class: "fl-progress" }, this.progressText, this.progressBar)),
        addForm,
        this.listEl,
        this.emptyEl,
        this.invalidHost,
      ),
      h(
        "section",
        { class: "gs-panel gs-transfer fl-transfer", "aria-labelledby": "transfer-h" },
        this.transferHeading,
        h("p", {}, "Move this incident's changes to another device. Both devices must open the same incident ID."),
        h("p", { class: "gs-help-text" }, "FieldLedger shares by file only: there is no QR code here. A file works for any update size."),
        h(
          "div",
          { class: "gs-transfer-grid" },
          h(
            "div",
            { class: "gs-transfer-group", role: "group", "aria-labelledby": "file-down-h" },
            h("h3", { id: "file-down-h" }, "Download file"),
            h("p", { class: "gs-help-text", id: "export-help" }, "Saves a .gscap file you can send by any method. It also works as a backup copy of this incident log."),
            h("button", { type: "button", id: "export-btn", class: "gs-btn--primary", "aria-describedby": "export-help", onclick: () => void this.download("export") }, "Export capsule (.gscap)"),
          ),
          h(
            "div",
            { class: "gs-transfer-group", role: "group", "aria-labelledby": "file-up-h" },
            h("h3", { id: "file-up-h" }, "Import file"),
            h("label", { for: "import-file", class: "fl-label" }, "Import capsule (.gscap)"),
            this.importInput,
            h("p", { class: "gs-help-text", id: "import-help" }, "Choosing a file imports it straight away, with no preview. The capsule is checked first: a damaged or wrong file is rejected and nothing is changed."),
            h("p", { class: "gs-trust", id: "import-trust" }, "Files are not authenticated: only import capsules from people you trust."),
          ),
        ),
        h(
          "details",
          { class: "gs-learn" },
          h("summary", {}, "Technical details: checksum"),
          h("p", {}, "The checksum detects damaged data. It does not prove who created or sent the capsule."),
          h("p", {}, "Capsule files are integrity-checked (a checksum detects corruption). They are not authenticated: a checksum does not prove who sent a file."),
        ),
        this.importResult,
      ),
    );
    this.importInput.setAttribute("aria-describedby", "import-help import-trust");
  }
  private async download(kind: "export" | "backup"): Promise<void> {
    const built = await this.c.buildCapsule(kind);
    if (built !== undefined) downloadBytes(built.bytes, built.filename);
  }

  update(): void {
    const c = this.c;
    const main = this.root;
    if (c.documentId !== undefined) main.setAttribute("data-document-id", c.documentId);
    if (c.replicaId !== undefined) main.setAttribute("data-replica-id", c.replicaId);
    this.titleId.textContent = c.documentId ?? "";
    this.metaEl.textContent = `This device: ${(c.replicaId ?? "").slice(0, 8)} · ${c.restored ? "Restored saved data" : "New on this device"}`;

    // save indicator (from actual session state only)
    const l = saveLabel(c.save.state, c.save.info);
    this.saveEl.textContent = `${l.symbol} ${l.label}`;
    this.saveEl.setAttribute("data-save-state", c.save.state);
    this.saveEl.setAttribute("data-save-sequence", String(c.save.info.sequence));
    // "Nothing to save yet" (saved state, nothing written) is neutral; green is reserved for a real save.
    const tone =
      c.save.state === "saved"
        ? c.save.info.sequence > 0
          ? "ok"
          : "neutral"
        : c.save.state === "error"
          ? "bad"
          : c.save.state === "saving"
            ? "info"
            : "warn";
    this.saveEl.className = `gs-save gs-save--${tone}`;
    this.savedHelp.textContent =
      c.save.state === "saved" && c.save.info.sequence > 0
        ? "Your latest changes are stored on this device."
        : c.save.state === "error"
          ? "Not stored yet. See the message below for what to do."
          : c.save.state === "saved"
            ? "Nothing to store yet. Changes are stored on this device as you work."
            : "Storing your latest changes on this device...";

    this.renderAlert();
    this.renderEditError();
    this.renderRecovery();
    this.renderImport();
    const paused = c.phase !== "ready";
    this.pausedNote.hidden = !paused;
    this.importInput.setAttribute("aria-describedby", paused ? "import-help import-trust paused-note" : "import-help import-trust");
    this.newItem.setAttribute("aria-describedby", paused ? "new-item-help paused-note" : "new-item-help");
    this.importInput.disabled = c.importView?.state === "importing" || c.phase !== "ready";
    if (c.importView?.state !== "importing" && this.importInput.value !== "" && c.importView !== undefined) {
      this.importInput.value = "";
    }
    const m = c.model;
    if (m === undefined) return;
    this.renderDetails(m.incident);
    this.renderList(m);
    this.resyncFocused = false;
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
        h("p", { class: "gs-help-text" }, "What to do next: keep this page open and try the save again. If it keeps failing, download a backup capsule so your work is not lost. The last readable incident log stays visible below."),
        h("button", { type: "button", class: "gs-btn--primary", onclick: () => void this.c.retrySave() }, "Retry save"),
        h("button", { type: "button", onclick: () => void this.download("backup") }, "Download backup capsule"),
      ),
    );
  }

  /** Failed edit in the ready workspace. Rebuilt only when the error changes, so button focus survives updates. */
  private renderEditError(): void {
    const e = this.c.editError;
    if (e === this.shownEditError) return;
    const hadFocus = this.editErrorHost.contains(document.activeElement);
    this.shownEditError = e;
    if (e !== undefined) this.resyncFocused = true;
    clear(this.editErrorHost);
    if (e === undefined) {
      if (hadFocus) (this.fields.title ?? this.newItem).focus();
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
        e.kind === "schema-mismatch"
          ? h("button", { type: "button", onclick: () => location.reload() }, "Reload app")
          : null,
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
        h(
          "p",
          { class: "gs-help-text", id: "recovery-help" },
          "Download backup capsule saves a file with the changes that are still on screen. Discard unsaved changes and switch gives up those changes and opens the incident chooser. Download the backup first if you want to keep them.",
        ),
        h("button", { type: "button", class: "gs-btn--primary", "aria-describedby": "recovery-help", onclick: () => void this.download("backup") }, "Download backup capsule"),
        h("button", { type: "button", class: "gs-btn--danger", "aria-describedby": "recovery-help", onclick: () => void this.c.discardAndSwitch() }, "Discard unsaved changes and switch"),
      ),
    );
  }

  private renderImport(): void {
    const v = this.c.importView;
    clear(this.importResult);
    clear(this.mergeSummary);
    this.mergeSummary.removeAttribute("data-result");
    this.importResult.removeAttribute("data-import-state");
    this.importResult.removeAttribute("data-import-code");
    if (v === undefined) return;
    this.importResult.setAttribute("data-import-state", v.state);
    if (v.code !== undefined) this.importResult.setAttribute("data-import-code", v.code);
    this.importResult.append(h("p", {}, v.message));
    const next =
      v.state === "importing"
        ? "Checking the capsule and combining its changes. Please wait."
        : v.state === "applied-saved"
          ? "What happened: the capsule passed its checks and its changes were added. Nothing else is needed."
          : v.state === "applied-unsaved"
            ? "What happened: the changes are visible but not stored yet. What to do: use Retry save above, or download a backup capsule."
            : "What happened: the capsule did not pass its checks, so it was not added. What to do: choose a different capsule file.";
    this.importResult.append(h("p", { class: "gs-help-text" }, next));
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
      for (const line of describeDiff(v.diff)) ul.append(h("li", {}, line));
      const saved = v.state === "applied-saved";
      this.mergeSummary.setAttribute("data-result", saved ? "saved" : "unsaved");
      this.mergeSummary.append(
        h("p", { class: "gs-result-headline" }, importHeadline(countModelDiff(v.diff))),
        h("p", { class: "gs-result-state" }, saved ? "Saved on this device." : "Not saved to this device yet. Use Retry save."),
        h("h3", {}, "What changed"),
        ul,
      );
    }
  }

  private renderDetails(incident: NonNullable<SessionController["model"]>["incident"]): void {
    const editable = this.c.phase === "ready";
    // The create form is built once while the incident stays absent, so a typed title and focus survive re-renders.
    if (incident.kind === "absent" && this.createTitle?.isConnected === true && this.createBtn !== undefined) {
      this.createBtn.disabled = !editable;
      return;
    }
    this.createTitle = undefined;
    this.createBtn = undefined;
    if (incident.kind !== "ok") {
      this.detailsBuilt = false;
      this.fields = {};
      clear(this.detailsHost);
      this.detailsHost.append(h("h2", { id: "details-h", class: "gs-panel-title" }, "Incident details"));
      if (incident.kind === "absent") {
        this.createTitle = h("input", { id: "create-title", type: "text", maxlength: String(LIMITS.title), autocomplete: "off", "aria-describedby": "create-help" });
        const t = this.createTitle;
        const btn = h("button", { type: "submit", class: "gs-btn--primary", disabled: !editable }, "Create incident details");
        this.createBtn = btn;
        this.detailsHost.append(
          h(
            "form",
            {
              class: "fl-create",
              onsubmit: (e: Event) => {
                e.preventDefault();
                this.c.createIncidentDetails(t.value.trim());
              },
            },
            h("p", { id: "create-help", class: "gs-help-text" }, "This incident has no details yet. Name it to start the record; you can add the location, severity and notes afterwards."),
            h("label", { for: "create-title", class: "fl-label" }, "Title"),
            h("div", { class: "fl-add" }, t, btn),
          ),
        );
      } else {
        const preview = Object.entries(incident.fields).map(([k, v]) => `${truncate(k)}: ${truncate(String(v))}`).join("; ");
        this.detailsHost.append(
          h(
            "div",
            { "data-testid": "incident-invalid", class: "alert" },
            h("p", {}, "Conflicted or incomplete incident details"),
            h("p", { class: "fl-raw" }, preview),
            h(
              "p",
              { class: "gs-help-text", id: "invalid-details-help" },
              "Restore keeps the fields that could be read and lets you edit them again. Discard removes these details so you can start a new record.",
            ),
            h("button", { type: "button", "aria-describedby": "invalid-details-help", onclick: () => this.c.restoreInvalidIncident() }, "Restore"),
            h("button", { type: "button", class: "gs-btn--danger", "aria-describedby": "invalid-details-help", onclick: () => this.c.discardInvalidIncident() }, "Discard"),
          ),
        );
      }
      return;
    }
    if (!this.detailsBuilt) {
      this.detailsBuilt = true;
      clear(this.detailsHost);
      this.detailsHost.append(h("h2", { id: "details-h", class: "gs-panel-title" }, "Incident details"));
      const grid = h("div", { class: "fl-fields" });
      this.detailsHost.append(grid);
      const text = (field: "title" | "location", label: string, max: number, help: string): void => {
        const el = h("input", {
          id: `f-${field}`,
          type: "text",
          maxlength: String(max),
          autocomplete: "off",
          "aria-describedby": `f-${field}-help`,
          onchange: () => this.c.setIncidentField(field, el.value),
        });
        this.fields[field] = el;
        grid.append(h("div", { class: `fl-field fl-field--${field}` }, h("label", { for: `f-${field}`, class: "fl-label" }, label), el, h("p", { id: `f-${field}-help`, class: "gs-help-text" }, help)));
      };
      text("title", "Title", LIMITS.title, "A short name everyone will recognise.");
      text("location", "Location", LIMITS.location, "Where the incident is happening.");
      const select = (field: "severity" | "status", label: string, options: readonly string[], help: string): void => {
        const el = h(
          "select",
          { id: `f-${field}`, "aria-describedby": `f-${field}-help`, onchange: () => this.c.setIncidentField(field, el.value as never) },
          ...options.map((o) => h("option", { value: o }, o)),
        );
        this.fields[field] = el;
        grid.append(h("div", { class: "fl-field" }, h("label", { for: `f-${field}`, class: "fl-label" }, label), el, h("p", { id: `f-${field}-help`, class: "gs-help-text" }, help)));
      };
      select("severity", "Severity", SEVERITIES, "How urgent it is.");
      select("status", "Status", STATUSES, "Where the work stands.");
      const notes = h("textarea", {
        id: "f-notes",
        rows: "3",
        maxlength: String(LIMITS.notes),
        "aria-describedby": "f-notes-help",
        onchange: () => this.c.setIncidentField("notes", notes.value),
      });
      this.fields.notes = notes;
      grid.append(h("div", { class: "fl-field fl-field--notes" }, h("label", { for: "f-notes", class: "fl-label" }, "Notes"), notes, h("p", { id: "f-notes-help", class: "gs-help-text" }, "Anything the next person should know.")));
    }
    for (const key of ["title", "location", "severity", "status", "notes"] as const) {
      const el = this.fields[key];
      if (el === undefined) continue;
      el.disabled = !editable;
      // Never overwrite a field the user is editing right now.
      if ((this.resyncFocused || document.activeElement !== el) && el.value !== incident.value[key]) el.value = incident.value[key];
    }
  }

  private renderList(m: NonNullable<SessionController["model"]>): void {
    const editable = this.c.phase === "ready";
    const wanted = m.items.map(([id]) => id);
    const seen = new Set(wanted);
    for (const [id, row] of this.rows) {
      if (!seen.has(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    }
    // Invalid rows live in the same <ol> after valid ones.
    const invalidIds = m.invalid.map((r) => r.id);
    for (const [id, row] of [...this.rows]) {
      if (row.kind === "invalid" && !invalidIds.includes(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    }
    this.emptyEl.hidden = m.items.length + m.invalid.length > 0;
    const doneCount = m.items.filter(([, item]) => item.done).length;
    this.progressText.textContent = m.items.length === 0 ? "No items yet" : `${doneCount} of ${m.items.length} done`;
    this.progressBar.max = Math.max(1, m.items.length);
    this.progressBar.value = doneCount;
    let prev: Element | null = null;
    for (const [id, item] of m.items) {
      let row = this.rows.get(id);
      if (row === undefined || row.kind !== "valid") {
        row?.el.remove();
        row = this.buildRow(id);
        this.rows.set(id, row);
      }
      row.fill(item.text, item.done, editable, this.resyncFocused);
      if (prev === null ? this.listEl.firstElementChild !== row.el : prev.nextElementSibling !== row.el) {
        // Keep focus when reordering: re-insert only when the position differs.
        const active = document.activeElement;
        this.listEl.insertBefore(row.el, prev === null ? this.listEl.firstElementChild : prev.nextElementSibling);
        if (active instanceof HTMLElement && row.el.contains(active)) active.focus();
      }
      prev = row.el;
    }
    for (const inv of m.invalid) {
      let row = this.rows.get(inv.id);
      if (row === undefined || row.kind !== "invalid") {
        row?.el.remove();
        row = this.buildInvalidRow(inv.id);
        this.rows.set(inv.id, row);
      }
      row.preview(Object.entries(inv.fields).map(([k, v]) => `${truncate(k)}: ${truncate(String(v))}`).join("; "), editable);
      if (prev === null ? this.listEl.firstElementChild !== row.el : prev.nextElementSibling !== row.el) {
        this.listEl.insertBefore(row.el, prev === null ? this.listEl.firstElementChild : prev.nextElementSibling);
      }
      prev = row.el;
    }
  }

  private buildRow(id: string): Row {
    const text = h("input", { type: "text", "aria-label": "Item text", maxlength: String(LIMITS.itemText), autocomplete: "off" });
    const done = h("input", { type: "checkbox", "aria-label": "Done" });
    const up = h("button", { type: "button" }, "Move up");
    const down = h("button", { type: "button" }, "Move down");
    const del = h("button", { type: "button" }, "Delete item");
    const stateEl = h("span", { class: "fl-record-state" });
    // Full title, wrapped, for titles too long to read in the single-line field. Hidden from assistive tech: the field is the control.
    const fullEl = h("span", { class: "fl-record-full", "aria-hidden": "true" });
    const el = h("li", { "data-item-id": id, class: "fl-record" }, done, text, stateEl, fullEl, up, down, del);
    let committed = "";
    text.addEventListener("change", () => {
      const v = text.value.trim();
      if (v.length === 0 || v.length > LIMITS.itemText) {
        text.value = committed;
        return;
      }
      this.c.setItemField(id, "text", v);
    });
    done.addEventListener("change", () => this.c.setItemField(id, "done", done.checked));
    up.addEventListener("click", () => this.c.move(id, -1));
    down.addEventListener("click", () => this.c.move(id, 1));
    del.addEventListener("click", () => this.c.deleteItem(id));
    return {
      kind: "valid",
      el,
      fill: (t, d, editable, force) => {
        committed = t;
        if ((force || document.activeElement !== text) && text.value !== t) text.value = t;
        done.checked = d;
        el.setAttribute("data-done", d ? "true" : "false");
        stateEl.textContent = d ? "Completed" : "Open";
        fullEl.textContent = t;
        el.setAttribute("data-length", t.length > LONG_TITLE ? "xlong" : t.length > SHORT_TITLE ? "long" : "short");
        done.setAttribute("aria-label", `Done: ${t}`);
        up.setAttribute("aria-label", `Move up: ${t}`);
        down.setAttribute("aria-label", `Move down: ${t}`);
        del.setAttribute("aria-label", `Delete item: ${t}`);
        for (const b of [text, done, up, down, del]) b.disabled = !editable;
      },
      preview: () => undefined,
    };
  }

  private buildInvalidRow(id: string): Row {
    const p = h("span", { class: "invalid-preview" });
    const helpId = `inv-help-${id.replace(/[^\w-]/g, "_")}`;
    const restore = h("button", { type: "button", "aria-describedby": helpId }, "Restore");
    const discard = h("button", { type: "button", class: "gs-btn--danger", "aria-describedby": helpId }, "Discard");
    restore.addEventListener("click", () => this.c.restoreInvalidItem(id));
    discard.addEventListener("click", () => this.c.deleteItem(id));
    const el = h(
      "li",
      { "data-item-id": id, "data-invalid": "true", class: "invalid fl-record" },
      h("strong", {}, "Conflicted or incomplete item"),
      " ",
      p,
      h("span", { class: "gs-help-text fl-invalid-help", id: helpId }, "Restore keeps the readable text as a normal, unchecked item. Discard removes this record from the checklist."),
      restore,
      discard,
    );
    return {
      kind: "invalid",
      el,
      fill: () => undefined,
      preview: (t, editable) => {
        p.textContent = t;
        restore.disabled = !editable;
        discard.disabled = !editable;
      },
    };
  }
}

interface Row {
  readonly kind: "valid" | "invalid";
  readonly el: HTMLElement;
  fill(text: string, done: boolean, editable: boolean, force?: boolean): void;
  preview(text: string, editable: boolean): void;
}
