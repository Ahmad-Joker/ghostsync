/**
 * Static server for the PatchBoard acceptance suite (test infrastructure, not shipped).
 * Adapted from packages/persist/e2e/static-multiscope-server.mjs (baseline 916165f).
 * Serves the BUILT dist at "/" and, for the OPTIONAL sub-path test, at "/deploy-pb/".
 * `POST /__test/sw-bump` makes later sw.js responses carry one extra comment line so the
 * browser sees a byte-different worker (used by the waiting-worker scenario).
 *
 * Failed-precache fixture (test infrastructure only, never in dist):
 *   POST /__test/fail-asset?path=<relative url>&skip=<n>  first n requests for that path are served, later ones 404
 *   GET  /__test/request-log                              every request received, in arrival order
 *   POST /__test/reset                                    clears the failure rule and the log
 */
import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const PORT = Number.parseInt(process.env.PATCHBOARD_PORT ?? "4339", 10);
const SCOPE_PREFIXES = ["/deploy-pb/"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
let swBump = 0;
/** @type {{ path: string, skip: number, seen: number } | null} */
let failRule = null;
/** @type {Array<{ n: number, method: string, path: string, status: number, cacheControl: string }>} */
let requestLog = [];

function resolveDistPath(pathname) {
  let rel = pathname;
  for (const prefix of SCOPE_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) {
      rel = rel.slice(prefix.length - 1);
      break;
    }
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const full = join(DIST, normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ""));
  return full === DIST || full.startsWith(DIST + sep) ? full : null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/__test/")) {
    if (req.method === "POST" && url.pathname === "/__test/fail-asset") {
      failRule = { path: url.searchParams.get("path") ?? "", skip: Number.parseInt(url.searchParams.get("skip") ?? "1", 10), seen: 0 };
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/__test/reset") {
      failRule = null;
      requestLog = [];
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/__test/request-log") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(requestLog));
      return;
    }
  }
  const record = (status) => {
    if (url.pathname.startsWith("/__test/")) return;
    requestLog.push({ n: requestLog.length + 1, method: req.method ?? "GET", path: url.pathname, status, cacheControl: String(req.headers["cache-control"] ?? "") });
  };
  if (failRule !== null && req.method === "GET" && url.pathname === `/${failRule.path}`) {
    failRule.seen += 1;
    if (failRule.seen > failRule.skip) {
      record(404);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });
      res.end("not found");
      return;
    }
  }
  if (req.method === "POST" && url.pathname === "/__test/sw-bump") {
    swBump += 1;
    res.writeHead(204);
    res.end();
    return;
  }
  const filePath = resolveDistPath(decodeURIComponent(url.pathname));
  const notFound = () => {
    record(404);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  };
  if (filePath === null) return notFound();
  fs.stat(filePath)
    .then(async (stat) => {
      if (!stat.isFile()) return notFound();
      const headers = {
        "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-cache",
      };
      if (filePath.endsWith(`${sep}sw.js`)) {
        headers["service-worker-allowed"] = "./";
        if (swBump > 0) {
          const body = (await fs.readFile(filePath, "utf8")) + `\n// test bump ${swBump}\n`;
          record(200);
          res.writeHead(200, headers);
          res.end(body);
          return;
        }
      }
      record(200);
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(res);
    })
    .catch(notFound);
});
server.listen(PORT, () => {
  process.stdout.write(`patchboard static server on http://localhost:${PORT}\n`);
});
