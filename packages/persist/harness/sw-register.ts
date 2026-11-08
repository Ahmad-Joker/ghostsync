/**
 * Harness-side Service Worker registration + OBSERVABLE offline-readiness
 * (offline-assets milestone). This is harness/verification wiring only — it does
 * NOT touch CRDT or persistence logic. It exposes a readiness signal the e2e
 * suite can await (no arbitrary sleeps) and a meaningful FAILURE state.
 *
 * Readiness contract (strict, honest): the harness is marked offline-ready ONLY
 * when ALL of the following hold:
 *   1. the SW registered,
 *   2. an ACTIVE worker exists,
 *   3. the worker CONTROLS this page (navigator.serviceWorker.controller set),
 *   4. the worker reports its precache is COMPLETE (every manifest entry is in
 *      the scoped cache) via a GHOSTSYNC_PRECACHE_STATUS round-trip.
 * Registration resolving is NOT sufficient — an incomplete precache or an
 * uncontrolled page is reported as NOT ready.
 *
 * The SW URL is scope-relative ("./sw.js"), so registration scope is the harness
 * deployment directory and nothing is hardcoded to localhost or an absolute
 * path. Registration is attempted only for the PRODUCTION-built harness on a
 * secure context (localhost or HTTPS) where `serviceWorker` exists.
 */

/** The public offline-readiness state surfaced on `window.__gsOffline`. */
export type OfflineState =
  | "unsupported" // no service worker support / insecure context
  | "registering" // registration in flight
  | "installing" // worker installing / precaching
  | "waiting" // a new worker is installed but waiting (update available)
  | "ready" // controlled + precache complete → boots offline
  | "failed"; // registration or precache failed → NOT offline-ready

export interface OfflineReadiness {
  /** Current coarse state (also mirrored to the status DOM + data attribute). */
  state: OfflineState;
  /** True ONLY when state === "ready" (controlled + precache complete). */
  ready: boolean;
  /** Present on state === "failed": a short, human-readable reason. */
  error?: string;
  /** The active cache version/name reported by the worker (diagnostic). */
  cacheVersion?: string;
  cacheName?: string;
  /** True when a newer worker is installed and waiting to take over. */
  updateAvailable: boolean;
  /** EXPLICIT (never automatic) prompt for a waiting worker to take control. */
  applyUpdate(): void;
}

interface PrecacheStatusMessage {
  type: "GHOSTSYNC_PRECACHE_STATUS";
  cacheVersion: string;
  cacheName: string;
  complete: boolean;
  total: number;
}

declare global {
  interface Window {
    /** Observable offline-readiness surface for the acceptance suite. */
    __gsOffline: OfflineReadiness;
  }
}

const STATUS_TIMEOUT_MS = 5_000;

function reflectToDom(readiness: OfflineReadiness): void {
  const root = document.documentElement;
  root.setAttribute("data-offline-state", readiness.state);
  root.setAttribute("data-offline-ready", String(readiness.ready));
  const el = document.getElementById("offline-status");
  if (el !== null) {
    el.textContent =
      readiness.state === "ready"
        ? `offline-ready (cache ${readiness.cacheVersion ?? "?"})`
        : readiness.state === "failed"
          ? `offline unavailable: ${readiness.error ?? "unknown"}`
          : `offline: ${readiness.state}…`;
    el.className = readiness.state === "ready" ? "ready" : readiness.state === "failed" ? "failed" : "";
  }
}

/**
 * Ask the controlling worker whether its precache is complete. Resolves with the
 * status message, or rejects on timeout (bounded, no infinite wait).
 */
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

/**
 * Register the SW and drive the readiness state machine. Returns the mutable
 * readiness object (also installed on `window.__gsOffline`).
 */
export function initOfflineReadiness(): OfflineReadiness {
  let waitingWorker: ServiceWorker | null = null;

  const readiness: OfflineReadiness = {
    state: "registering",
    ready: false,
    updateAvailable: false,
    applyUpdate(): void {
      // EXPLICIT, user-driven update: tell the waiting worker to take over. We
      // never call this automatically (no auto skipWaiting), so old pages are
      // not mixed with new assets without an explicit prompt.
      if (waitingWorker !== null) {
        waitingWorker.postMessage({ type: "GHOSTSYNC_SKIP_WAITING" });
      }
    },
  };

  const set = (next: Partial<OfflineReadiness>): void => {
    Object.assign(readiness, next);
    readiness.ready = readiness.state === "ready";
    reflectToDom(readiness);
  };

  // Secure-context + support gate: service workers require a secure context
  // (localhost or HTTPS). file:// or an insecure origin is reported unsupported.
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    set({ state: "unsupported", error: "service worker unavailable in this context" });
    return readiness;
  }

  /** Re-evaluate readiness: controlled + a complete precache ⇒ ready. */
  const evaluate = async (): Promise<void> => {
    const controller = navigator.serviceWorker.controller;
    if (controller === null) {
      // Active but not yet controlling this page — stay not-ready.
      return;
    }
    try {
      const status = await requestPrecacheStatus(controller);
      if (status.complete) {
        set({
          state: "ready",
          cacheVersion: status.cacheVersion,
          cacheName: status.cacheName,
        });
      } else {
        set({ state: "failed", error: "precache incomplete" });
      }
    } catch (err) {
      set({ state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  // TEST override: a `?sw=<name>` query selects an alternate worker FILENAME in
  // the SAME scope (used by the install-failure acceptance test to point at the
  // generated `sw-install-fail.js`). Restricted to a bare `[a-z0-9-]+.js` name so
  // it can never escape the deployment directory or load a cross-origin script.
  const chooseWorkerUrl = (): string => {
    const requested = new URLSearchParams(window.location.search).get("sw");
    if (requested !== null && /^[a-z0-9-]+\.js$/.test(requested)) {
      return `./${requested}`;
    }
    return "./sw.js";
  };

  const run = async (): Promise<void> => {
    try {
      // Scope-relative worker URL → scope = harness deployment directory. A
      // classic worker (no module imports) keeps the generated file portable.
      const registration = await navigator.serviceWorker.register(chooseWorkerUrl(), { scope: "./" });

      // Track a newly-found worker's install progress / waiting state.
      const trackInstalling = (worker: ServiceWorker | null): void => {
        if (worker === null) {
          return;
        }
        worker.addEventListener("statechange", () => {
          if (worker.state === "installing") {
            if (readiness.state !== "ready") {
              set({ state: "installing" });
            }
          } else if (worker.state === "installed") {
            if (navigator.serviceWorker.controller !== null) {
              // An update is installed and waiting (a controller already exists).
              waitingWorker = worker;
              set({ updateAvailable: true });
              if (readiness.state !== "ready") {
                set({ state: "waiting" });
              }
            }
          } else if (worker.state === "redundant") {
            // A worker that goes redundant WITHOUT ever controlling the page and
            // while we are NOT ready means install FAILED (atomic reject) and the
            // browser discarded it. Report a failure — never offline-ready.
            if (readiness.state !== "ready" && navigator.serviceWorker.controller === null) {
              set({ state: "failed", error: "service worker install failed" });
            }
          }
        });
      };

      if (registration.installing !== null) {
        set({ state: "installing" });
        trackInstalling(registration.installing);
      }
      registration.addEventListener("updatefound", () => {
        trackInstalling(registration.installing);
      });

      // When this page gains/loses a controller, re-evaluate readiness.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        void evaluate();
      });

      // `ready` resolves once there is an ACTIVE worker for this scope. If it is
      // not yet controlling THIS page (first-ever load before claim), the
      // controllerchange handler above will re-run evaluate() after claim().
      await navigator.serviceWorker.ready;
      await evaluate();

      // If installation FAILED, `ready` never surfaces a complete precache and
      // the worker is discarded; surface a failure instead of a silent hang.
      if (readiness.state === "registering" || readiness.state === "installing") {
        // No controller yet and no completion — leave the installing/registering
        // state; evaluate() runs again on controllerchange. If install rejected,
        // the registration's active worker stays null and tests time out their
        // own bounded wait, which is the honest "not ready" outcome.
      }
    } catch (err) {
      set({ state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  // Expose the observable readiness surface for the acceptance suite BEFORE any
  // async work so tests can read it immediately.
  window.__gsOffline = readiness;
  reflectToDom(readiness);
  void run();
  return readiness;
}
