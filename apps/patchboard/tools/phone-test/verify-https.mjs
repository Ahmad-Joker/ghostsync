/**
 * Checks serve-https.mjs against the production build WITHOUT installing anything: makes a throwaway self-signed
 * certificate in a temp directory (needs `openssl` on PATH, or set OPENSSL), serves dist on 127.0.0.1 for the run, checks the
 * responses over verified TLS (the temp certificate is pinned as the only CA), then stops and deletes everything.
 * Not part of the app and not physical evidence. Needs `pnpm.cmd -F @ghostsync/patchboard build` first.
 *
 *   node apps/patchboard/tools/phone-test/verify-https.mjs [--no-browser]
 */
import { execFileSync, spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPrivateClient, startServer } from "./serve-https.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");
const openssl = process.env.OPENSSL ?? "openssl";
const PORT = 4452;
const tmp = mkdtempSync(join(tmpdir(), "gs-https-"));
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); };
let server;
try {
  const cfg = join(tmp, "san.cnf");
  writeFileSync(cfg, "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n");
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tmp, "k.pem"), "-out", join(tmp, "c.pem"), "-days", "1", "-config", cfg], { stdio: "ignore" });
  const cert = readFileSync(join(tmp, "c.pem")), key = readFileSync(join(tmp, "k.pem"));
  server = await startServer({ dist, port: PORT, host: "127.0.0.1", cert, key, rootCa: cert });

  const get = (path, method = "GET") => new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", servername: "localhost", port: PORT, path, method, ca: cert }, (res) => {
      const chunks = [];
      const protocol = res.socket.getProtocol();
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), protocol }));
    });
    req.on("error", fail);
    req.end();
  });

  const manifest = JSON.parse(readFileSync(join(dist, "precache-manifest.json"), "utf8"));
  const root = await get("/");
  check(root.status === 200 && root.headers["content-type"] === "text/html; charset=utf-8", `/ -> ${root.status} ${root.headers["content-type"]}`);
  check(root.body.toString("utf8") === readFileSync(join(dist, "index.html"), "utf8"), "/ body equals dist/index.html");
  check(String(root.protocol).startsWith("TLS"), `protocol ${root.protocol}`);
  check(root.headers["cache-control"] === "no-cache" && root.headers["x-content-type-options"] === "nosniff", "cache-control no-cache and nosniff");
  const sw = await get("/sw.js");
  check(sw.status === 200 && sw.headers["content-type"] === "text/javascript; charset=utf-8" && sw.headers["service-worker-allowed"] === "./", `sw.js headers ${JSON.stringify(sw.headers)}`);
  let served = 0;
  for (const e of manifest.entries) {
    const r = await get(`/${e.url}`);
    const expected = readFileSync(join(dist, e.url));
    check(r.status === 200 && Buffer.compare(r.body, expected) === 0, `precache entry ${e.url}: ${r.status}`);
    if (e.url.endsWith(".js")) check(r.headers["content-type"] === "text/javascript; charset=utf-8", `${e.url} content-type ${r.headers["content-type"]}`);
    if (e.url.endsWith(".css")) check(r.headers["content-type"] === "text/css; charset=utf-8", `${e.url} content-type ${r.headers["content-type"]}`);
    served += 1;
  }
  const mf = await get("/precache-manifest.json");
  check(mf.status === 200 && mf.headers["content-type"] === "application/json; charset=utf-8", "precache-manifest.json served as JSON");
  check((await get("/index.html", "HEAD")).status === 200, "HEAD works");
  check((await get("/__test/request-log")).status === 404, "no test endpoints");
  check((await get("/%2e%2e/%2e%2e/package.json")).status === 404, "path traversal refused");
  check((await get("/nope.js")).status === 404, "unknown file is a real 404");
  check((await get("/", "POST")).status === 405, "POST refused");
  const ca = await get("/__root-ca.crt");
  check(ca.status === 200 && ca.headers["content-type"] === "application/x-x509-ca-cert" && ca.body.toString().includes("BEGIN CERTIFICATE") && !ca.body.toString().includes("PRIVATE KEY"), "root certificate route serves a public certificate only");
  check(isPrivateClient("192.168.1.20") && isPrivateClient("::ffff:10.0.0.5") && isPrivateClient("172.16.0.1") && isPrivateClient("127.0.0.1") && !isPrivateClient("8.8.8.8") && !isPrivateClient("172.32.0.1") && !isPrivateClient("2001:db8::1"), "private-client filter");

  // The command-line entry itself (the way the tester runs it), HTTPS then --http.
  const cli = async (extra, secure) => {
    const child = spawn(process.execPath, [join(here, "serve-https.mjs"), "--host", "127.0.0.1", "--cert", join(tmp, "c.pem"), "--key", join(tmp, "k.pem"), ...extra], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const port = Number(extra[extra.indexOf("--port") + 1]);
      const status = await new Promise((ok, fail) => {
        const mod = secure ? request : httpRequest;
        const req = mod({ host: "127.0.0.1", port, path: "/", method: "GET", ...(secure ? { ca: cert, servername: "localhost" } : {}) }, (res) => { res.resume(); ok(res.statusCode); });
        req.on("error", fail);
        req.end();
      });
      check(status === 200, `CLI ${extra.join(" ")} -> ${status}`);
    } finally {
      child.kill();
    }
  };
  await cli(["--port", "4455"], true);
  await cli(["--http", "--port", "4456"], false);

  let browserLine = "browser check skipped (--no-browser)";
  if (!process.argv.includes("--no-browser")) {
    const { chromium } = await import("@playwright/test");
    // Observation only: with the certificate NOT trusted (errors merely ignored) record what the app reports.
    const b0 = await chromium.launch();
    let untrusted = "";
    try {
      const c0 = await b0.newContext({ ignoreHTTPSErrors: true });
      const p0 = await c0.newPage();
      await p0.goto(`https://localhost:${PORT}/`);
      await p0.waitForTimeout(4000);
      untrusted = await p0.evaluate(() => `${document.documentElement.getAttribute("data-offline-state")}/ready=${document.documentElement.getAttribute("data-offline-ready")}`);
      await c0.close();
    } finally {
      await b0.close();
    }
    // Trusted stand-in: Chromium is told to accept exactly this certificate's public key (no system change).
    const spki = createHash("sha256").update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" })).digest("base64");
    const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${spki}`] });
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`https://localhost:${PORT}/`);
      await page.waitForSelector('html[data-offline-ready="true"]', { timeout: 15000 });
      const secure = await page.evaluate(() => window.isSecureContext);
      check(secure, "page is a secure context");
      await ctx.setOffline(true);
      await page.reload();
      await page.waitForSelector('html[data-offline-ready="true"]', { timeout: 15000 });
      browserLine = `Chromium with the certificate accepted by SPKI pin (stand-in for a trusted cert): secure context, 'Ready to work offline', offline reload from the service worker OK. Same page with the certificate untrusted (errors ignored): ${untrusted}. NOT a Safari result`;
      await ctx.close();
    } finally {
      await browser.close();
    }
  }
  process.stdout.write(`served ${served} precache entries over TLS with correct types; ${browserLine}\n`);
} finally {
  if (server !== undefined) await new Promise((r) => server.close(r));
  rmSync(tmp, { recursive: true, force: true });
}
if (failures.length > 0) {
  process.stdout.write(`FAIL\n${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("https helper checks passed; temp certificate deleted\n");
