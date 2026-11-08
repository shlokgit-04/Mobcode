#!/usr/bin/env node
/**
 * Mobcode companion server.
 *
 * Zero-dependency Node server that:
 *   1. Serves the Mobcode PWA (./public).
 *   2. Proxies everything else, same-origin, to a connected OpenCode server
 *      (/api/*, /event SSE, /provider*, /auth*, ... — any non-static path is
 *      forwarded so Mobcode always speaks only to the OpenCode server API).
 *   3. Injects the OpenCode `directory` scope and server password
 *      (Authorization: Bearer) so mobile clients never need secrets.
 *
 * Mobcode never talks to model provider APIs directly: every proxied request
 * targets the configured OpenCode server.
 *
 * Usage:
 *   node server.js
 *   node server.js --port 8090 --open http://127.0.0.1:46000 --directory /path/to/project
 *   node server.js --password "$OPENCODE_SERVER_PASSWORD" --allow-remote-admin
 *
 * Flags:
 *   --port <n>            listen port (default 8090, env PORT)
 *   --open <url>          OpenCode server URL (alias --target). Loopback ideal.
 *   --directory <dir>     OpenCode workspace directory injected into proxied
 *                         requests when the client does not supply one.
 *   --password <pw>       OpenCode server password (OPENCODE_SERVER_PASSWORD).
 *   --allow-remote-admin  allow non-localhost clients to change target config.
 *   --static-only         never proxy (PWA only).
 *   --no-persist          do not load/save mobcode.server.json.
 *   --dev                 disable static cache.
 *   --quiet               less logging.
 */
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const CONFIG_FILE = process.env.MOBCODE_CONFIG || join(__dirname, "mobcode.server.json");

// ---------------------------------------------------------------- CLI + config
const argv = process.argv.slice(2);
function arg(name, fallback = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  if (i >= 0) return true;
  return fallback;
}

const PORT = Number(arg("port", process.env.PORT || 8090));
const ALLOW_REMOTE_ADMIN = arg("allow-remote-admin") === true;
const STATIC_ONLY = arg("static-only") === true;
const DEV = arg("dev") === true;
const QUIET = arg("quiet") === true;
const AUTH_USER = String(arg("auth-user", process.env.OPENCODE_SERVER_USERNAME || "opencode") || "opencode");

let state = {
  target: "",
  directory: "",
  password: "",
};

// platform metadata for /health (no secrets)
const STARTED_AT = Date.now();
const VERSION = "1.1.0";

// 1) defaults from flags/env
const flagTarget = arg("target", "") || arg("open", "") || "";
if (typeof flagTarget === "string") applyTarget(flagTarget, true);
if (typeof arg("directory", "") === "string") state.directory = arg("directory", "").trim();
// flag wins, env is fallback — never both: concatenating them (previous
// .concat behaviour) doubled the password whenever --password and the exported
// engine var coexisted (production start-prod.sh wiring) and the engine then
// rejected every proxied request with 401.
state.password = String(arg("password", "") || "") || String(process.env.OPENCODE_SERVER_PASSWORD || "");

// 2) load saved config (not overriding explicit flags/env)
if (arg("no-persist") !== true) {
  try {
    const saved = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
    if (!state.target && saved.target) applyTarget(saved.target, true);
    if (!state.directory && saved.directory) state.directory = saved.directory;
    if (!state.password && saved.password) state.password = saved.password;
  } catch {
    // first run: no saved config yet
  }
}

function validTarget(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u;
  } catch {
    return null;
  }
}

/** target + optional http basic auth in URL -> {origin, password} */
function applyTarget(raw, silent = false) {
  if (typeof raw !== "string" || !raw.trim()) return false;
  const u = validTarget(raw.trim());
  if (!u) {
    if (!silent) console.error("Invalid OpenCode server URL:", raw);
    return false;
  }
  // accommodate http://user:pass@host style (basic auth)
  if (u.username && !state.password) state.password = decodeURIComponent(u.password || u.username);
  state.target = u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
  return true;
}

// ---------------------------------------------------------------- helpers
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
]);

// heavy, slow-built catalog endpoints get a short read-through cache
const CACHE_TTL = 30_000;
const CACHED_PREFIXES = [
  "/provider", "/api/model", "/api/provider", "/config/providers",
];
const proxyCache = new Map(); // origin+path -> {at, status, headers, body}

const PROXIED_PREFIXES = [
  "/api/", "/event", "/config", "/provider", "/auth", "/session", "/log",
  "/project", "/find", "/file", "/command", "/agent", "/lsp", "/formatter",
  "/mcp", "/tui", "/global", "/experimental", "/question", "/permission",
  "/vcs", "/sync", "/model", "/path", "/pty", "/openapi.json",
];

function shouldProxy(pathname) {
  if (STATIC_ONLY) return false;
  if (pathname === "/event" || pathname === "/api") return true;
  return PROXIED_PREFIXES.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/")
  );
}

function isLocal(req) {
  const addr = req.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// ---------------------------------------------------------------- CORS for packaged mobile clients
// The Android/iOS app loads the web UI from a virtual origin
// (https://localhost / capacitor://localhost / ionic://localhost) and calls this
// backend cross-origin. Web browsers are unaffected: same-origin requests have
// no Origin header and match nothing below.
const NATIVE_ORIGINS = new Set([
  "https://localhost", "capacitor://localhost", "ionic://localhost", "http://localhost",
]);

function nativeCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !NATIVE_ORIGINS.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  return true;
}

/** Preflight answer for cross-origin mobile clients. Always allowed for the
 *  fixed native origins — the backend itself performs credential checks. */
function handlePreflight(req, res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": req.headers.origin || "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With, Positron-Hostname",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  res.end();
}


function publicConfig() {
  return {
    ok: true,
    connected: Boolean(state.target),
    directory: state.directory || "",
    hasPassword: Boolean(state.password),
    staticOnly: Boolean(STATIC_ONLY),
    version: VERSION,
  };
}

function persist() {
  if (arg("no-persist") === true) return;
  const payload = JSON.stringify(
    { target: state.target, directory: state.directory, password: state.password },
    null,
    2
  );
  writeFile(CONFIG_FILE, payload)
    .then(() => chmod(CONFIG_FILE, 0o600).catch(() => {}))
    .catch(() => {});
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(data);
}

async function readBody(req, max = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new Error("body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------- proxy
function injectDirectory(pathname, search) {
  const sp = new URLSearchParams(search || "");
  if (state.directory && !sp.has("directory")) sp.set("directory", state.directory);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function proxy(req, res, url) {
  let tu;
  try {
    tu = new URL(state.target);
  } catch {
    return send(res, 503, {
      error: "Mobcode has no OpenCode server connected yet. Set it on the Connect screen.",
    });
  }

  const basePath = tu.pathname === "/" ? "" : tu.pathname.replace(/\/+$/, "");
  const targetPath = basePath + injectDirectory(url.pathname, url.search);

  const isStream = url.pathname === "/event" || url.pathname.startsWith("/event/") ||
    url.pathname === "/api/event" || url.pathname.startsWith("/api/event/");

  const headers = { ...req.headers };
  for (const h of Object.keys(headers)) if (HOP_BY_HOP.has(h.toLowerCase())) delete headers[h];
  // SSE must stay uncompressed; JSON responses may travel gzip'd (catalog is ~7MB raw)
  headers["accept-encoding"] = isStream ? "identity" : (req.headers["accept-encoding"] || "identity");
  headers.origin = tu.origin;
  if (state.password) {
    // OpenCode 2 requires HTTP basic auth ("opencode:<password>"); OpenCode 1 ignores it.
    headers.authorization = `Basic ${Buffer.from(`${AUTH_USER}:${state.password}`).toString("base64")}`;
  }

  // -- small read-through cache for heavy, slow-built catalog endpoints
  const cacheKey = tu.origin + targetPath;
  if (req.method === "GET" && !isStream) {
    const hit = proxyCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      res.writeHead(hit.status, hit.headers);
      return res.end(hit.body);
    }
  }

  const preq = {
    protocol: tu.protocol,
    hostname: tu.hostname,
    port: tu.port || (tu.protocol === "https:" ? 443 : 80),
    method: req.method,
    path: targetPath,
    headers,
  };

  const doRequest = tu.protocol === "https:" ? httpsRequest : httpRequest;
  const up = doRequest(preq, (pRes) => {
    const outHeaders = {};
    for (const [k, v] of Object.entries(pRes.headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      // upstream CORS headers must not override the ones set for native clients
      if (k.toLowerCase().startsWith("access-control-")) continue;
      outHeaders[k.toLowerCase()] = v;
    }
    res.writeHead(pRes.statusCode || 502, outHeaders);
    if (req.method === "HEAD") return res.end();

    const cacheable =
      req.method === "GET" && !isStream &&
      CACHED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
    if (!cacheable) {
      pRes.pipe(res, { end: true });
      pRes.on("error", () => toEnd(res));
      return;
    }
    const chunks = [];
    pRes.on("data", (c) => chunks.push(c));
    pRes.on("end", () => {
      const body = Buffer.concat(chunks);
      if (pRes.statusCode === 200) {
        proxyCache.set(cacheKey, { at: Date.now(), status: pRes.statusCode, headers: outHeaders, body });
      }
      res.end(body);
    });
    pRes.on("error", () => toEnd(res));
  });

  up.setTimeout(0); // SSE streams must never time out
  up.on("error", (err) => {
    if (!res.headersSent) send(res, 502, { error: `OpenCode server unreachable: ${err.message}` });
    else toEnd(res);
  });

  req.pipe(up, { end: true });
  req.on("error", () => up.destroy());
}

function toEnd(res) {
  try {
    res.end();
  } catch {}
}

// ---------------------------------------------------------------- static
const cache = new Map();

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://local");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const file = join(PUBLIC_DIR, normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });

  try {
    let body = cache.get(file);
    if (!body) {
      body = await readFile(file);
      if (!DEV) cache.set(file, body);
    }
    const headers = {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": DEV || extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
    };
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    if (!extname(p)) {
      // SPA fallback for client-side routes
      try {
        const shell = cache.get(join(PUBLIC_DIR, "index.html")) || (await readFile(join(PUBLIC_DIR, "index.html")));
        res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache" });
        return res.end(shell);
      } catch {}
    }
    send(res, 404, { error: "not found" });
  }
}

// ---------------------------------------------------------------- server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const isNativeClient = nativeCors(req, res);

  // CORS preflight: answered here, before anything else.
  if (isNativeClient && req.method === "OPTIONS") return handlePreflight(req, res);

  // -- public config (what the client needs before choosing anything)
  if (url.pathname === "/__mobcode/public" && req.method === "GET") {
    return send(res, 200, publicConfig(), { "cache-control": "no-store" });
  }

  // -- configure target (POST)
  if (url.pathname === "/__mobcode/target" && req.method === "POST") {
    if (!isLocal(req) && !ALLOW_REMOTE_ADMIN) {
      return send(res, 403, { error: "Remote configuration change denied (server flag --allow-remote-admin to lift)." });
    }
    try {
      const body = await readBody(req);
      let j = {};
      if (body) {
        try {
          j = JSON.parse(body);
        } catch {
          const p = new URLSearchParams(body);
          j = Object.fromEntries(p.entries());
        }
      }
      if (j.target || j.open) {
        const u = validTarget(String(j.target || j.open));
        if (!u) return send(res, 400, { error: "Invalid OpenCode server URL." });
        if (u.username) state.password = decodeURIComponent(u.password || u.username);
        state.target = u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
      }
      if (typeof j.directory === "string") state.directory = j.directory.trim();
      if (typeof j.password === "string") state.password = j.password;
      persist();
      return send(res, 200, publicConfig());
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // -- disconnect
  if (url.pathname === "/__mobcode/disconnect" && req.method === "POST") {
    if (!isLocal(req) && !ALLOW_REMOTE_ADMIN) return send(res, 403, { error: "not allowed" });
    state.target = "";
    persist();
    return send(res, 200, publicConfig());
  }

  // -- health: availability probe. Always answers while this process is alive.
  //    Never calls the OpenCode engine (cheap: no upstream traffic), never
  //    returns secrets — safe to expose publicly for uptime monitors.
  if (url.pathname === "/health" && (req.method === "GET" || req.method === "HEAD")) {
    return send(res, 200, {
      service: "mobcode",
      ok: true,
      version: VERSION,
      startedAt: new Date(STARTED_AT).toISOString(),
      uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
      uptimeReadable: `${Math.floor((Date.now() - STARTED_AT) / 3600000)}h ${Math.floor(((Date.now() - STARTED_AT) % 3600000) / 60000)}m`,
      engineConnected: Boolean(state.target),
      anonymous: !Boolean(state.target),
      memoryRssBytes: process.memoryUsage().rss,
      node: process.version,
    }, { "cache-control": "no-store" });
  }

  // -- keepalive: ultra-cheap liveness ping for EXTERNAL monitors (e.g. cron-job.org).
  //    Always 200 while the server core is running; no state, no I/O, no secrets.
  //    (The server does NOT self-ping: an external monitor keeps Render awake.)
  if (url.pathname === "/health/keepalive" && (req.method === "GET" || req.method === "HEAD")) {
    return send(res, 200, { ok: true, ts: Date.now() }, { "cache-control": "no-store" });
  }

  if (shouldProxy(url.pathname)) {
    // writes to auth/provider change the catalog — drop cached reads
    if (req.method !== "GET" && (url.pathname.startsWith("/auth") || url.pathname.startsWith("/provider"))) {
      proxyCache.clear();
    }
    return proxy(req, res, url);
  }
  return serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mobcode server listening on http://0.0.0.0:${PORT}`);
  console.log(`  target: ${state.target || "(none — configure on the Connect screen)"}`);
  if (state.directory) console.log(`  directory: ${state.directory}`);
  if (state.password) console.log("  password: (set)");
  if (ALLOW_REMOTE_ADMIN) console.log("  remote admin: allowed");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} in use. Try: node server.js --port ${PORT + 1}`);
    process.exit(1);
  }
  console.error("Server error:", e);
  process.exit(1);
});
