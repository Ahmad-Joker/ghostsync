import { isCapsuleError } from "@ghostsync/capsule";
import type { CapsuleMetadata, DecodedCapsule, DecodeCapsuleOptions } from "@ghostsync/capsule";
import { buildQrSymbol, encodeFrame, QR_MAX_CAPSULE_BYTES } from "@ghostsync/qr-transfer";
import type { QrSymbol, QrTransferErrorCode } from "@ghostsync/qr-transfer";
import type { ScanCallbacks, ScanSession, ScanState } from "@ghostsync/qr-transfer/browser";
import type { ImportSource, ImportView } from "../../session/session-controller.js";
import { mapCapsuleError } from "../../state/errors.js";
import {
  IMPORT_DID_NOT_RUN,
  IMPORT_WAITING_COPY,
  IMPORTED_COPY,
  IMPORTING_COPY,
  SCAN_COPY,
  SHOW_ERROR_COPY,
  TOO_NARROW_COPY,
  hintCopy,
  tooLargeCopy,
  type QrScanPanelState,
  type QrShowPanelState,
} from "./qr-errors.js";
import { transferMode, type TransferMode } from "./transfer-mode.js";

/** The part of SessionController the QR flow uses. Only public members. */
export interface QrSessionPort {
  readonly boardId: string | undefined;
  readonly importPending: boolean;
  readonly sessionGeneration: number;
  readonly importView: ImportView | undefined;
  buildCapsule(kind: "export"): Promise<{ bytes: Uint8Array } | undefined>;
  importBytes(bytes: Uint8Array, source: ImportSource, opts?: { sha256?: string }): Promise<boolean>;
  hasAppliedQr(sha256: string): boolean;
  onSessionEnd(listener: () => void): () => void;
  onImportStart(listener: (source: ImportSource) => void): () => void;
}

export interface QrControllerDeps {
  readonly createScan: (cb: ScanCallbacks) => ScanSession;
  readonly decodeCapsule: (bytes: Uint8Array, opts?: DecodeCapsuleOptions) => Promise<DecodedCapsule>;
  readonly chooseScale: (availableCssPx: number, symbol: QrSymbol) => number | undefined;
}

export interface HeldScan {
  readonly bytes: Uint8Array;
  readonly metadata: CapsuleMetadata;
}

export interface ShownCode {
  readonly symbol: QrSymbol;
  readonly scale: number;
  readonly bytes: number;
  readonly checksum: string;
}

export type QrFocus = "import" | "scan" | "show";

export const FILE_IMPORT_STOPPED_SCAN = "Scanning stopped because a file import started. Select Scan QR code (camera) again after it finishes.";

const CAMERA_STATES: ReadonlySet<ScanState> = new Set(["denied", "no-camera", "in-use", "insecure", "unsupported", "failed", "timed-out"]);

/**
 * QR show and scan flow. Holds the scan session, the held result and the panel state. Never parses capsule bytes itself
 * (decodeCapsule does) and never applies them (SessionController.importBytes does, through the Capsule import API).
 */
export class QrTransferController {
  scanState: QrScanPanelState = "idle";
  showState: QrShowPanelState = "idle";
  /** The scan panel message. Undefined means "the fixed copy for the state". */
  private scanMessageOverride: string | undefined;
  hint: QrTransferErrorCode | undefined;
  held: HeldScan | undefined;
  /** Shown after `scanned`; kept for already-imported and imported so the user can see what was read. */
  preview: { readonly metadata: CapsuleMetadata; readonly bytes: number } | undefined;
  shown: ShownCode | undefined;
  showMessage = "";
  private scan: ScanSession | undefined;
  private focus: QrFocus | undefined;
  /** Bumped on every reset or new scan/show request, so an old async result is dropped. */
  private epoch = 0;

  constructor(
    private readonly session: QrSessionPort,
    private readonly deps: QrControllerDeps,
    private readonly notify: () => void,
  ) {
    session.onSessionEnd(() => this.reset());
    session.onImportStart((source) => this.onImportStart(source));
  }

  get scanMessage(): string {
    if (this.scanMessageOverride !== undefined) return this.scanMessageOverride;
    const s = this.scanState;
    if (s === "idle" || s === "rejected") return "";
    if (s === "importing") return IMPORTING_COPY;
    if (s === "imported") return IMPORTED_COPY;
    return SCAN_COPY[s];
  }

  get hintText(): string {
    return this.hint === undefined || this.scanState !== "scanning" ? "" : hintCopy(this.hint);
  }

  get mode(): TransferMode {
    return transferMode(this.scanState, this.showState);
  }

  /** Scan is unavailable only while an import (file or QR) is pending. Never disabled for camera reasons. */
  get scanDisabled(): boolean {
    return this.scanState === "importing" || this.session.importPending;
  }

  get scanActive(): boolean {
    return this.scanState === "requesting" || this.scanState === "scanning";
  }

  takeFocus(): QrFocus | undefined {
    const f = this.focus;
    this.focus = undefined;
    return f;
  }

  // ---------------- show ----------------
  async showQr(availableCssPx: number): Promise<void> {
    if (this.session.boardId === undefined) return;
    const epoch = ++this.epoch;
    const gen = this.session.sessionGeneration;
    const stale = (): boolean => this.epoch !== epoch || this.session.sessionGeneration !== gen;
    let built: { bytes: Uint8Array } | undefined;
    try {
      built = await this.session.buildCapsule("export");
    } catch {
      built = undefined;
    }
    if (stale()) return;
    this.shown = undefined;
    if (built === undefined) {
      this.setShow("error", SHOW_ERROR_COPY);
      return;
    }
    const bytes = built.bytes;
    if (bytes.length > QR_MAX_CAPSULE_BYTES) {
      this.setShow("too-large", tooLargeCopy(bytes.length));
      return;
    }
    try {
      const symbol = buildQrSymbol(encodeFrame(bytes));
      const scale = this.deps.chooseScale(availableCssPx, symbol);
      if (scale === undefined) {
        this.setShow("too-narrow", TOO_NARROW_COPY);
        return;
      }
      const decoded = await this.deps.decodeCapsule(bytes);
      if (stale()) return;
      this.shown = { symbol, scale, bytes: bytes.length, checksum: decoded.metadata.sha256.slice(0, 12) };
      this.setShow("ready", "");
    } catch {
      if (stale()) return;
      this.setShow("error", SHOW_ERROR_COPY);
    }
  }

  hideQr(): void {
    this.epoch += 1;
    this.shown = undefined;
    this.showState = "idle";
    this.showMessage = "";
    this.focus = "show";
    this.notify();
  }

  private setShow(state: QrShowPanelState, message: string): void {
    this.showState = state;
    this.showMessage = message;
    this.notify();
  }

  // ---------------- scan ----------------
  async startScan(video: HTMLVideoElement): Promise<void> {
    if (this.session.boardId === undefined) return;
    if (this.scanDisabled || this.scanActive) return;
    const epoch = ++this.epoch;
    const gen = this.session.sessionGeneration;
    this.scan?.stop();
    this.held = undefined;
    this.preview = undefined;
    this.hint = undefined;
    this.scanMessageOverride = undefined;
    const scan = this.deps.createScan({
      onState: (s) => {
        if (this.scan !== scan || this.epoch !== epoch) return;
        this.onScanState(s);
      },
      onHint: (code) => {
        if (this.scan !== scan || this.epoch !== epoch) return;
        this.hint = code;
        this.notify();
      },
      onAccepted: (bytes) => {
        if (this.scan !== scan || this.epoch !== epoch) return;
        void this.onAccepted(bytes, epoch, gen);
      },
    });
    this.scan = scan;
    await scan.start(video);
  }

  private onScanState(s: ScanState): void {
    if (s === "requesting" || s === "scanning") {
      this.scanState = s;
    } else if (s === "idle") {
      this.scanState = "idle";
    } else if (CAMERA_STATES.has(s)) {
      this.scanState = s as QrScanPanelState;
      this.focus = "scan";
    }
    // "accepted" keeps the current state until the preview is decoded (onAccepted).
    this.notify();
  }

  private async onAccepted(bytes: Uint8Array, epoch: number, gen: number): Promise<void> {
    const stale = (): boolean => this.epoch !== epoch || this.session.sessionGeneration !== gen;
    let decoded: DecodedCapsule;
    try {
      decoded = await this.deps.decodeCapsule(bytes, { maxCapsuleBytes: QR_MAX_CAPSULE_BYTES });
    } catch (err) {
      if (stale()) return;
      const code = isCapsuleError(err) ? err.code : "TypeError";
      this.scanState = "rejected";
      this.scanMessageOverride = mapCapsuleError(code, { documentId: this.session.boardId ?? "" });
      this.focus = "scan";
      this.notify();
      return;
    }
    if (stale()) return;
    this.preview = { metadata: decoded.metadata, bytes: bytes.length };
    if (this.session.hasAppliedQr(decoded.metadata.sha256)) {
      this.scanState = "already-imported";
      this.focus = "scan";
    } else {
      this.held = { bytes, metadata: decoded.metadata };
      this.scanState = "scanned";
      this.focus = "import";
    }
    this.notify();
  }

  cancelScan(): void {
    if (!this.scanActive) return;
    this.epoch += 1;
    this.scan?.stop();
    this.scan = undefined;
    this.scanState = "idle";
    this.hint = undefined;
    this.focus = "scan";
    this.notify();
  }

  discardScan(): void {
    if (this.scanState !== "scanned") return;
    this.held = undefined;
    this.preview = undefined;
    this.scanState = "idle";
    this.scanMessageOverride = undefined;
    this.focus = "scan";
    this.notify();
  }

  /** The at-most-once core: every check and the consume happen before the first await. */
  async importScanned(): Promise<void> {
    const held = this.held;
    if (held === undefined || this.scanState !== "scanned") return;
    const sha256 = held.metadata.sha256;
    if (this.session.hasAppliedQr(sha256)) {
      this.held = undefined;
      this.scanState = "already-imported";
      this.scanMessageOverride = undefined;
      this.notify();
      return;
    }
    if (this.session.importPending) {
      // Nothing is consumed: the held capsule stays and the button stays available.
      this.scanMessageOverride = IMPORT_WAITING_COPY;
      this.notify();
      return;
    }
    const gen = this.session.sessionGeneration;
    this.held = undefined;
    this.scanState = "importing";
    this.scanMessageOverride = undefined;
    const running = this.session.importBytes(held.bytes, "qr", { sha256 });
    this.notify();
    const ran = await running;
    if (this.session.sessionGeneration !== gen) return;
    if (!ran) {
      this.scanState = "idle";
      this.preview = undefined;
      this.scanMessageOverride = IMPORT_DID_NOT_RUN;
      this.notify();
      return;
    }
    const v = this.session.importView;
    if (v?.state === "rejected") {
      this.scanState = "rejected";
      this.scanMessageOverride = v.message;
    } else {
      this.scanState = "imported";
    }
    this.focus = "scan";
    this.notify();
  }

  /** A file import started: QR scanning is not allowed while it is pending, so a running scan stops. */
  private onImportStart(source: ImportSource): void {
    if (source !== "file" || !this.scanActive) return;
    this.epoch += 1;
    this.scan?.stop();
    this.scan = undefined;
    this.scanState = "idle";
    this.hint = undefined;
    this.scanMessageOverride = FILE_IMPORT_STOPPED_SCAN;
  }

  /** Session end: stop the camera, drop the held result and the drawn code. */
  reset(): void {
    this.epoch += 1;
    this.scan?.stop();
    this.scan = undefined;
    this.held = undefined;
    this.preview = undefined;
    this.hint = undefined;
    this.scanState = "idle";
    this.scanMessageOverride = undefined;
    this.shown = undefined;
    this.showState = "idle";
    this.showMessage = "";
    this.notify();
  }
}
