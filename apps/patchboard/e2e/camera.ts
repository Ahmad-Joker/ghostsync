/**
 * Test-only fake camera (EV-FIXTURE). Installed per browser context with addInitScript, so nothing of it exists in `src` or `dist`
 * (asserted by tests/dist-scan.test.ts). It replaces navigator.mediaDevices.getUserMedia with a stub that returns a REAL MediaStream
 * from an off-DOM canvas (captureStream). The real <video>, the real canvas read-back, the real jsqr decoder and the real controller
 * run unchanged. Lens, focus, exposure, moire, glare and motion blur are NOT exercised: this is never physical-camera evidence.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { buildQrSymbol, encodeFrame } from "@ghostsync/qr-transfer";
import { BOARD, join, loadUntilOfflineReady, newProfile, type Profile } from "./helpers.js";

export type CameraMode = "ok" | "NotAllowedError" | "NotFoundError" | "NotReadableError" | "SecurityError" | "OtherError" | "none";
export type FrameSource =
  | { readonly kind: "modules"; readonly size: number; readonly data: ReadonlyArray<number> }
  | { readonly kind: "image"; readonly dataUrl: string };

/** Runs in the page before any app script. */
export function installFakeCamera(): void {
  interface Camera {
    mode: string;
    calls: number;
    streams: MediaStream[];
    frame: unknown;
    /** When set, the NEXT getUserMedia waits for releaseHeld() before resolving (the resolved stream is created at release time). */
    hold: boolean;
    held: Array<() => void>;
    cspViolations: number;
    setMode(mode: string): void;
    setFrame(frame: unknown): void;
    holdNext(): void;
    releaseHeld(): void;
  }
  const w = window as unknown as { __ghostsyncCamera: Camera };
  let image: HTMLImageElement | undefined;
  const cam: Camera = {
    mode: "ok",
    calls: 0,
    streams: [],
    frame: undefined,
    hold: false,
    held: [],
    cspViolations: 0,
    setMode(mode: string) {
      cam.mode = mode;
      if (mode === "none") Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    },
    setFrame(frame: unknown) {
      cam.frame = frame;
      const f = frame as { kind?: string; dataUrl?: string } | undefined;
      if (f?.kind === "image" && typeof f.dataUrl === "string") {
        const img = new Image();
        img.src = f.dataUrl;
        image = img;
      } else {
        image = undefined;
      }
    },
    holdNext() {
      cam.hold = true;
    },
    releaseHeld() {
      const fns = cam.held.splice(0);
      for (const fn of fns) fn();
    },
  };
  w.__ghostsyncCamera = cam;
  document.addEventListener("securitypolicyviolation", () => {
    cam.cspViolations += 1;
  });

  const makeStream = (): MediaStream => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new DOMException("fixture canvas", "NotReadableError");
    const draw = (): void => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const f = cam.frame as { kind?: string; size?: number; data?: number[] } | undefined;
      if (f?.kind === "modules" && typeof f.size === "number" && Array.isArray(f.data)) {
        const total = f.size + 8;
        const scale = Math.max(1, Math.floor(900 / total));
        const x0 = Math.floor((canvas.width - total * scale) / 2);
        const y0 = Math.floor((canvas.height - total * scale) / 2);
        ctx.fillStyle = "#000";
        for (let y = 0; y < f.size; y += 1) {
          for (let x = 0; x < f.size; x += 1) {
            if (f.data[y * f.size + x] === 1) ctx.fillRect(x0 + (x + 4) * scale, y0 + (y + 4) * scale, scale, scale);
          }
        }
      } else if (image !== undefined && image.complete && image.naturalWidth > 0) {
        ctx.drawImage(image, Math.floor((canvas.width - image.naturalWidth) / 2), Math.floor((canvas.height - image.naturalHeight) / 2));
      }
    };
    draw();
    window.setInterval(draw, 100);
    const stream = canvas.captureStream(10);
    cam.streams.push(stream);
    return stream;
  };

  const getUserMedia = async (): Promise<MediaStream> => {
    cam.calls += 1;
    if (cam.hold) {
      cam.hold = false;
      await new Promise<void>((resolve) => cam.held.push(resolve));
    }
    if (cam.mode !== "ok") throw new DOMException("fixture", cam.mode === "OtherError" ? "TypeError" : cam.mode);
    return makeStream();
  };
  if (navigator.mediaDevices !== undefined) {
    navigator.mediaDevices.getUserMedia = getUserMedia;
  }
}

interface CameraWindow {
  __ghostsyncCamera: {
    calls: number;
    streams: MediaStream[];
    cspViolations: number;
    setMode(mode: string): void;
    setFrame(frame: unknown): void;
    holdNext(): void;
    releaseHeld(): void;
  };
}

export async function addFakeCamera(context: BrowserContext): Promise<void> {
  await context.addInitScript(installFakeCamera);
}

export function setCameraFrame(page: Page, frame: FrameSource | undefined): Promise<void> {
  return page.evaluate((f) => (window as unknown as CameraWindow).__ghostsyncCamera.setFrame(f), frame);
}
export function setCameraMode(page: Page, mode: CameraMode): Promise<void> {
  return page.evaluate((m) => (window as unknown as CameraWindow).__ghostsyncCamera.setMode(m), mode);
}
export function holdNextCamera(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as CameraWindow).__ghostsyncCamera.holdNext());
}
export function releaseHeldCamera(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as CameraWindow).__ghostsyncCamera.releaseHeld());
}
export function cameraCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as CameraWindow).__ghostsyncCamera.calls);
}
export function cspViolations(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as CameraWindow).__ghostsyncCamera.cspViolations);
}
export function trackStates(page: Page): Promise<string[][]> {
  return page.evaluate(() => (window as unknown as CameraWindow).__ghostsyncCamera.streams.map((s) => s.getTracks().map((t) => t.readyState)));
}
/** Whether <video data-testid="qr-video"> is attached to the stream with this index, and its track states. */
export function videoAttachedTo(page: Page, index: number): Promise<boolean> {
  return page.evaluate((i) => {
    const v = document.querySelector<HTMLVideoElement>('[data-testid="qr-video"]');
    return v !== null && v.srcObject === (window as unknown as CameraWindow).__ghostsyncCamera.streams[i];
  }, index);
}
export function videoSource(page: Page): Promise<"none" | "stream"> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('[data-testid="qr-video"]');
    return v === null || v.srcObject === null ? "none" : "stream";
  });
}

/** Node-side rasterizer input: the module matrix of the real symbol builder for this frame text (the test does not use paintQr). */
export function framePixels(frameText: string): FrameSource {
  const sym = buildQrSymbol(frameText);
  return { kind: "modules", size: sym.size, data: Array.from(sym.modules) };
}
export const capsuleFrame = (bytes: Uint8Array): FrameSource => framePixels(encodeFrame(bytes));

/** A profile with the fake camera installed, loaded online until offline-ready, then offline and reloaded from the worker, joined to the board. */
export async function qrOfflineProfile(browser: Browser, boardId = BOARD): Promise<Profile> {
  const p = await newProfile(browser);
  await addFakeCamera(p.context);
  await loadUntilOfflineReady(p.page);
  await p.context.setOffline(true);
  await p.page.reload();
  await expect(p.page.locator("html")).toHaveAttribute("data-offline-ready", "true");
  await join(p.page, boardId);
  return p;
}

/** An online profile with the fake camera, joined to the board (used where network is not the subject). */
export async function qrOnlineProfile(browser: Browser, boardId = BOARD, viewport?: { width: number; height: number }): Promise<Profile> {
  const p = await newProfile(browser, viewport === undefined ? {} : { viewport });
  await addFakeCamera(p.context);
  await loadUntilOfflineReady(p.page);
  await join(p.page, boardId);
  return p;
}
