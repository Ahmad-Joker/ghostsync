import { decodeFrame } from "../frame.js";
import { isQrTransferError } from "../errors.js";
import type { QrTransferErrorCode } from "../errors.js";
import { loadJsqrEngine } from "./engine.js";

export type ScanState =
  | "idle"
  | "requesting"
  | "scanning"
  | "accepted"
  | "denied"
  | "no-camera"
  | "in-use"
  | "insecure"
  | "unsupported"
  | "failed"
  | "timed-out";

export type FrameDecoder = (rgba: Uint8ClampedArray, width: number, height: number) => string | undefined;

export interface FrameImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export const SCAN_MAX_EDGE_PX = 1280;
export const SCAN_INTERVAL_MS = 100;
export const SCAN_TIMEOUT_MS = 120_000;
export const HINT_INTERVAL_MS = 1000;

export interface ScanDeps {
  readonly mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined;
  readonly isSecureContext: boolean;
  readonly loadEngine: () => Promise<FrameDecoder>;
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
  readonly pageEvents: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  readonly visibility: { readonly hidden: () => boolean; readonly target: EventTarget };
  /** Reads the current video frame as RGBA. The default draws it to one reused canvas, long edge at most SCAN_MAX_EDGE_PX. */
  readonly readFrame: (video: HTMLVideoElement) => FrameImage | undefined;
}

export interface ScanCallbacks {
  onState(state: ScanState): void;
  /** Non-terminal frame rejection, rate limited to one per second per code. */
  onHint(code: QrTransferErrorCode): void;
  /** At most once per session. */
  onAccepted(bytes: Uint8Array): void;
}

export interface ScanSession {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  readonly state: ScanState;
}

function createCanvasReader(): (video: HTMLVideoElement) => FrameImage | undefined {
  let canvas: HTMLCanvasElement | undefined;
  return (video) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return undefined;
    const ratio = Math.min(1, SCAN_MAX_EDGE_PX / Math.max(vw, vh));
    const width = Math.max(1, Math.round(vw * ratio));
    const height = Math.max(1, Math.round(vh * ratio));
    canvas ??= document.createElement("canvas");
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) return undefined;
    ctx.drawImage(video, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height);
    return { data: img.data, width, height };
  };
}

function resolveDeps(deps: Partial<ScanDeps>): ScanDeps {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const win = typeof window === "undefined" ? undefined : window;
  const doc = typeof document === "undefined" ? undefined : document;
  const noEvents: Pick<EventTarget, "addEventListener" | "removeEventListener"> = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return {
    mediaDevices: "mediaDevices" in deps ? deps.mediaDevices : nav?.mediaDevices,
    isSecureContext: deps.isSecureContext ?? (win?.isSecureContext === true),
    loadEngine: deps.loadEngine ?? loadJsqrEngine,
    now: deps.now ?? (() => performance.now()),
    setTimeout: deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
    clearTimeout: deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as Parameters<typeof clearTimeout>[0])),
    pageEvents: deps.pageEvents ?? win ?? noEvents,
    visibility: deps.visibility ?? { hidden: () => doc?.hidden === true, target: doc ?? new EventTarget() },
    readFrame: deps.readFrame ?? createCanvasReader(),
  };
}

function errorName(err: unknown): string {
  if (err !== null && typeof err === "object" && "name" in err) return String((err as { name: unknown }).name);
  return "";
}

function mapStartError(err: unknown): ScanState {
  switch (errorName(err)) {
    case "NotAllowedError":
      return "denied";
    case "NotFoundError":
      return "no-camera";
    case "NotReadableError":
    case "AbortError":
      return "in-use";
    case "SecurityError":
      return "insecure";
    default:
      return "failed";
  }
}

/** Everything one start owns once its stream exists. Keyed by generation: no shared mutable "current stream". */
interface Active {
  readonly stream: MediaStream;
  readonly video: HTMLVideoElement;
  loopTimer: unknown;
  timeoutTimer: unknown;
  readonly cleanups: Array<() => void>;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
};

export function createScanSession(partial: Partial<ScanDeps>, cb: ScanCallbacks): ScanSession {
  const d = resolveDeps(partial);
  let state: ScanState = "idle";
  /** Bumped by every stop or terminal state. A start captures it before each await and compares it first after. */
  let generation = 0;
  const sessions = new Map<number, Active>();
  const lastHint = new Map<QrTransferErrorCode, number>();

  const setState = (next: ScanState): void => {
    if (state === next) return;
    state = next;
    cb.onState(next);
  };

  /** Close the CURRENT session (if it has a stream), bump the generation and move to `next`. */
  const end = (next: ScanState): void => {
    const gen = generation;
    generation += 1;
    const rec = sessions.get(gen);
    if (rec !== undefined) {
      sessions.delete(gen);
      d.clearTimeout(rec.loopTimer);
      d.clearTimeout(rec.timeoutTimer);
      for (const fn of rec.cleanups) fn();
      stopTracks(rec.stream);
      if (rec.video.srcObject === rec.stream) rec.video.srcObject = null;
    }
    setState(next);
  };

  /** A stale start cleans up ONLY its own stream, and only if stop() has not already closed it. */
  const cleanupStale = (gen: number, stream: MediaStream, video: HTMLVideoElement | undefined): void => {
    if (sessions.delete(gen)) stopTracks(stream);
    if (video !== undefined && video.srcObject === stream) video.srcObject = null;
  };

  const tick = (gen: number, rec: Active, decoder: FrameDecoder): void => {
    if (generation !== gen || state !== "scanning") return;
    if (rec.video.readyState >= 2) {
      const img = d.readFrame(rec.video);
      let text: string | undefined;
      if (img !== undefined) {
        try {
          text = decoder(img.data, img.width, img.height);
        } catch {
          text = undefined;
        }
      }
      if (text !== undefined) {
        try {
          const bytes = decodeFrame(text);
          end("accepted");
          cb.onAccepted(bytes);
          return;
        } catch (err) {
          if (isQrTransferError(err)) {
            const now = d.now();
            const prev = lastHint.get(err.code);
            if (prev === undefined || now - prev >= HINT_INTERVAL_MS) {
              lastHint.set(err.code, now);
              cb.onHint(err.code);
            }
          } else {
            throw err;
          }
        }
      }
    }
    rec.loopTimer = d.setTimeout(() => tick(gen, rec, decoder), SCAN_INTERVAL_MS);
  };

  const start = async (video: HTMLVideoElement): Promise<void> => {
    if (state === "requesting" || state === "scanning") return;
    lastHint.clear();
    setState("requesting");
    const gen = generation;
    const md = d.mediaDevices;
    if (md === undefined) {
      end(d.isSecureContext ? "unsupported" : "insecure");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia(CONSTRAINTS);
    } catch (err) {
      if (generation !== gen) return;
      end(mapStartError(err));
      return;
    }
    // This start's own stream: a local plus a record keyed by its generation.
    const rec: Active = { stream, video, loopTimer: undefined, timeoutTimer: undefined, cleanups: [] };
    sessions.set(gen, rec);
    if (generation !== gen) {
      cleanupStale(gen, stream, undefined);
      return;
    }
    let decoder: FrameDecoder;
    try {
      decoder = await d.loadEngine();
    } catch {
      if (generation !== gen) {
        cleanupStale(gen, stream, undefined);
        return;
      }
      end("failed");
      return;
    }
    if (generation !== gen) {
      cleanupStale(gen, stream, undefined);
      return;
    }
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      if (generation !== gen) {
        cleanupStale(gen, stream, video);
        return;
      }
      end("failed");
      return;
    }
    if (generation !== gen) {
      cleanupStale(gen, stream, video);
      return;
    }
    setState("scanning");
    rec.timeoutTimer = d.setTimeout(() => {
      if (generation === gen) end("timed-out");
    }, SCAN_TIMEOUT_MS);
    const onPageHide = (): void => {
      if (generation === gen) end("idle");
    };
    d.pageEvents.addEventListener("pagehide", onPageHide);
    rec.cleanups.push(() => d.pageEvents.removeEventListener("pagehide", onPageHide));
    const onVisibility = (): void => {
      if (generation === gen && d.visibility.hidden()) end("idle");
    };
    d.visibility.target.addEventListener("visibilitychange", onVisibility);
    rec.cleanups.push(() => d.visibility.target.removeEventListener("visibilitychange", onVisibility));
    for (const track of stream.getVideoTracks()) {
      const onEnded = (): void => {
        if (generation === gen && state === "scanning") end("failed");
      };
      track.addEventListener("ended", onEnded);
      rec.cleanups.push(() => track.removeEventListener("ended", onEnded));
    }
    tick(gen, rec, decoder);
  };

  return {
    start,
    stop(): void {
      if (state !== "requesting" && state !== "scanning") return;
      end("idle");
    },
    get state(): ScanState {
      return state;
    },
  };
}
