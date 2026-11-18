/**
 * Multi-scope static server for the offline-assets acceptance suite.
 *
 * The harness is built with Vite `base: "./"`, so every URL it references
 * (assets, `./sw.js`, the SW registration `scope: "./"`) is RELATIVE to the
 * document location. That lets us serve the SAME built `harness/dist` directory
 * under SEVERAL path prefixes on ONE origin:
 *
 *   /            → the deployment at the origin root (existing tests use this)
 *   /deploy-p1/  → a SECOND, independent deployment scope
 *   /deploy-p2/  → a THIRD, independent deployment scope
 *
 * Serving one build under two sub-paths is exactly the real-world situation the
 * scope-specific cache-naming fix addresses: two deployments of the SAME build
 * on one origin must own SEPARATE Service Worker cache namespaces, and a SW
 * registered at `/deploy-p1/sw.js` can only ever control `/deploy-p1/` (the
 * browser's own scope restriction), so its activation/cleanup can never touch
 * another deployment's cache.
 *
 * This is build/serve TOOLING ONLY — no sync, CRDT, or persistence logic lives
 * here. It is a dependency-free Node http server (no new packages).
 */
import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../harness/dist/", import.meta.url));
const PORT = Number.parseInt(process.env.GHOSTSYNC_HARNESS_PORT ?? "4319", 10);

/** The sub-path prefixes that each map to the SAME built harness dist. */
const SCOPE_PREFIXES = ["/deploy-p1/", "/deploy-p2/"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

/**
 * Map a request pathname to a file path WITHIN dist, stripping any scope prefix.
 * Returns null if the resolved path escapes dist (defensive) — the server then
 * replies 404 so an unknown path is an HONEST miss, never a masked 200.
 */
function resolveDistPath(pathname) {
  let rel = pathname;
  for (const prefix of SCOPE_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.indexOf(prefix) === 0) {
      rel = rel.slice(prefix.length - 1); // keep the leading slash
      break;
    }
  }
  // A directory request ("/", "/deploy-p1/") serves index.html.
  if (rel === "" || rel.endsWith("/")) {
    rel += "index.html";
  }
  const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = join(DIST, safe);
  if (!full.startsWith(DIST.replace(new RegExp(`${sep === "\\" ? "\\\\" : sep}$`), "") + sep) && full !== join(DIST, "index.html")) {
    // Still allow exact dist root files; reject traversal outside dist.
    if (!full.startsWith(DIST)) {
      return null;
    }
  }
  return full;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const filePath = resolveDistPath(url.pathname);
  if (filePath === null) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  fs.stat(filePath)
    .then((stat) => {
      if (!stat.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
      // Service-Worker-Allowed lets a worker at the dist root claim the deploy
      // scope; each sub-path worker still defaults to its own sub-path scope.
      const headers = { "content-type": type, "cache-control": "no-cache" };
      if (filePath.endsWith("sw.js") || filePath.endsWith("sw-install-fail.js")) {
        headers["service-worker-allowed"] = "./";
      }
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(res);
    })
    .catch(() => {
      // Missing file → honest 404 (never fall back to index.html). This keeps a
      // missing-.js an actual failure, matching the SW's no-catch-all policy.
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    });
});

server.listen(PORT, () => {
  process.stdout.write(`multiscope harness server on http://localhost:${PORT} (scopes: / ${SCOPE_PREFIXES.join(" ")})\n`);
});
