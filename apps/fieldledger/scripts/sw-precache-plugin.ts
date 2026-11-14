/**
 * ADAPTED COPY of packages/persist/scripts/sw-precache-plugin.ts (baseline 916165f), with the
 * FieldLedger cache prefix; the test-only failing worker was dropped. packages/persist is
 * untouched.
 *
 * Build-time Service Worker + precache-manifest generator for the FieldLedger (offline-assets milestone). This is BUILD/SERVE TOOLING ONLY
 * â€” no sync, CRDT, or persistence logic lives here. It wraps the existing Vite
 * app build so a PRODUCTION build emits:
 *
 *   dist/sw.js               â€” a small, dependency-free Service Worker whose
 *                              precache manifest + cache version are injected
 *                              from the ACTUAL emitted bundle (never hardcoded
 *                              hashed filenames).
 *   dist/precache-manifest.json  â€” the same manifest as an inspectable artifact.
 *
 * Why a plugin and not a static `public/sw.js`: the SW must precache EVERY
 * emitted asset required to boot the shell, and Vite emits content-hashed
 * filenames (e.g. `assets/index-<hash>.js`) that are unknown until the bundle
 * exists. We discover them from Vite's `bundle` object in `generateBundle`, so
 * the manifest always matches what was actually built.
 *
 * Determinism: the cache version is a SHA-256 over the SORTED list of
 * `url\u0000integrity` pairs of every precached entry. Identical build CONTENTS
 * â‡’ identical cache version; any changed byte in any precached asset â‡’ a new
 * version. The version is NOT derived from timestamps or build counters.
 *
 * Scope + naming (concrete choices, scope-relative, no hardcoded ports/paths):
 *   - SW file:        sw.js at the deployment root (alongside index.html), so
 *                     its default scope is the app deployment directory. It
 *                     works unchanged under a subpath because every URL it
 *                     touches is resolved RELATIVE to the worker's own location
 *                     (`self.registration.scope`), never an absolute `/path`.
 *   - cache prefix:   "ghostsync-fieldledger-" (the base prefix) COMBINED
 *                     with the worker's actual registration SCOPE PATH, so two
 *                     deployments of the SAME build under DIFFERENT paths on one
 *                     origin own SEPARATE cache namespaces. Activation/cleanup
 *                     deletes ONLY caches whose name begins with this exact
 *                     scope-specific prefix that are not the current version.
 *   - cache name:     `${CACHE_PREFIX}${SCOPE_PATH}::${CACHE_VERSION}` where the
 *                     scope path is `self.registration.scope`'s pathname. The
 *                     scope distinguishes DEPLOYMENTS on one origin; the
 *                     content-derived version distinguishes old-vs-new WITHIN a
 *                     scope.
 */
import { createHash } from "node:crypto";

import type { Plugin } from "vite";

/** The scoped cache-name prefix. Activation cleans ONLY caches with this prefix. */
export const CACHE_PREFIX = "ghostsync-fieldledger-";

/** A single precached entry: a scope-relative URL + a content integrity hash. */
interface PrecacheEntry {
  /** Scope-relative URL (no leading slash), e.g. "index.html" or "assets/x.js". */
  readonly url: string;
  /** Short SHA-256 (hex, 16 chars) of the emitted bytes â€” detects content change. */
  readonly integrity: string;
}

/** The emitted precache manifest (written to disk + inlined into sw.js). */
interface PrecacheManifest {
  readonly cacheVersion: string;
  readonly cachePrefix: string;
  readonly entries: readonly PrecacheEntry[];
}

/** File names that must never be precached (the worker + its own manifest). */
const EXCLUDED = new Set(["sw.js", "precache-manifest.json"]);

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
 * GENERATED â€” GhostSync FieldLedger Service Worker (offline-assets
 * milestone). Do not edit by hand; regenerate with the app build. This file
 * caches the app SHELL + its build-emitted ASSETS so a PREVIOUSLY-INITIALIZED
 * profile can boot the app with networking disabled. It does NOT cache
 * IndexedDB contents, sync messages, non-GET requests, arbitrary URLs, or any
 * external/cross-origin resource.
 */
/* eslint-disable */
"use strict";

// Injected from the ACTUAL emitted bundle at build time (never hardcoded).
const MANIFEST = ${manifestLiteral};

/**
 * Cache ownership is specific to the actual registration SCOPE. The base prefix
 * (MANIFEST.cachePrefix) is combined with this worker's registration-scope
 * PATHNAME, so two deployments of the SAME build under DIFFERENT paths on one
 * origin own SEPARATE cache namespaces (identical build contents still produce
 * DIFFERENT cache names because the scope path differs). Within a single scope,
 * the content-derived version distinguishes old-vs-new.
 *
 * SCOPE_PREFIX = cachePrefix + <scope-pathname> + "::"  (the per-scope owner)
 * CACHE_NAME   = SCOPE_PREFIX + cacheVersion            (this version in scope)
 *
 * Cleanup deletes ONLY caches whose name begins with SCOPE_PREFIX that are not
 * CACHE_NAME â€” never a cache owned by another scope (its SCOPE_PREFIX differs),
 * never an unrelated cache, never IndexedDB, never another registration.
 */
function scopePrefix() {
  return MANIFEST.cachePrefix + new URL(self.registration.scope).pathname + "::";
}

function cacheName() {
  return scopePrefix() + MANIFEST.cacheVersion;
}

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
 * The documented app navigation routes (scope-relative), as fully-resolved
 * URLs: the deployment ROOT ("" â†’ the scope directory itself) and its
 * "index.html". Only these receive the cached HTML shell on a navigation; any
 * other path (including a missing-.js path requested as a navigation) is NOT
 * served the shell â€” it misses â†’ network â†’ honest offline failure.
 */
function documentedNavUrls() {
  return [
    new URL("", self.registration.scope).toString(),
    new URL("index.html", self.registration.scope).toString(),
  ];
}

/** Delete ONLY older caches owned by THIS exact scope (never other scopes). */
async function cleanupThisScope() {
  const current = cacheName();
  const prefix = scopePrefix();
  const keys = await caches.keys();
  await Promise.all(
    keys.map(function (key) {
      if (key.indexOf(prefix) === 0 && key !== current) {
        return caches.delete(key);
      }
      return undefined;
    }),
  );
}

/**
 * INSTALL: populate the precache ATOMICALLY. We fetch every entry and only
 * resolve install once ALL responses are OK and stored. If ANY asset fails,
 * install REJECTS â€” the browser discards this worker and KEEPS the previously
 * installed (working) version. We do NOT skipWaiting automatically: a freshly
 * installed worker WAITS so old pages never mix with new assets.
 */
self.addEventListener("install", function (event) {
  event.waitUntil(
    (async function () {
      const cache = await caches.open(cacheName());
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
      // Only AFTER every fetch succeeded do we write â€” an incomplete precache
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
 * THIS app scope (the cachePrefix) that are not the current version. We
 * NEVER touch IndexedDB, unrelated caches, or other registrations.
 */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      await cleanupThisScope();
      await self.clients.claim();
    })(),
  );
});

/**
 * MESSAGE: observable readiness + an explicit, user-driven update prompt.
 *  - "GHOSTSYNC_PRECACHE_STATUS": reply whether the current cache holds EVERY
 *    precached entry (the app marks offline-ready only on a full match).
 *  - "GHOSTSYNC_SKIP_WAITING": an EXPLICIT opt-in for a waiting worker to take
 *    over (never automatic), used by the app update prompt.
 */
self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type === "GHOSTSYNC_SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "GHOSTSYNC_CLEANUP") {
    // Run the SAME scoped cleanup as activation on demand (deterministic test of
    // the cleanup code path). Deletes ONLY caches owned by THIS exact scope that
    // are not the current version; never touches another scope's caches,
    // unrelated caches, IndexedDB, or other registrations. Replies when done.
    event.waitUntil(
      (async function () {
        await cleanupThisScope();
        if (event.source && "postMessage" in event.source) {
          event.source.postMessage({ type: "GHOSTSYNC_CLEANUP_DONE", cacheName: cacheName() });
        }
      })(),
    );
    return;
  }
  if (data.type === "GHOSTSYNC_PRECACHE_STATUS") {
    event.waitUntil(
      (async function () {
        const cache = await caches.open(cacheName());
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
            cacheName: cacheName(),
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
 * NOT intercepted, so ordinary 404s / failures stay VISIBLE â€” no SPA catch-all
 * that masks a missing .js or an unrelated request with HTML.
 */
self.addEventListener("fetch", function (event) {
  const request = event.request;
  // Only GET, same-origin, same-scope requests are eligible.
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  // FieldLedger adaptation: Chromium keeps the URL fragment on navigation requests, and the
  // app carries the incident in the hash (#/i/<id>). Drop it so the documented shell URLs match.
  url.hash = "";
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) {
    return; // cross-origin or outside our scope â€” leave to the network.
  }

  const requestUrl = url.toString();

  // Navigation requests â†’ cached shell, but ONLY for the DOCUMENTED routes (the
  // deployment root and index.html). An unknown navigation path â€” INCLUDING a
  // missing-.js path requested as a navigation â€” is NOT served the HTML shell;
  // it falls through to the network so offline it fails VISIBLY (a real miss,
  // never a masked 200-HTML catch-all).
  if (request.mode === "navigate") {
    if (documentedNavUrls().indexOf(requestUrl) === -1) {
      return; // unknown route â€” leave to the network; never serve the shell.
    }
    event.respondWith(
      (async function () {
        const cache = await caches.open(cacheName());
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
  if (precacheUrls().indexOf(requestUrl) === -1) {
    return;
  }
  event.respondWith(
    (async function () {
      const cache = await caches.open(cacheName());
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
        // chunk â†’ JS code; asset â†’ its emitted source (string or bytes).
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
      },
    },
  };
}
