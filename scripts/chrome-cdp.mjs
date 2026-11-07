#!/usr/bin/env node
/* Drive headless Chromium via CDP (no deps; Node's global WebSocket) to verify
 * the Mobcode SPA boots, renders views, opens the model picker, etc. */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:8090";
const CHROME = process.env.CHROME || "/usr/bin/chromium";
const PAGE_URL = new URL(process.argv[2] || "/", BASE).href;
const SCRIPT = process.argv[3] || "document.title";
const WAIT = Number(process.argv[4] || 3500);

const profile = mkdtempSync(join(tmpdir(), "mob-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--remote-allow-origins=*",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const pageWs = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", async (d) => {
    buf += d;
    if (resolve.done) return;
    const httpUrl = buf.match(/ws:\/\/(127\.0\.0\.1:\d+)\//);
    if (!httpUrl) return;
    resolve.done = true; // single attempt loop guarded below
    const hostport = httpUrl[1].replace("ws://", "");
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://${hostport}/json`);
        const targets = await res.json();
        let page = targets.find((t) => t.type === "page");
        if (!page) {
          const created = await fetch(`http://${hostport}/json/new?url=about:blank`, { method: "PUT" });
          if (created.ok) page = await created.json();
        }
        if (page?.webSocketDebuggerUrl) return resolve(page.webSocketDebuggerUrl);
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    reject(new Error("chromium page target missing: " + buf.slice(-400)));
  });
  setTimeout(() => { if (!resolve.done) { resolve.done = true; reject(new Error("chromium page target missing: " + buf.slice(-400))); } }, 9000);
});

let ws = null;
try {
  ws = new WebSocket(pageWs);
  await new Promise((res, rej) => { ws.onerror = rej; ws.onopen = res; });
} catch (e) {
  console.error("WS connect failed", e);
  process.exit(2);
}

let id = 0;
const pending = new Map();
const events = [];
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message + " " + JSON.stringify(msg.error.data || "")));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "uncaught", "promiseRejection"].includes(msg.params.type)) {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!(text.includes("Autofill") || text.includes("DevTools"))) events.push({ consoleError: text });
    }
    if (msg.method === "Runtime.exceptionThrown") {
      events.push({ exception: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "?" });
    }
  }
};

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp("Page.navigate", { url: PAGE_URL });
await cdp("Runtime.evaluate", { expression: `new Promise(r => setTimeout(r, ${WAIT}))`, awaitPromise: true });

const result = await cdp("Runtime.evaluate", {
  expression: SCRIPT,
  awaitPromise: true,
  returnByValue: true,
});
console.log("RESULT:", JSON.stringify(result.result?.value ?? result.result?.description, null, 2));

const errors = events.filter((e) => e.consoleError || e.exception);
if (errors.length) {
  console.log("PAGE ERRORS:");
  for (const e of errors.slice(0, 12)) console.log(" -", e.consoleError || e.exception);
} else {
  console.log("PAGE ERRORS: none");
}
ws.close();
chrome.kill("SIGKILL");
process.exit(0);
