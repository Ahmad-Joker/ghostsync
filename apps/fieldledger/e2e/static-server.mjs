/**
 * Static server for the FieldLedger acceptance suite (test infrastructure, not shipped).
 * Adapted from packages/persist/e2e/static-multiscope-server.mjs (baseline 916165f).
 * Serves the BUILT dist at "/" and, for the OPTIONAL sub-path test, at "/deploy-fl/".
 * `POST /__test/sw-bump` makes later sw.js responses carry one extra comment line so the
 * browser sees a byte-different worker (used by the waiting-worker scenario).
 */
import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const PORT = Number.parseInt(process.env.FIELDLEDGER_PORT ?? "4329", 10);
const SCOPE_PREFIXES = ["/deploy-fl/"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
let swBump = 0;

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
  if (req.method === "POST" && url.pathname === "/__test/sw-bump") {
    swBump += 1;
    res.writeHead(204);
    res.end();
    return;
  }
  const filePath = resolveDistPath(decodeURIComponent(url.pathname));
  const notFound = () => {
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
          res.writeHead(200, headers);
          res.end(body);
          return;
        }
      }
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(res);
    })
    .catch(notFound);
});
server.listen(PORT, () => {
  process.stdout.write(`fieldledger static server on http://localhost:${PORT}\n`);
});
