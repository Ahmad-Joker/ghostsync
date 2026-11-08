/**
 * Build-time Service Worker + precache-manifest generator for the GhostSync
 * Persist harness (offline-assets milestone). This is BUILD/SERVE TOOLING ONLY
 * — no sync, CRDT, or persistence logic lives here. It wraps the existing Vite
 * harness build so a PRODUCTION build emits:
 *
 *   dist/sw.js               — a small, dependency-free Service Worker whose
 *                              precache manifest + cache version are injected
 *                              from the ACTUAL emitted bundle (never hardcoded
 *                              hashed filenames).
 *   dist/precache-manifest.json  — the same manifest as an inspectable artifact.
 *
 * Why a plugin and not a static `public/sw.js`: the SW must precache EVERY
 * emitted asset required to boot the shell, and Vite emits content-hashed
 * filenames (e.g. `assets/index-<hash>.js`) that are unknown until the bundle
 * exists. We discover them from Vite's `bundle` object in `generateBundle`, so
 * the manifest always matches what was actually built.
 *
 * Determinism: the cache version is a SHA-256 over the SORTED list of
 * `url\u0000integrity` pairs of every precached entry. Identical build CONTENTS
 * ⇒ identical cache version; any changed byte in any precached asset ⇒ a new
 * version. The version is NOT derived from timestamps or build counters.
 *
 * Scope + naming (concrete choices, scope-relative, no hardcoded ports/paths):
 *   - SW file:        sw.js at the deployment root (alongside index.html), so
 *                     its default scope is the harness deployment directory. It
 *                     works unchanged under a subpath because every URL it
 *                     touches is resolved RELATIVE to the worker's own location
 *                     (`self.registration.scope`), never an absolute `/path`.
 *   - cache prefix:   "ghostsync-persist-harness-" (the scoped prefix; activation
 *                     deletes ONLY caches with this prefix that are not the
 *                     current version).
 *   - cache name:     `${CACHE_PREFIX}${CACHE_VERSION}`.
 */
import { createHash } from "node:crypto";

import type { Plugin } from "vite";

/** The scoped cache-name prefix. Activation cleans ONLY caches with this prefix. */
export const CACHE_PREFIX = "ghostsync-persist-harness-";

/** A single precached entry: a scope-relative URL + a content integrity hash. */
interface PrecacheEntry {
  /** Scope-relative URL (no leading slash), e.g. "index.html" or "assets/x.js". */
  readonly url: string;
  /** Short SHA-256 (hex, 16 chars) of the emitted bytes — detects content change. */
  readonly integrity: string;
}

/** The emitted precache manifest (written to disk + inlined into sw.js). */
interface PrecacheManifest {
  readonly cacheVersion: string;
  readonly cachePrefix: string;
  readonly entries: readonly PrecacheEntry[];
}

/** File names that must never be precached (the worker + its own manifest). */
const EXCLUDED = new Set(["sw.js", "sw-install-fail.js", "precache-manifest.json"]);

function shortHash(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function fullHash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Render the Service Worker source with the manifest inlined as a JSON literal.
 * The worker is plain ES (served as a classic worker) with NO imports, so it
 * needs no bundling and runs byte-for-byte as written.
 */
function renderServiceWorker(manifest: PrecacheManifest): string {
  const manifestLiteral = JSON.stringify(
    { cacheVersion: manifest.cacheVersion, cachePrefix: manifest.cachePrefix, entries: manifest.entries },
    null,
    2,
  );
  return `/**
 * GENERATED — GhostSync Persist harness Service Worker (offline-assets
 * milestone). Do not edit by hand; regenerate with the harness build. This file
 * caches the harness SHELL + its build-emitted ASSETS so a PREVIOUSLY-INITIALIZED
 * profile can boot the harness with networking disabled. It does NOT cache
 * IndexedDB contents, sync messages, non-GET requests, arbitrary URLs, or any
 * external/cross-origin resource.
 */
/* eslint-disable */
"use strict";

// Injected from the ACTUAL emitted bundle at build time (never hardcoded).
const MANIFEST = ${manifestLiteral};

const CACHE_NAME = MANIFEST.cachePrefix + MANIFEST.cacheVersion;

/**
 * Resolve a precache entry URL against THIS worker's own location, so the SW
 * works unchanged under any subpath (no hardcoded host/port/absolute path).
 */
function precacheUrls() {
  return MANIFEST.entries.map(function (e) {
    return new URL(e.url, self.registration.scope).toString();
  });
}

/** The navigation fallback target = the cached shell (index.html). */
function shellUrl() {
  return new URL("index.html", self.registration.scope).toString();
}

/**
 * INSTALL: populate the precache ATOMICALLY. We fetch every entry and only
 * resolve install once ALL responses are OK and stored. If ANY asset fails,
 * install REJECTS — the browser discards this worker and KEEPS the previously
 * installed (working) version. We do NOT skipWaiting automatically: a freshly
 * installed worker WAITS so old pages never mix with new assets.
 */
self.addEventListener("install", function (event) {
  event.waitUntil(
    (async function () {
      const cache = await caches.open(CACHE_NAME);
      const urls = precacheUrls();
      // Fetch with cache:"reload" to bypass the HTTP cache, so the precache
      // reflects the freshly built bytes. Any non-OK response fails install.
      const responses = await Promise.all(
        urls.map(async function (url) {
          const res = await fetch(new Request(url, { cache: "reload" }));
          if (!res || !res.ok) {
            throw new Error("precache fetch failed: " + url + " (" + (res && res.status) + ")");
          }
          return [url, res];
        }),
      );
      // Only AFTER every fetch succeeded do we write — an incomplete precache
      // never replaces a working version.
      await Promise.all(
        responses.map(function (pair) {
          return cache.put(pair[0], pair[1]);
        }),
      );
    })(),
  );
});

/**
 * ACTIVATE: take control of existing clients and delete ONLY caches owned by
 * THIS harness scope (the cachePrefix) that are not the current version. We
 * NEVER touch IndexedDB, unrelated caches, or other registrations.
 */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(function (key) {
          if (key.indexOf(MANIFEST.cachePrefix) === 0 && key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return undefined;
        }),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * MESSAGE: observable readiness + an explicit, user-driven update prompt.
 *  - "GHOSTSYNC_PRECACHE_STATUS": reply whether the current cache holds EVERY
 *    precached entry (the harness marks offline-ready only on a full match).
 *  - "GHOSTSYNC_SKIP_WAITING": an EXPLICIT opt-in for a waiting worker to take
 *    over (never automatic), used by the harness update prompt.
 */
self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type === "GHOSTSYNC_SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "GHOSTSYNC_CLEANUP") {
    // Run the SAME scoped cleanup as activation on demand (deterministic test of
    // the cleanup code path). Deletes ONLY caches with OUR prefix that are not the
    // current version; never touches unrelated caches, IndexedDB, or other
    // registrations. Replies when done.
    event.waitUntil(
      (async function () {
        const keys = await caches.keys();
        await Promise.all(
          keys.map(function (key) {
            if (key.indexOf(MANIFEST.cachePrefix) === 0 && key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return undefined;
          }),
        );
        if (event.source && "postMessage" in event.source) {
          event.source.postMessage({ type: "GHOSTSYNC_CLEANUP_DONE", cacheName: CACHE_NAME });
        }
      })(),
    );
    return;
  }
  if (data.type === "GHOSTSYNC_PRECACHE_STATUS") {
    event.waitUntil(
      (async function () {
        const cache = await caches.open(CACHE_NAME);
        const urls = precacheUrls();
        const present = await Promise.all(
          urls.map(async function (url) {
            const hit = await cache.match(url);
            return Boolean(hit);
          }),
        );
        const complete = present.every(Boolean);
        if (event.source && "postMessage" in event.source) {
          event.source.postMessage({
            type: "GHOSTSYNC_PRECACHE_STATUS",
            cacheVersion: MANIFEST.cacheVersion,
            cacheName: CACHE_NAME,
            complete: complete,
            total: urls.length,
          });
        }
      })(),
    );
  }
});

/**
 * FETCH: cache-first for precached assets; navigation requests fall back to the
 * cached shell. Everything else (unknown resources, cross-origin, non-GET) is
 * NOT intercepted, so ordinary 404s / failures stay VISIBLE — no SPA catch-all
 * that masks a missing .js or an unrelated request with HTML.
 */
self.addEventListener("fetch", function (event) {
  const request = event.request;
  // Only GET, same-origin, same-scope requests are eligible.
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) {
    return; // cross-origin or outside our scope — leave to the network.
  }

  // Navigation requests (the harness root or index.html) → cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      (async function () {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match(shellUrl());
        if (shell) {
          return shell;
        }
        // No cached shell (e.g. first-ever visit never completed install):
        // fall through to the network; offline this will fail VISIBLY.
        return fetch(request);
      })(),
    );
    return;
  }

  // Precached asset? Serve it from the cache. Only URLs we actually precached
  // are intercepted; an unknown asset request is left to the network so its
  // real 404/failure is not masked.
  const requestUrl = url.toString();
  if (precacheUrls().indexOf(requestUrl) === -1) {
    return;
  }
  event.respondWith(
    (async function () {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(requestUrl);
      if (hit) {
        return hit;
      }
      return fetch(request);
    })(),
  );
});
`;
}

/**
 * Render a TEST-ONLY worker whose install step ALWAYS rejects by attempting to
 * precache a URL that cannot exist (a genuine failed fetch), so the browser
 * discards it and never activates it. It shares the same cache prefix/version
 * so it would clean up after itself IF it ever activated — but it never does,
 * which is exactly the behavior the install-failure test asserts. The message
 * handler intentionally reports the precache as INCOMPLETE.
 */
function renderFailingServiceWorker(manifest: PrecacheManifest): string {
  const manifestLiteral = JSON.stringify(
    { cacheVersion: manifest.cacheVersion, cachePrefix: manifest.cachePrefix, entries: manifest.entries },
    null,
    2,
  );
  return `/**
 * GENERATED — TEST-ONLY failing Service Worker. Its install step fetches a
 * non-existent asset so install REJECTS and the worker is DISCARDED (never
 * activated). Used ONLY by the install-failure acceptance test to prove the
 * harness reports a FAILURE state and does NOT claim offline-ready. Not
 * registered in normal operation.
 */
/* eslint-disable */
"use strict";
const MANIFEST = ${manifestLiteral};
const CACHE_NAME = MANIFEST.cachePrefix + MANIFEST.cacheVersion;
self.addEventListener("install", function (event) {
  event.waitUntil(
    (async function () {
      // Open the cache (so a partial cache COULD exist) but then REJECT before
      // writing anything, modelling a precache that could not complete. The
      // rejected install makes the browser DISCARD this worker (it never
      // activates), and no entries are committed — an incomplete precache never
      // replaces a working version.
      await caches.open(CACHE_NAME);
      throw new Error("intentional install failure (test-only worker)");
    })(),
  );
});
self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type === "GHOSTSYNC_PRECACHE_STATUS" && event.source && "postMessage" in event.source) {
    event.source.postMessage({
      type: "GHOSTSYNC_PRECACHE_STATUS",
      cacheVersion: MANIFEST.cacheVersion,
      cacheName: CACHE_NAME,
      complete: false,
      total: MANIFEST.entries.length,
    });
  }
});
`;
}

/**
 * The Vite plugin. In `generateBundle` it enumerates the ACTUAL emitted files,
 * computes a deterministic cache version from their contents, and emits both
 * `sw.js` and `precache-manifest.json` as additional build assets. Applies only
 * to the production build (`apply: "build"`).
 */
export function swPrecachePlugin(): Plugin {
  return {
    name: "ghostsync-sw-precache",
    apply: "build",
    // Run AFTER Vite's core HTML plugin so `index.html` is already present in the
    // bundle and gets precached alongside the hashed asset chunks.
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
      const entries: PrecacheEntry[] = [];
      for (const [fileName, output] of Object.entries(bundle)) {
        if (EXCLUDED.has(fileName)) {
          continue;
        }
        // chunk → JS code; asset → its emitted source (string or bytes).
        const bytes: Uint8Array | string = output.type === "chunk" ? output.code : output.source;
        entries.push({ url: fileName, integrity: shortHash(bytes) });
      }
      // Deterministic order + deterministic version (content-derived, no time).
      entries.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
      const versionSeed = entries.map((e) => `${e.url}\u0000${e.integrity}`).join("\n");
      const cacheVersion = fullHash(versionSeed).slice(0, 16);

      const manifest: PrecacheManifest = {
        cacheVersion,
        cachePrefix: CACHE_PREFIX,
        entries,
      };

      this.emitFile({
        type: "asset",
        fileName: "precache-manifest.json",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: renderServiceWorker(manifest),
      });
      // TEST-ONLY sibling worker whose install GENUINELY rejects (a real failed
      // installation, NOT a mock). The acceptance suite registers this via the
      // harness `?sw=` override to prove an install failure is reported as a
      // failure state and NEVER as offline-ready. It is harmless in production:
      // nothing registers it unless a test explicitly asks for it by name.
      this.emitFile({
        type: "asset",
        fileName: "sw-install-fail.js",
        source: renderFailingServiceWorker(manifest),
      });
      },
    },
  };
}
