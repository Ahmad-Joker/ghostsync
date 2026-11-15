import { capMetaValue } from "../capsule-meta.js";
import { h } from "../../ui/h.js";
import { paintQr } from "@ghostsync/qr-transfer/browser";
import type { QrTransferController } from "./qr-controller.js";
import { DUPLICATE_SCOPE_NOTE, SHOW_TIP, TRUST_NOTE } from "./qr-errors.js";

/** The QR transfer block. Reads all state from the controller; owns no session or capsule state. */
export class QrView {
  readonly root: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly showPanel: HTMLElement;
  private readonly scanPanel: HTMLElement;
  private readonly showMessage: HTMLElement;
  private readonly scanMessage: HTMLElement;
  private readonly scanHint: HTMLElement;
  private readonly showBytes: HTMLElement;
  private readonly showVersion: HTMLElement;
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

  constructor(private readonly c: QrTransferController, private readonly availableWidth: () => number) {
    this.canvas = h("canvas", { "data-testid": "qr-canvas", "aria-label": "QR code carrying the capsule" });
    this.video = h("video", { "data-testid": "qr-video", "aria-label": "Camera preview", muted: true, playsinline: true });
    this.showMessage = h("p", { "data-testid": "qr-show-message" });
    this.scanMessage = h("p", { "data-testid": "qr-scan-message", role: "status", "aria-live": "polite" });
    this.scanHint = h("p", { "data-testid": "qr-scan-hint" });
    this.showBytes = h("dd", { "data-testid": "qr-show-bytes" });
    this.showVersion = h("dd", { "data-testid": "qr-show-version" });
    this.showChecksum = h("dd", { "data-testid": "qr-show-checksum" });
    this.metaApp = h("dd", { "data-testid": "qr-meta-app" });
    this.metaDoc = h("dd", { "data-testid": "qr-meta-document-id" });
    this.metaCreated = h("dd", { "data-testid": "qr-meta-created-at" });
    this.previewBytes = h("dd", { "data-testid": "qr-preview-bytes" });
    this.metaChecksum = h("dd", { "data-testid": "qr-meta-checksum" });
    this.showBtn = h("button", { type: "button", "data-testid": "qr-show-btn", onclick: () => void this.show() }, "Show QR code");
    this.hideBtn = h("button", { type: "button", "data-testid": "qr-hide-btn", onclick: () => this.c.hideQr() }, "Hide QR code");
    this.scanBtn = h("button", { type: "button", "data-testid": "qr-scan-btn", onclick: () => void this.c.startScan(this.video) }, "Scan QR code (camera)");
    this.cancelBtn = h("button", { type: "button", "data-testid": "qr-scan-cancel", onclick: () => this.c.cancelScan() }, "Cancel scan");
    this.importBtn = h("button", { type: "button", "data-testid": "qr-import-btn", onclick: () => void this.c.importScanned() }, "Import scanned capsule");
    this.discardBtn = h("button", { type: "button", "data-testid": "qr-discard-btn", onclick: () => this.c.discardScan() }, "Discard scan");
    this.rescanBtn = h("button", { type: "button", "data-testid": "qr-rescan-btn", onclick: () => void this.c.startScan(this.video) }, "Scan again");

    this.showPanel = h(
      "div",
      { "data-testid": "qr-show-panel" },
      this.canvas,
      h(
        "dl",
        {},
        h("dt", {}, "Capsule size (bytes)"),
        this.showBytes,
        h("dt", {}, "QR version"),
        this.showVersion,
        h("dt", {}, "Checksum (first 12)"),
        this.showChecksum,
      ),
      this.showMessage,
    );
    this.preview = h(
      "div",
      { "data-testid": "qr-preview" },
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
        h("dt", {}, "Checksum (first 12)"),
        this.metaChecksum,
      ),
    );
    this.scanPanel = h("div", { "data-testid": "qr-scan-panel" }, this.video, this.scanMessage, this.scanHint, this.preview);

    this.root = h(
      "section",
      { "aria-labelledby": "qr-h", "data-testid": "qr-transfer", onkeydown: (e: Event) => this.onKeyDown(e as KeyboardEvent) },
      h("h3", { id: "qr-h" }, "QR transfer"),
      h("p", {}, TRUST_NOTE),
      h("p", { "data-testid": "qr-duplicate-note" }, DUPLICATE_SCOPE_NOTE),
      h("p", {}, SHOW_TIP),
      h("div", { class: "row" }, this.showBtn, this.hideBtn),
      this.showPanel,
      h("div", { class: "row" }, this.scanBtn, this.cancelBtn, this.importBtn, this.discardBtn, this.rescanBtn),
      this.scanPanel,
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
      this.showChecksum.textContent = shown.checksum;
    } else {
      this.canvas.hidden = true;
    }

    // Scan panel.
    const active = c.scanActive;
    this.video.hidden = !active;
    this.scanBtn.disabled = c.scanDisabled;
    this.cancelBtn.hidden = !active;
    this.importBtn.hidden = c.scanState !== "scanned";
    this.discardBtn.hidden = c.scanState !== "scanned";
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
