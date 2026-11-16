import { capMetaValue } from "../capsule-meta.js";
import { h } from "../../ui/h.js";
import { paintQr } from "@ghostsync/qr-transfer/browser";
import type { QrTransferController } from "./qr-controller.js";
import { DUPLICATE_SCOPE_NOTE, SHOW_TIP, TRUST_NOTE, type QrScanPanelState } from "./qr-errors.js";

/** Plain-language label and tone for the scan state chip. Display only; the controller owns the state. */
const SCAN_STATE: Record<QrScanPanelState, { text: string; tone: "ok" | "warn" | "bad" | "info" }> = {
  idle: { text: "Camera is off", tone: "info" },
  requesting: { text: "Waiting for camera permission", tone: "warn" },
  scanning: { text: "Scanning for a QR code", tone: "info" },
  scanned: { text: "QR code read. Not imported yet", tone: "warn" },
  rejected: { text: "This code could not be used", tone: "bad" },
  importing: { text: "Importing changes", tone: "info" },
  imported: { text: "Changes imported and saved", tone: "ok" },
  "already-imported": { text: "Already imported. Nothing changed", tone: "info" },
  denied: { text: "Camera blocked", tone: "bad" },
  "no-camera": { text: "No camera found", tone: "bad" },
  "in-use": { text: "Camera is busy", tone: "bad" },
  insecure: { text: "Camera needs a secure page", tone: "bad" },
  unsupported: { text: "Camera not supported", tone: "bad" },
  failed: { text: "Camera failed", tone: "bad" },
  "timed-out": { text: "No code found in time", tone: "warn" },
};

/** The QR transfer block. Reads all state from the controller; owns no session or capsule state. */
export class QrView {
  readonly root: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly frame: HTMLElement;
  private readonly scanFrame: HTMLElement;
  private readonly instructions: HTMLElement;
  private readonly showPanel: HTMLElement;
  private readonly scanPanel: HTMLElement;
  private readonly showMessage: HTMLElement;
  private readonly scanMessage: HTMLElement;
  private readonly scanHint: HTMLElement;
  private readonly scanChip: HTMLElement;
  private readonly decision: HTMLElement;
  private readonly showBytes: HTMLElement;
  private readonly showVersion: HTMLElement;
  private readonly showDoc: HTMLElement;
  private readonly showChecksum: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly metaApp: HTMLElement;
  private readonly metaDoc: HTMLElement;
  private readonly metaCreated: HTMLElement;
  private readonly previewBytes: HTMLElement;
  private readonly metaChecksum: HTMLElement;
  private readonly showBtn: HTMLButtonElement;
  private readonly hideBtn: HTMLButtonElement;
  private readonly scanBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly discardBtn: HTMLButtonElement;
  private readonly rescanBtn: HTMLButtonElement;
  private readonly scanReason: HTMLElement;

  constructor(
    private readonly c: QrTransferController,
    private readonly availableWidth: () => number,
    private readonly documentId: () => string | undefined = () => undefined,
  ) {
    this.canvas = h("canvas", { "data-testid": "qr-canvas", "aria-label": "QR code carrying the capsule" });
    this.video = h("video", { "data-testid": "qr-video", "aria-label": "Camera preview", muted: true, playsinline: true });
    this.showMessage = h("p", { "data-testid": "qr-show-message" });
    this.scanMessage = h("p", { "data-testid": "qr-scan-message", role: "status", "aria-live": "polite" });
    this.scanHint = h("p", { "data-testid": "qr-scan-hint" });
    this.scanChip = h("p", { "data-testid": "qr-scan-state", class: "gs-chip gs-chip--icon gs-chip--info" });
    this.showBytes = h("dd", { "data-testid": "qr-show-bytes" });
    this.showVersion = h("dd", { "data-testid": "qr-show-version" });
    this.showDoc = h("dd", { "data-testid": "qr-show-document-id" });
    this.showChecksum = h("dd", { "data-testid": "qr-show-checksum" });
    this.metaApp = h("dd", { "data-testid": "qr-meta-app" });
    this.metaDoc = h("dd", { "data-testid": "qr-meta-document-id" });
    this.metaCreated = h("dd", { "data-testid": "qr-meta-created-at" });
    this.previewBytes = h("dd", { "data-testid": "qr-preview-bytes" });
    this.metaChecksum = h("dd", { "data-testid": "qr-meta-checksum" });
    this.showBtn = h("button", { type: "button", class: "gs-btn--primary", "data-testid": "qr-show-btn", onclick: () => void this.show() }, "Show QR code");
    this.hideBtn = h("button", { type: "button", "data-testid": "qr-hide-btn", onclick: () => this.c.hideQr() }, "Hide QR code");
    this.scanReason = h("p", { id: "qr-scan-reason", class: "gs-help-text" });
    this.scanBtn = h(
      "button",
      { type: "button", class: "gs-btn--primary", "data-testid": "qr-scan-btn", "aria-describedby": "qr-scan-reason", onclick: () => void this.c.startScan(this.video) },
      "Scan QR code (camera)",
    );
    this.cancelBtn = h("button", { type: "button", "data-testid": "qr-scan-cancel", onclick: () => this.c.cancelScan() }, "Cancel scan");
    this.importBtn = h("button", { type: "button", class: "gs-btn--primary", "data-testid": "qr-import-btn", onclick: () => void this.c.importScanned() }, "Import scanned capsule");
    this.discardBtn = h("button", { type: "button", class: "gs-btn--danger", "data-testid": "qr-discard-btn", onclick: () => this.c.discardScan() }, "Discard scan");
    this.rescanBtn = h("button", { type: "button", "data-testid": "qr-rescan-btn", onclick: () => void this.c.startScan(this.video) }, "Scan again");

    this.frame = h("div", { class: "gs-qr-frame pb-qr-frame" }, this.canvas);
    this.instructions = h(
      "div",
      { class: "pb-qr-steps" },
      h("h5", {}, "On the receiving device"),
      h(
        "ol",
        { class: "pb-seq" },
        h("li", {}, "Open PatchBoard and join the same board."),
        h("li", {}, "Choose Scan QR code (camera) and point it at this screen."),
        h("li", {}, "Check the capsule details, then choose Import scanned capsule."),
      ),
      h("p", { class: "gs-help-text" }, SHOW_TIP),
    );
    this.showPanel = h(
      "div",
      { "data-testid": "qr-show-panel", class: "pb-portal-panel" },
      this.frame,
      h(
        "dl",
        {},
        h("dt", {}, "Capsule size (bytes)"),
        this.showBytes,
        h("dt", {}, "QR version"),
        this.showVersion,
        h("dt", {}, "Document"),
        this.showDoc,
      ),
      this.showMessage,
      this.instructions,
    );
    this.preview = h(
      "div",
      { "data-testid": "qr-preview", class: "pb-preview" },
      h("h5", {}, "Capsule found. Not imported yet"),
      h("p", { class: "gs-help-text" }, "Import: Review the capsule first, then choose whether to add its changes."),
      h(
        "dl",
        {},
        h("dt", {}, "Capsule app"),
        this.metaApp,
        h("dt", {}, "Document"),
        this.metaDoc,
        h("dt", {}, "Created"),
        this.metaCreated,
        h("dt", {}, "Size (bytes)"),
        this.previewBytes,
      ),
      h("details", { class: "gs-learn" }, h("summary", {}, "Learn more: technical details"), h("dl", {}, h("dt", {}, "Checksum (first 12)"), this.metaChecksum)),
    );
    this.decision = h(
      "div",
      { class: "pb-decision" },
      h("p", { class: "gs-help-text" }, "Import adds this capsule's changes to your board. Discard throws the scan away and changes nothing."),
      h("div", { class: "actions" }, this.importBtn, this.discardBtn),
    );
    this.scanFrame = h("div", { class: "gs-scan-frame pb-scan-frame" }, this.video);
    this.scanPanel = h(
      "div",
      { "data-testid": "qr-scan-panel", class: "pb-portal-panel" },
      this.scanFrame,
      this.scanChip,
      this.scanMessage,
      this.scanHint,
      this.preview,
      this.decision,
    );

    this.root = h(
      "section",
      { "aria-labelledby": "qr-h", "data-testid": "qr-transfer", class: "pb-card pb-qr", onkeydown: (e: Event) => this.onKeyDown(e as KeyboardEvent) },
      h("h3", { id: "qr-h" }, "QR transfer"),
      h("p", {}, "Show this code to another device to transfer changes without internet."),
      h("p", { class: "gs-help-text" }, "Best for small capsules. If the code does not fit or will not scan, use File transfer above: it always works."),
      h("h4", {}, "Show a code"),
      h("div", { class: "row pb-qr-actions" }, this.showBtn, this.hideBtn),
      this.showPanel,
      h("h4", {}, "Scan a code"),
      h("p", { class: "gs-help-text" }, "Scanning reads the capsule but does NOT import it. You review its details first, then choose Import or Discard."),
      h("div", { class: "row pb-qr-actions" }, this.scanBtn, this.cancelBtn, this.rescanBtn),
      this.scanReason,
      this.scanPanel,
      h(
        "details",
        { class: "gs-learn" },
        h("summary", {}, "Learn more: technical details"),
        h("dl", {}, h("dt", {}, "Shown code checksum (first 12)"), this.showChecksum),
        h("p", {}, "The checksum detects damaged data. It does not prove who created or sent the capsule."),
        h("p", {}, TRUST_NOTE),
        h("p", { "data-testid": "qr-duplicate-note" }, DUPLICATE_SCOPE_NOTE),
      ),
    );
  }

  private async show(): Promise<void> {
    await this.c.showQr(this.availableWidth());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.c.scanActive) {
      e.preventDefault();
      this.c.cancelScan();
    }
  }

  update(): void {
    const c = this.c;
    this.showPanel.setAttribute("data-qr-state", c.showState);
    this.scanPanel.setAttribute("data-qr-state", c.scanState);
    this.showMessage.textContent = c.showMessage;
    this.scanMessage.textContent = c.scanMessage;
    this.scanHint.textContent = c.hintText;
    const chip = SCAN_STATE[c.scanState];
    this.scanChip.textContent = chip.text;
    this.scanChip.className = `gs-chip gs-chip--icon gs-chip--${chip.tone}`;

    // Show panel.
    this.hideBtn.hidden = c.showState === "idle";
    const shown = c.shown;
    if (c.showState === "ready" && shown !== undefined) {
      this.canvas.hidden = false;
      paintQr(this.canvas, shown.symbol, shown.scale);
      this.canvas.setAttribute("data-qr-version", String(shown.symbol.version));
      this.canvas.setAttribute("data-qr-modules", String(shown.symbol.size));
      this.canvas.setAttribute("data-qr-scale", String(shown.scale));
      this.canvas.setAttribute("data-qr-bytes", String(shown.bytes));
      this.showBytes.textContent = String(shown.bytes);
      this.showVersion.textContent = String(shown.symbol.version);
      this.showDoc.textContent = capMetaValue(this.documentId() ?? "");
      this.showChecksum.textContent = shown.checksum;
    } else {
      this.canvas.hidden = true;
    }
    this.frame.hidden = this.canvas.hidden;
    this.instructions.hidden = this.canvas.hidden;

    // Scan panel.
    const active = c.scanActive;
    this.video.hidden = !active;
    this.scanFrame.hidden = !active;
    this.scanBtn.disabled = c.scanDisabled;
    this.scanReason.textContent = c.scanDisabled
      ? "Scanning is paused while an import finishes or the camera is in use."
      : "Needs camera permission. If the camera is unavailable, use File transfer instead.";
    this.cancelBtn.hidden = !active;
    this.importBtn.hidden = c.scanState !== "scanned";
    this.discardBtn.hidden = c.scanState !== "scanned";
    this.decision.hidden = c.scanState !== "scanned";
    this.rescanBtn.hidden = c.scanState !== "imported" && c.scanState !== "already-imported";

    const p = c.preview;
    const showPreview = p !== undefined && (c.scanState === "scanned" || c.scanState === "already-imported");
    this.preview.hidden = !showPreview;
    if (p !== undefined) {
      this.metaApp.textContent = capMetaValue(p.metadata.app);
      this.metaDoc.textContent = capMetaValue(p.metadata.documentId);
      this.metaCreated.textContent = capMetaValue(p.metadata.createdAt);
      this.previewBytes.textContent = String(p.bytes);
      this.metaChecksum.textContent = p.metadata.sha256.slice(0, 12);
    }

    const focus = c.takeFocus();
    if (focus === "import") this.importBtn.focus();
    else if (focus === "scan") this.scanBtn.focus();
    else if (focus === "show") this.showBtn.focus();
  }
}
