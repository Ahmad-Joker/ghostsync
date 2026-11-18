import { capMetaValue } from "../capsule-meta.js";
import { h } from "../../ui/h.js";
import { icon, type SymbolId } from "../../ui/icon.js";
import { qrStepsView, stepState, type StepState } from "../../ui/qr-steps.js";
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

const STEP_STATE_TEXT: Record<StepState, string> = { pending: "Waiting", current: "Now", done: "Done", error: "Problem" };
const STEPS: ReadonlyArray<{ n: 1 | 2 | 3; key: "scan" | "review" | "import"; label: string; symbol: SymbolId }> = [
  { n: 1, key: "scan", label: "Scan", symbol: "gs-courier-step-scan" },
  { n: 2, key: "review", label: "Review", symbol: "gs-courier-step-review" },
  { n: 3, key: "import", label: "Import", symbol: "gs-courier-step-import" },
];

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
  private readonly reviewHeading: HTMLElement;
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
  private readonly fileBtn: HTMLButtonElement;
  private readonly scanBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly importBtn: HTMLButtonElement;
  private readonly discardBtn: HTMLButtonElement;
  private readonly rescanBtn: HTMLButtonElement;
  private readonly scanReason: HTMLElement;
  private readonly stepsList: HTMLElement;
  private readonly stepItems = new Map<string, { li: HTMLElement; state: HTMLElement }>();
  private readonly reviewBoard: HTMLElement = h("strong", { "data-testid": "qr-review-board" });

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
    this.metaChecksum = h("dd", { "data-testid": "qr-meta-checksum" });
    this.showBtn = h("button", { type: "button", class: "gs-btn--primary", "data-testid": "qr-show-btn", onclick: () => void this.show() }, "Show QR code");
    this.hideBtn = h("button", { type: "button", "data-testid": "qr-hide-btn", onclick: () => this.c.hideQr() }, "Hide QR code");
    // Presentation only: when no code can be drawn, jump to the existing file export (same pattern as the Share and Import shortcuts).
    this.fileBtn = h(
      "button",
      {
        type: "button",
        "data-testid": "qr-file-instead",
        hidden: true,
        onclick: () => {
          const exp = document.getElementById("export-btn");
          exp?.scrollIntoView({ block: "center" });
          exp?.focus();
        },
      },
      "Go to file export",
    );
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
        h("li", {}, "Check the capsule details, then choose Import scanned capsule to apply it."),
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
      this.fileBtn,
      this.instructions,
    );
    // One review block: board, size, trust warning and the two actions together at the top; the rest lives under Details.
    this.reviewHeading = h("h5", { tabindex: "-1", "data-testid": "qr-review-heading" }, "Capsule found. Not imported yet");
    this.previewBytes = h("strong", { "data-testid": "qr-preview-bytes" });
    this.decision = h("div", { class: "actions pb-decision-actions" }, this.importBtn, this.discardBtn);
    this.preview = h(
      "div",
      { "data-testid": "qr-preview", class: "pb-preview pb-review" },
      this.reviewHeading,
      h("p", { class: "gs-help-text pb-review-note" }, "Scanning only previews this update. Nothing on your board has changed yet."),
      h("p", { class: "pb-review-board" }, "Board in this capsule: ", this.reviewBoard),
      h("p", { class: "pb-review-size" }, "Capsule size: ", this.previewBytes, " bytes"),
      h("p", { class: "gs-trust" }, "Only import capsules from people you trust: a scanned code does not prove who made it."),
      this.decision,
      h("p", { class: "gs-help-text pb-review-help" }, "Import scanned capsule applies these changes to your board. Discard scan throws the scan away and changes nothing."),
      h(
        "details",
        { class: "gs-learn pb-review-details" },
        h("summary", {}, "Details: app, created, checksum"),
        h(
          "dl",
          {},
          h("dt", {}, "Capsule app"),
          this.metaApp,
          h("dt", {}, "Document"),
          this.metaDoc,
          h("dt", {}, "Created"),
          this.metaCreated,
          h("dt", {}, "Checksum (first 12)"),
          this.metaChecksum,
        ),
        h("p", { class: "gs-help-text" }, "The checksum detects damaged data. It does not prove who created or sent the capsule."),
      ),
    );    this.scanFrame = h("div", { class: "gs-scan-frame pb-scan-frame" }, this.video);
    // Presentational mirror of the controller's scan state: Scan, Review, Import. Nothing here is focusable.
    this.stepsList = h("ol", { class: "pb-steps", "data-testid": "qr-steps", "aria-label": "Receiving steps" });
    for (const s of STEPS) {
      const state = h("span", { class: "pb-step-state" });
      const li = h("li", { "data-step": s.key }, icon(s.symbol), h("span", { class: "pb-step-label" }, s.label), state);
      this.stepItems.set(s.key, { li, state });
      this.stepsList.append(li);
    }
    this.scanPanel = h(
      "div",
      { "data-testid": "qr-scan-panel", class: "pb-portal-panel" },
      this.stepsList,
      this.scanFrame,
      this.scanChip,
      this.scanMessage,
      this.scanHint,
      this.preview,
    );

    this.root = h(
      "section",
      { "aria-labelledby": "qr-h", "data-testid": "qr-transfer", class: "gs-transfer-group pb-qr", onkeydown: (e: Event) => this.onKeyDown(e as KeyboardEvent) },
      h("h3", { id: "qr-h" }, "QR transfer"),
      h("p", { class: "gs-help-text" }, "Needs no internet. Best when the other device is nearby and the update is small. If the code does not fit or will not scan, use Download file and Import file above: a file always works."),
      h("h4", {}, "Show QR code"),
      h("p", { class: "gs-help-text" }, "Shows this board's changes as a QR code for the other device to scan."),
      h("div", { class: "pb-qr-actions" }, this.showBtn, this.hideBtn),
      this.showPanel,
      h("h4", {}, "Scan QR code"),
      h("p", { class: "gs-help-text" }, "Scanning only previews an update. You review its details first, then choose Import scanned capsule to apply it or Discard scan to drop it."),
      h("div", { class: "pb-qr-actions" }, this.scanBtn, this.cancelBtn, this.rescanBtn),
      this.scanReason,
      this.scanPanel,
      h(
        "details",
        { class: "gs-learn" },
        h("summary", {}, "Technical details: checksum and sender trust"),
        h("dl", {}, h("dt", {}, "Shown code checksum (first 12)"), this.showChecksum),
        h("p", {}, "The checksum detects damaged data. It does not prove who created or sent the capsule."),
        h("p", {}, TRUST_NOTE),
        h("p", { "data-testid": "qr-duplicate-note" }, DUPLICATE_SCOPE_NOTE),
      ),
    );
  }

  /**
   * Runs once per transition into review (the controller hands out its focus request once): bring the panel into view
   * and put keyboard focus on the review heading. Smooth scrolling only when the user has not asked for reduced motion.
   */
  private revealReview(): void {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.scanPanel.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    this.reviewHeading.focus({ preventScroll: true });
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
    const sv = qrStepsView(c.scanState);
    for (const s of STEPS) {
      const item = this.stepItems.get(s.key);
      if (item === undefined) continue;
      const st = stepState(sv, s.n);
      item.li.setAttribute("data-step-state", st);
      item.state.textContent = STEP_STATE_TEXT[st];
    }

    // Show panel.
    this.hideBtn.hidden = c.showState === "idle";
    this.fileBtn.hidden = c.showState !== "too-narrow" && c.showState !== "too-large";
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
      : "Needs camera permission. If the camera is unavailable, use Download file and Import file instead.";
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
      this.reviewBoard.textContent = capMetaValue(p.metadata.documentId);
      this.metaCreated.textContent = capMetaValue(p.metadata.createdAt);
      this.previewBytes.textContent = String(p.bytes);
      this.metaChecksum.textContent = p.metadata.sha256.slice(0, 12);
    }

    const focus = c.takeFocus();
    if (focus === "import") this.revealReview();
    else if (focus === "scan") this.scanBtn.focus();
    else if (focus === "show") this.showBtn.focus();
  }
}
