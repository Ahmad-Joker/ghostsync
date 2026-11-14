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
import { clear, h } from "./h.js";

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
  private readonly offlineEl = h("p", { "data-testid": "offline-indicator" });
  private readonly networkEl = h("span", { "data-testid": "network-chip" });
  private readonly noticeEl = h("p", { "data-testid": "first-visit-notice" });
  private readonly bannerEl = h("div", { "data-testid": "update-banner", hidden: true });
  private readonly announcer = h("div", { id: "save-announcer", role: "status", "aria-live": "polite", "aria-atomic": "true", class: "sr-only" });
  private readonly view = h("div", { id: "view" });
  private ws: Workspace | undefined;
  private joinInput: HTMLInputElement | undefined;
  private joinPreview: HTMLElement | undefined;
  private joinError: HTMLElement | undefined;
  private lastAnnounced = "";
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
    this.root.append(h("h1", {}, "FieldLedger"), this.status, this.announcer, this.view);
    const net = (): void => {
      this.networkEl.textContent = navigator.onLine ? "Network: online" : "Network: offline";
    };
    net();
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.c.onPageHide();
    });
    window.addEventListener("pagehide", () => this.c.onPageHide());
    this.renderOffline();
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
    this.noticeEl.textContent = FIRST_VISIT_NOTICE;
    this.noticeEl.hidden = !showFirstVisitNotice(s.state);
    clear(this.bannerEl);
    if (s.state === "waiting") {
      this.bannerEl.hidden = false;
      this.bannerEl.append(
        h("span", {}, "A new version is ready. Save your work, then update. "),
        h("button", { type: "button", onclick: () => void this.updateNow() }, "Update now"),
      );
    } else {
      this.bannerEl.hidden = true;
    }
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
      spellcheck: "false",
      "aria-describedby": "incident-rules incident-preview incident-error",
      oninput: () => {
        if (this.joinPreview !== undefined) this.joinPreview.textContent = previewDocumentId(input.value);
      },
    });
    this.joinInput = input;
    this.joinPreview = h("p", { id: "incident-preview" });
    this.joinError = h("p", { id: "incident-error", role: "alert", class: "error-text" });
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
      h("h2", {}, "Open a shared incident"),
      h("label", { for: "incident-id" }, "Incident ID"),
      input,
      h("p", { id: "incident-rules" }, `Both inspectors type the same ID. ${DOCUMENT_ID_RULES}`),
      this.joinPreview,
      this.joinError,
      h("button", { type: "submit" }, "Open incident"),
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
        retry
          ? h("button", { type: "button", onclick: () => void this.c.open(this.c.documentId ?? "") }, "Try again")
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
  private readonly detailsHost = h("section", { "aria-labelledby": "details-h" });
  private readonly listEl = h("ol", { "data-testid": "checklist" });
  private readonly invalidHost = h("div");
  private readonly importResult = h("div", { "data-testid": "import-result", role: "status", "aria-live": "polite" });
  private readonly mergeSummary = h("div", { "data-testid": "merge-summary" });
  private readonly importInput: HTMLInputElement;
  private readonly recoveryHost = h("div");
  private readonly idLine = h("p");
  private readonly newItem: HTMLInputElement;
  private readonly rows = new Map<string, Row>();
  private detailsBuilt = false;
  /** Set when an edit just failed: redraw fields from the last good model even if one is focused (the draft was not applied). */
  private resyncFocused = false;
  private fields: Partial<Record<keyof IncidentDetails, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>> = {};
  private createTitle: HTMLInputElement | undefined;

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
        class: "row",
        onsubmit: (e: Event) => {
          e.preventDefault();
          const text = this.newItem.value.trim();
          if (text.length === 0) return;
          this.c.addChecklistItem(text);
          this.newItem.value = "";
        },
      },
      h("label", { for: "new-item" }, "New checklist item"),
      this.newItem,
      h("button", { type: "submit" }, "Add item"),
    );
    this.root = h(
      "main",
      {},
      h(
        "header",
        { class: "row" },
        this.idLine,
        h("button", { type: "button", "data-testid": "change-incident", onclick: () => void this.c.changeIncident() }, "Change incident"),
      ),
      h("p", { class: "status-line" }, h("span", {}, "Save status: "), this.saveEl),
      this.alertHost,
      this.editErrorHost,
      this.recoveryHost,
      this.detailsHost,
      h("section", { "aria-labelledby": "list-h" }, h("h2", { id: "list-h" }, "Checklist"), addForm, this.listEl, this.invalidHost),
      h(
        "section",
        { "aria-labelledby": "transfer-h" },
        h("h2", { id: "transfer-h" }, "Transfer (file)"),
        h("p", {}, "Capsule files are integrity-checked (a checksum detects corruption). They are not authenticated: a checksum does not prove who sent a file."),
        h("button", { type: "button", id: "export-btn", onclick: () => void this.download("export") }, "Export capsule (.gscap)"),
        h("p", {}, h("label", { for: "import-file" }, "Import capsule (.gscap)"), this.importInput),
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
    if (c.documentId !== undefined) main.setAttribute("data-document-id", c.documentId);
    if (c.replicaId !== undefined) main.setAttribute("data-replica-id", c.replicaId);
    this.idLine.textContent = `Incident ${c.documentId ?? ""} · This device: ${(c.replicaId ?? "").slice(0, 8)} · ${c.restored ? "Restored saved data" : "New on this device"}`;

    // save indicator (from actual session state only)
    const l = saveLabel(c.save.state, c.save.info);
    this.saveEl.textContent = `${l.symbol} ${l.label}`;
    this.saveEl.setAttribute("data-save-state", c.save.state);
    this.saveEl.setAttribute("data-save-sequence", String(c.save.info.sequence));

    this.renderAlert();
    this.renderEditError();
    this.renderRecovery();
    this.renderImport();
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
        h("button", { type: "button", onclick: () => void this.c.retrySave() }, "Retry save"),
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
      for (const line of describeDiff(v.diff)) ul.append(h("li", {}, line));
      this.mergeSummary.append(h("h3", {}, "What changed"), ul);
    }
  }

  private renderDetails(incident: NonNullable<SessionController["model"]>["incident"]): void {
    const editable = this.c.phase === "ready";
    if (incident.kind !== "ok") {
      this.detailsBuilt = false;
      this.fields = {};
      clear(this.detailsHost);
      this.detailsHost.append(h("h2", { id: "details-h" }, "Incident details"));
      if (incident.kind === "absent") {
        this.createTitle = h("input", { id: "create-title", type: "text", maxlength: String(LIMITS.title), autocomplete: "off" });
        const t = this.createTitle;
        this.detailsHost.append(
          h(
            "form",
            {
              class: "row",
              onsubmit: (e: Event) => {
                e.preventDefault();
                this.c.createIncidentDetails(t.value.trim());
              },
            },
            h("label", { for: "create-title" }, "Title"),
            t,
            h("button", { type: "submit", disabled: !editable }, "Create incident details"),
          ),
        );
      } else {
        const preview = Object.entries(incident.fields).map(([k, v]) => `${truncate(k)}: ${truncate(String(v))}`).join("; ");
        this.detailsHost.append(
          h(
            "div",
            { "data-testid": "incident-invalid", class: "alert" },
            h("p", {}, "Conflicted or incomplete incident details"),
            h("p", {}, preview),
            h("button", { type: "button", onclick: () => this.c.restoreInvalidIncident() }, "Restore"),
            h("button", { type: "button", onclick: () => this.c.discardInvalidIncident() }, "Discard"),
          ),
        );
      }
      return;
    }
    if (!this.detailsBuilt) {
      this.detailsBuilt = true;
      clear(this.detailsHost);
      this.detailsHost.append(h("h2", { id: "details-h" }, "Incident details"));
      const text = (field: "title" | "location", label: string, max: number): void => {
        const el = h("input", {
          id: `f-${field}`,
          type: "text",
          maxlength: String(max),
          autocomplete: "off",
          onchange: () => this.c.setIncidentField(field, el.value),
        });
        this.fields[field] = el;
        this.detailsHost.append(h("p", {}, h("label", { for: `f-${field}` }, label), el));
      };
      text("title", "Title", LIMITS.title);
      text("location", "Location", LIMITS.location);
      const select = (field: "severity" | "status", label: string, options: readonly string[]): void => {
        const el = h(
          "select",
          { id: `f-${field}`, onchange: () => this.c.setIncidentField(field, el.value as never) },
          ...options.map((o) => h("option", { value: o }, o)),
        );
        this.fields[field] = el;
        this.detailsHost.append(h("p", {}, h("label", { for: `f-${field}` }, label), el));
      };
      select("severity", "Severity", SEVERITIES);
      select("status", "Status", STATUSES);
      const notes = h("textarea", {
        id: "f-notes",
        rows: "3",
        maxlength: String(LIMITS.notes),
        onchange: () => this.c.setIncidentField("notes", notes.value),
      });
      this.fields.notes = notes;
      this.detailsHost.append(h("p", {}, h("label", { for: "f-notes" }, "Notes"), notes));
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
    const el = h("li", { "data-item-id": id }, done, text, up, down, del);
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
    const restore = h("button", { type: "button" }, "Restore");
    const discard = h("button", { type: "button" }, "Discard");
    restore.addEventListener("click", () => this.c.restoreInvalidItem(id));
    discard.addEventListener("click", () => this.c.deleteItem(id));
    const el = h("li", { "data-item-id": id, "data-invalid": "true", class: "invalid" }, h("strong", {}, "Conflicted or incomplete item"), " ", p, " ", restore, discard);
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
