/**
 * Phone-test tooling (NOT shipped). Static HTTPS server for the PRODUCTION build (apps/patchboard/dist), so a real iPhone
 * can load PatchBoard in a secure context (camera + service worker). Serves files only: no API, no test endpoints.
 *
 *   node apps/patchboard/tools/phone-test/serve-https.mjs [--port 4443] [--host 0.0.0.0] [--cert <pem>] [--key <pem>] [--root-ca <rootCA.pem>] [--http]
 *
 * Defaults: port 4443, host 0.0.0.0 (all interfaces, so the phone can reach it), cert tools/phone-test/certs/lan.pem,
 * key tools/phone-test/certs/lan-key.pem (the certs/ folder is git-ignored). Only clients on private or loopback addresses
 * are served (RFC 1918, link-local, 100.64/10, loopback, IPv6 ULA and link-local); anything else gets 403.
 * `--http` serves plain HTTP on 127.0.0.1 (default port 4480) for use BEHIND a tunnel that terminates TLS (the alternative path); in that mode every
 * request arrives from loopback, so the private-client filter does not protect anything: only start a tunnel with the owner's consent.
 * `--root-ca` also serves that PUBLIC certificate at /__root-ca.crt so a phone can download it. Never point it at a key.
 * Stop with Ctrl+C.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

export function isPrivateClient(address) {
  if (typeof address !== "string") return false;
  const a = address.replace(/^::ffff:/i, "").toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
  if (v4 !== null) {
    const o1 = Number(v4[1]), o2 = Number(v4[2]);
    return o1 === 10 || o1 === 127 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254) || (o1 === 100 && o2 >= 64 && o2 <= 127);
  }
  return a === "::1" || a.startsWith("fe80:") || a.startsWith("fc") || a.startsWith("fd");
}

export function startServer({ dist, port, host, cert, key, rootCa }) {
  const root = resolve(dist);
  const make = cert === undefined ? (handler) => createHttp(handler) : (handler) => createHttps({ cert, key }, handler);
  const server = make((req, res) => {
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store", ...extra });
      res.end(body);
    };
    if (!isPrivateClient(req.socket.remoteAddress)) return send(403, "forbidden");
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "method not allowed", { allow: "GET, HEAD" });
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "https://x.invalid").pathname);
    } catch {
      return send(400, "bad request");
    }
    if (rootCa !== undefined && pathname === "/__root-ca.crt") {
      res.writeHead(200, { "content-type": "application/x-x509-ca-cert", "content-disposition": 'attachment; filename="ghostsync-phone-test-root.crt"', "cache-control": "no-store" });
      return res.end(req.method === "HEAD" ? undefined : rootCa);
    }
    let rel = pathname;
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const full = join(root, normalize(rel).replace(/^([/\\]|\.\.([/\\]|$))+/, ""));
    if (full !== root && !full.startsWith(root + sep)) return send(404, "not found");
    let stat;
    try {
      stat = statSync(full);
    } catch {
      return send(404, "not found");
    }
    if (!stat.isFile()) return send(404, "not found");
    const headers = {
      "content-type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(stat.size),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    };
    if (full.endsWith(`${sep}sw.js`)) headers["service-worker-allowed"] = "./";
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    createReadStream(full).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => ok(server));
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const plain = process.argv.includes("--http");
  const port = Number.parseInt(arg("port", plain ? "4480" : "4443"), 10);
  const host = arg("host", plain ? "127.0.0.1" : "0.0.0.0");
  const dist = arg("dist", join(here, "..", "..", "dist"));
  const certPath = arg("cert", join(here, "certs", "lan.pem"));
  const keyPath = arg("key", join(here, "certs", "lan-key.pem"));
  const rootCaPath = arg("root-ca", undefined);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("invalid --port\n");
    process.exit(2);
  }
  if (!existsSync(join(dist, "index.html"))) {
    process.stderr.write(`no production build at ${dist}. Run: pnpm.cmd -F @ghostsync/patchboard build\n`);
    process.exit(2);
  }
  if (!plain && (!existsSync(certPath) || !existsSync(keyPath))) {
    process.stderr.write(`certificate or key not found (${certPath}, ${keyPath}). See docs/qr-physical-test.md, step "Make the certificate".\n`);
    process.exit(2);
  }
  const server = await startServer({ dist, port, host, cert: plain ? undefined : readFileSync(certPath), key: plain ? undefined : readFileSync(keyPath), rootCa: rootCaPath === undefined ? undefined : readFileSync(rootCaPath) });
  process.stdout.write(`Serving ${resolve(dist)} over ${plain ? "plain HTTP (behind a tunnel only)" : "HTTPS"} on ${host}:${port}${plain ? "" : " (private-network clients only)"}. Ctrl+C to stop.\n`);
  const ips = Object.values(networkInterfaces()).flat().filter((n) => n !== undefined && n.family === "IPv4" && !n.internal).map((n) => n.address);
  if (!plain) for (const ip of ips) process.stdout.write(`  candidate phone URL (if this is your Wi-Fi address): https://${ip}:${port}/\n`);
  if (rootCaPath !== undefined) process.stdout.write(`  root certificate download: https://<laptop-lan-ip>:${port}/__root-ca.crt\n`);
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}
