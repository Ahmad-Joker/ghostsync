/**
 * Service worker registration and offline readiness for FieldLedger. Adapted from
 * packages/persist/harness/sw-register.ts (baseline 916165f): no window global, a subscribe
 * callback, and a `waiting` state that is reported even after the page was ready.
 *
 * `ready` ONLY when: the worker registered, is active, CONTROLS this page, and its precache
 * is COMPLETE (GHOSTSYNC_PRECACHE_STATUS round trip). Registration alone is never enough.
 * No automatic skipWaiting: a waiting worker takes over only through `applyUpdate()`.
 * This module never touches persistence or sync.
 */
export type OfflineState = "unsupported" | "registering" | "installing" | "waiting" | "ready" | "failed";

export interface OfflineSnapshot {
  readonly state: OfflineState;
  /** True when the page is controlled and the precache is complete (stays true while `waiting`). */
  readonly ready: boolean;
  readonly error?: string;
  readonly cacheVersion?: string;
}

export interface OfflineHandle {
  /** Explicit, user-driven: tell the waiting worker to take over, then reload on controllerchange. */
  applyUpdate(): void;
}

interface PrecacheStatusMessage {
  type: "GHOSTSYNC_PRECACHE_STATUS";
  cacheVersion: string;
  cacheName: string;
  complete: boolean;
  total: number;
}

const STATUS_TIMEOUT_MS = 5_000;

function reflect(s: OfflineSnapshot): void {
  const root = document.documentElement;
  root.setAttribute("data-offline-state", s.state);
  root.setAttribute("data-offline-ready", String(s.ready));
}

function requestPrecacheStatus(worker: ServiceWorker): Promise<PrecacheStatusMessage> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      reject(new Error("precache status timeout"));
    }, STATUS_TIMEOUT_MS);
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as PrecacheStatusMessage | undefined;
      if (data && data.type === "GHOSTSYNC_PRECACHE_STATUS") {
        window.clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve(data);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "GHOSTSYNC_PRECACHE_STATUS" });
  });
}

export function initOfflineReadiness(onChange: (s: OfflineSnapshot) => void): OfflineHandle {
  let waitingWorker: ServiceWorker | null = null;
  let updating = false;
  let current: OfflineSnapshot = { state: "registering", ready: false };
  const set = (next: OfflineSnapshot): void => {
    current = next;
    reflect(current);
    onChange(current);
  };
  const handle: OfflineHandle = {
    applyUpdate(): void {
      if (waitingWorker !== null) {
        updating = true;
        waitingWorker.postMessage({ type: "GHOSTSYNC_SKIP_WAITING" });
      }
    },
  };
  set(current);
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    set({ state: "unsupported", ready: false, error: "service worker unavailable in this context" });
    return handle;
  }

  const evaluate = async (): Promise<void> => {
    const controller = navigator.serviceWorker.controller;
    if (controller === null) return; // active but not yet controlling this page
    try {
      const status = await requestPrecacheStatus(controller);
      if (status.complete) {
        // A waiting worker keeps the `waiting` state; readiness of the current page is unchanged.
        if (current.state !== "waiting") set({ state: "ready", ready: true, cacheVersion: status.cacheVersion });
        else set({ ...current, ready: true });
      } else {
        set({ state: "failed", ready: false, error: "precache incomplete" });
      }
    } catch (err) {
      set({ state: "failed", ready: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const track = (worker: ServiceWorker | null): void => {
    if (worker === null) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installing") {
        if (!current.ready) set({ state: "installing", ready: false });
      } else if (worker.state === "installed") {
        if (navigator.serviceWorker.controller !== null) {
          waitingWorker = worker;
          set({ state: "waiting", ready: current.ready });
        }
      } else if (worker.state === "redundant") {
        if (!current.ready && navigator.serviceWorker.controller === null) {
          set({ state: "failed", ready: false, error: "service worker install failed" });
        }
      }
    });
  };

  void (async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      if (registration.installing !== null) {
        set({ state: "installing", ready: false });
        track(registration.installing);
      }
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        waitingWorker = registration.waiting;
        set({ state: "waiting", ready: current.ready });
      }
      registration.addEventListener("updatefound", () => track(registration.installing));
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (updating) {
          window.location.reload();
          return;
        }
        void evaluate();
      });
      await navigator.serviceWorker.ready;
      await evaluate();
    } catch (err) {
      set({ state: "failed", ready: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return handle;
}
