import { describe, expect, it, vi } from "vitest";
import { createScanSession } from "../src/browser/scan-session.js";
import type { FrameDecoder, ScanDeps, ScanState } from "../src/browser/scan-session.js";
import { encodeFrame } from "../src/frame.js";
import type { QrTransferErrorCode } from "../src/errors.js";

// ---------- fakes ----------
class FakeTrack {
  readyState: "live" | "ended" = "live";
  stopCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();
  stop(): void {
    this.stopCalls += 1;
    this.readyState = "ended";
  }
  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

class FakeStream {
  readonly track = new FakeTrack();
  getTracks(): FakeTrack[] {
    return [this.track];
  }
  getVideoTracks(): FakeTrack[] {
    return [this.track];
  }
}

const asStream = (s: FakeStream): MediaStream => s as unknown as MediaStream;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const domError = (name: string): Error => Object.assign(new Error(name), { name });

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

class Clock {
  time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown): void => {
    if (typeof id === "number") this.timers.delete(id);
  };
  now = (): number => this.time;
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const t = this.timers.get(nextId);
      this.timers.delete(nextId);
      this.time = Math.max(this.time, nextAt);
      t?.fn();
    }
    this.time = target;
  }
  pending(): number {
    return this.timers.size;
  }
}

class FakeVideo {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  readyState = 4;
  playCalls = 0;
  playImpl: () => Promise<void> = () => Promise.resolve();
  play(): Promise<void> {
    this.playCalls += 1;
    return this.playImpl();
  }
}

class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  count(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

interface Rig {
  readonly clock: Clock;
  readonly video: FakeVideo;
  readonly page: FakeEvents;
  readonly doc: FakeEvents;
  readonly states: ScanState[];
  readonly hints: QrTransferErrorCode[];
  readonly accepted: Uint8Array[];
  readonly getUserMedia: ReturnType<typeof vi.fn>;
  readonly ctl: { hidden: boolean; text: string | undefined };
  readonly session: ReturnType<typeof createScanSession>;
  start(): Promise<void>;
}

function rig(opts: { getUserMedia?: (c: unknown) => Promise<MediaStream>; loadEngine?: () => Promise<FrameDecoder>; mediaDevices?: "none" } = {}): Rig {
  const clock = new Clock();
  const video = new FakeVideo();
  const page = new FakeEvents();
  const doc = new FakeEvents();
  const states: ScanState[] = [];
  const hints: QrTransferErrorCode[] = [];
  const accepted: Uint8Array[] = [];
  const ctl: { hidden: boolean; text: string | undefined } = { hidden: false, text: undefined };
  const getUserMedia = vi.fn(opts.getUserMedia ?? (() => Promise.resolve(asStream(new FakeStream()))));
  const decoder: FrameDecoder = () => ctl.text;
  const deps: Partial<ScanDeps> = {
    mediaDevices: opts.mediaDevices === "none" ? undefined : { getUserMedia: getUserMedia as unknown as MediaDevices["getUserMedia"] },
    isSecureContext: true,
    loadEngine: opts.loadEngine ?? (() => Promise.resolve(decoder)),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    pageEvents: page as unknown as EventTarget,
    visibility: { hidden: () => ctl.hidden, target: doc as unknown as EventTarget },
    readFrame: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  };
  const session = createScanSession(deps, {
    onState: (s) => states.push(s),
    onHint: (c) => hints.push(c),
    onAccepted: (b) => accepted.push(b),
  });
  return { clock, video, page, doc, states, hints, accepted, getUserMedia, ctl, session, start: () => session.start(video as unknown as HTMLVideoElement) };
}

function setText(r: Rig, text: string | undefined): void {
  r.ctl.text = text;
}
const VALID = encodeFrame(Uint8Array.of(1, 2, 3, 4, 5));

describe("U-QR-05 scan session", () => {
  it("requests the rear camera without audio, and only when start() runs", async () => {
    const r = rig();
    expect(r.getUserMedia).not.toHaveBeenCalled();
    await r.start();
    expect(r.getUserMedia).toHaveBeenCalledTimes(1);
    const c = r.getUserMedia.mock.calls[0]?.[0] as MediaStreamConstraints;
    expect(c.audio).toBe(false);
    expect(c.video).toMatchObject({ facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } });
    expect(r.states).toEqual(["requesting", "scanning"]);
    expect(r.video.muted).toBe(true);
    expect(r.video.playsInline).toBe(true);
    r.session.stop();
  });

  it.each([
    ["NotAllowedError", "denied"],
    ["NotFoundError", "no-camera"],
    ["NotReadableError", "in-use"],
    ["AbortError", "in-use"],
    ["SecurityError", "insecure"],
    ["TypeError", "failed"],
    ["OverconstrainedError", "failed"],
  ])("getUserMedia rejection %s ends in %s", async (name, state) => {
    const r = rig({ getUserMedia: () => Promise.reject(domError(name)) });
    await r.start();
    expect(r.session.state).toBe(state);
    expect(r.states).toEqual(["requesting", state]);
  });

  it("no mediaDevices: unsupported on a secure page", async () => {
    const r = rig({ mediaDevices: "none" });
    await r.start();
    expect(r.session.state).toBe("unsupported");
  });

  it("no mediaDevices on an insecure page is insecure", async () => {
    const states: ScanState[] = [];
    const s = createScanSession({ mediaDevices: undefined, isSecureContext: false }, { onState: (x) => states.push(x), onHint: () => undefined, onAccepted: () => undefined });
    await s.start(new FakeVideo() as unknown as HTMLVideoElement);
    expect(s.state).toBe("insecure");
  });

  it("a valid frame is accepted once, the camera stops, and later results are dropped", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    await r.start();
    setText(r, VALID);
    r.clock.advance(100);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
    expect(r.session.state).toBe("accepted");
    expect(stream.track.stopCalls).toBe(1);
    expect(r.video.srcObject).toBeNull();
    r.clock.advance(1000);
    expect(r.accepted).toHaveLength(1);
    expect(r.clock.pending()).toBe(0);
    expect(r.page.count() + r.doc.count() + stream.track.listenerCount()).toBe(0);
  });

  it("a non-GhostSync code gives one rate-limited hint and scanning continues", async () => {
    const r = rig();
    await r.start();
    setText(r, "HTTPS://EXAMPLE.INVALID/");
    r.clock.advance(100 * 5);
    expect(r.hints).toEqual(["NotGhostSync"]);
    expect(r.session.state).toBe("scanning");
    r.clock.advance(1000);
    expect(r.hints).toEqual(["NotGhostSync", "NotGhostSync"]);
    setText(r, VALID);
    r.clock.advance(100);
    expect(r.accepted).toHaveLength(1);
  });

  it("runs the loop at most every 100 ms with one decode per tick", async () => {
    const decode = vi.fn<FrameDecoder>(() => undefined);
    const r = rig({ loadEngine: () => Promise.resolve(decode) });
    await r.start();
    const first = decode.mock.calls.length;
    r.clock.advance(1000);
    expect(decode.mock.calls.length - first).toBe(10);
    r.session.stop();
  });

  it("skips decoding while the video has no data", async () => {
    const decode = vi.fn<FrameDecoder>(() => undefined);
    const r = rig({ loadEngine: () => Promise.resolve(decode) });
    r.video.readyState = 1;
    await r.start();
    r.clock.advance(500);
    expect(decode).not.toHaveBeenCalled();
    r.session.stop();
  });

  it("cancel stops tracks, clears timers and listeners; stop() is idempotent", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    await r.start();
    expect(r.page.count()).toBe(1);
    expect(r.doc.count()).toBe(1);
    r.session.stop();
    r.session.stop();
    expect(stream.track.stopCalls).toBe(1);
    expect(r.video.srcObject).toBeNull();
    expect(r.session.state).toBe("idle");
    expect(r.clock.pending()).toBe(0);
    expect(r.page.count() + r.doc.count() + stream.track.listenerCount()).toBe(0);
    expect(r.states).toEqual(["requesting", "scanning", "idle"]);
  });

  it("a second start() while active is ignored", async () => {
    const r = rig();
    await r.start();
    await r.start();
    expect(r.getUserMedia).toHaveBeenCalledTimes(1);
    r.session.stop();
  });

  it("times out after 120 s and releases the camera", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    await r.start();
    r.clock.advance(119_000);
    expect(r.session.state).toBe("scanning");
    r.clock.advance(1_000);
    expect(r.session.state).toBe("timed-out");
    expect(stream.track.stopCalls).toBe(1);
  });

  it("pagehide releases the camera", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    await r.start();
    r.page.fire("pagehide");
    expect(r.session.state).toBe("idle");
    expect(stream.track.stopCalls).toBe(1);
  });

  it("a hidden document releases the camera; a visible change does not", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    await r.start();
    r.doc.fire("visibilitychange");
    expect(r.session.state).toBe("scanning");
    r.ctl.hidden = true;
    r.doc.fire("visibilitychange");
    expect(r.session.state).toBe("idle");
    expect(stream.track.stopCalls).toBe(1);
  });

  it("a track ended event while scanning gives failed and stops the tracks", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    await r.start();
    stream.track.fire("ended");
    expect(r.session.state).toBe("failed");
    expect(stream.track.stopCalls).toBe(1);
  });

  it("engine load failure ends in failed with the tracks stopped", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)), loadEngine: () => Promise.reject(new Error("chunk blocked")) });
    await r.start();
    expect(r.session.state).toBe("failed");
    expect(stream.track.stopCalls).toBe(1);
    expect(r.video.srcObject).toBeNull();
  });

  it("play() failure with the same session ends in failed with the tracks stopped", async () => {
    const stream = new FakeStream();
    const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
    r.video.playImpl = () => Promise.reject(domError("NotAllowedError"));
    await r.start();
    expect(r.session.state).toBe("failed");
    expect(stream.track.stopCalls).toBe(1);
    expect(r.video.srcObject).toBeNull();
  });

  it("start works again after a terminal state", async () => {
    let n = 0;
    const r = rig({ getUserMedia: () => (n++ === 0 ? Promise.reject(domError("NotAllowedError")) : Promise.resolve(asStream(new FakeStream()))) });
    await r.start();
    expect(r.session.state).toBe("denied");
    await r.start();
    expect(r.session.state).toBe("scanning");
    r.session.stop();
  });

  // ---------- deferred races: stop during each await, resolve and reject variants ----------
  describe("stale starts", () => {
    it("stop while getUserMedia is pending, then it resolves: its own tracks stop once, nothing is emitted", async () => {
      const g = deferred<MediaStream>();
      const r = rig({ getUserMedia: () => g.promise });
      const p = r.start();
      r.session.stop();
      expect(r.session.state).toBe("idle");
      const stream = new FakeStream();
      g.resolve(asStream(stream));
      await p;
      expect(stream.track.stopCalls).toBe(1);
      expect(r.states).toEqual(["requesting", "idle"]);
      expect(r.video.srcObject).toBeNull();
    });

    it("stop while getUserMedia is pending, then it rejects: no error state", async () => {
      const g = deferred<MediaStream>();
      const r = rig({ getUserMedia: () => g.promise });
      const p = r.start();
      r.session.stop();
      g.reject(domError("NotAllowedError"));
      await p;
      expect(r.states).toEqual(["requesting", "idle"]);
    });

    it("stop while loadEngine is pending, then it resolves: tracks stop exactly once, no scanning", async () => {
      const l = deferred<FrameDecoder>();
      const stream = new FakeStream();
      const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)), loadEngine: () => l.promise });
      const p = r.start();
      await flush();
      r.session.stop();
      expect(stream.track.stopCalls).toBe(1);
      l.resolve(() => undefined);
      await p;
      expect(stream.track.stopCalls).toBe(1);
      expect(r.states).toEqual(["requesting", "idle"]);
      expect(r.video.srcObject).toBeNull();
    });

    it("stop while loadEngine is pending, then it rejects: no failed state", async () => {
      const l = deferred<FrameDecoder>();
      const stream = new FakeStream();
      const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)), loadEngine: () => l.promise });
      const p = r.start();
      await flush();
      r.session.stop();
      l.reject(new Error("late failure"));
      await p;
      expect(r.states).toEqual(["requesting", "idle"]);
      expect(stream.track.stopCalls).toBe(1);
    });

    it("stop while play() is pending, then it resolves: tracks stop once, no scanning", async () => {
      const pl = deferred<void>();
      const stream = new FakeStream();
      const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
      r.video.playImpl = () => pl.promise;
      const p = r.start();
      await flush();
      r.session.stop();
      expect(r.video.srcObject).toBeNull();
      pl.resolve();
      await p;
      expect(stream.track.stopCalls).toBe(1);
      expect(r.states).toEqual(["requesting", "idle"]);
    });

    it("stop while play() is pending, then it rejects: no failed state", async () => {
      const pl = deferred<void>();
      const stream = new FakeStream();
      const r = rig({ getUserMedia: () => Promise.resolve(asStream(stream)) });
      r.video.playImpl = () => pl.promise;
      const p = r.start();
      await flush();
      r.session.stop();
      pl.reject(domError("AbortError"));
      await p;
      expect(r.states).toEqual(["requesting", "idle"]);
      expect(stream.track.stopCalls).toBe(1);
    });
  });

  // ---------- restart regressions ----------
  describe("Cancel then immediate re-Scan", () => {
    it("(a) the OLD getUserMedia resolving after the new stream is active leaves the new stream live and attached", async () => {
      const g1 = deferred<MediaStream>();
      const g2 = deferred<MediaStream>();
      const queue = [g1, g2];
      const r = rig({ getUserMedia: () => (queue.shift() as Deferred<MediaStream>).promise });
      const p1 = r.start();
      r.session.stop();
      const p2 = r.start();
      const newStream = new FakeStream();
      g2.resolve(asStream(newStream));
      await p2;
      expect(r.session.state).toBe("scanning");
      expect(r.video.srcObject).toBe(newStream);

      const oldStream = new FakeStream();
      g1.resolve(asStream(oldStream));
      await p1;

      expect(oldStream.track.stopCalls).toBe(1);
      expect(oldStream.track.readyState).toBe("ended");
      expect(newStream.track.stopCalls).toBe(0);
      expect(newStream.track.readyState).toBe("live");
      expect(r.video.srcObject).toBe(newStream);
      expect(r.session.state).toBe("scanning");
      expect(r.states).toEqual(["requesting", "idle", "requesting", "scanning"]);
      expect(r.page.count()).toBe(1);

      setText(r, VALID);
      r.clock.advance(100);
      expect(r.accepted).toHaveLength(1);
      expect(r.session.state).toBe("accepted");
      // The accept path closes the new tracks exactly once; a later stop() adds nothing.
      expect(newStream.track.stopCalls).toBe(1);
      r.session.stop();
      expect(newStream.track.stopCalls).toBe(1);
    });

    it("(a) variant: a final stop() closes the new tracks exactly once", async () => {
      const g1 = deferred<MediaStream>();
      const g2 = deferred<MediaStream>();
      const queue = [g1, g2];
      const r = rig({ getUserMedia: () => (queue.shift() as Deferred<MediaStream>).promise });
      const p1 = r.start();
      r.session.stop();
      const p2 = r.start();
      const newStream = new FakeStream();
      g2.resolve(asStream(newStream));
      await p2;
      g1.resolve(asStream(new FakeStream()));
      await p1;
      expect(newStream.track.stopCalls).toBe(0);
      r.session.stop();
      expect(newStream.track.stopCalls).toBe(1);
      expect(r.video.srcObject).toBeNull();
    });

    it("(a) variant: the OLD getUserMedia rejecting after the new stream is active changes nothing", async () => {
      const g1 = deferred<MediaStream>();
      const g2 = deferred<MediaStream>();
      const queue = [g1, g2];
      const r = rig({ getUserMedia: () => (queue.shift() as Deferred<MediaStream>).promise });
      const p1 = r.start();
      r.session.stop();
      const p2 = r.start();
      const newStream = new FakeStream();
      g2.resolve(asStream(newStream));
      await p2;
      g1.reject(domError("NotAllowedError"));
      await p1;
      expect(r.session.state).toBe("scanning");
      expect(newStream.track.stopCalls).toBe(0);
      expect(r.video.srcObject).toBe(newStream);
      r.session.stop();
    });

    it("(b) a stale loadEngine rejection after restart: no failed state, the new session is unaffected, old tracks stopped", async () => {
      const l1 = deferred<FrameDecoder>();
      const streams = [new FakeStream(), new FakeStream()];
      let loads = 0;
      let gets = 0;
      const r = rig({
        getUserMedia: () => Promise.resolve(asStream(streams[gets++] as FakeStream)),
        loadEngine: () => (loads++ === 0 ? l1.promise : Promise.resolve((): string | undefined => undefined)),
      });
      const p1 = r.start();
      await flush();
      r.session.stop();
      const p2 = r.start();
      await p2;
      expect(r.session.state).toBe("scanning");
      l1.reject(new Error("stale engine failure"));
      await p1;
      expect(r.session.state).toBe("scanning");
      expect(r.states).not.toContain("failed");
      expect((streams[0] as FakeStream).track.stopCalls).toBe(1);
      expect((streams[1] as FakeStream).track.stopCalls).toBe(0);
      expect((streams[1] as FakeStream).track.readyState).toBe("live");
      expect(r.video.srcObject).toBe(streams[1]);
      r.session.stop();
    });

    it("(c) a stale play() rejection after restart: no failed state, the new session is unaffected, old tracks stopped", async () => {
      const pl1 = deferred<void>();
      const streams = [new FakeStream(), new FakeStream()];
      let gets = 0;
      let plays = 0;
      const r = rig({ getUserMedia: () => Promise.resolve(asStream(streams[gets++] as FakeStream)) });
      r.video.playImpl = () => (plays++ === 0 ? pl1.promise : Promise.resolve());
      const p1 = r.start();
      await flush();
      r.session.stop();
      const p2 = r.start();
      await p2;
      expect(r.video.srcObject).toBe(streams[1]);
      pl1.reject(domError("AbortError"));
      await p1;
      expect(r.session.state).toBe("scanning");
      expect(r.states).not.toContain("failed");
      expect((streams[0] as FakeStream).track.stopCalls).toBe(1);
      expect((streams[1] as FakeStream).track.stopCalls).toBe(0);
      expect(r.video.srcObject).toBe(streams[1]);
      setText(r, VALID);
      r.clock.advance(100);
      expect(r.accepted).toHaveLength(1);
    });
  });
});
