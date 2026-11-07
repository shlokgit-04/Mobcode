#!/usr/bin/env node
/**
 * Mobcode scripted local regression suite (zero npm deps, Node 22+).
 *
 * Runs against the companion server (which proxies the engine):
 *   node scripts/regression.mjs [baseURL]      # default http://127.0.0.1:8090
 *
 * Covers: health/keepalive, companion metadata, engine info, models,
 * providers, MCP, projects, session create, model switch, fs write/read
 * (attachment pipeline), real prompt + SSE streaming, message retrieval,
 * session cleanup. Exits non-zero on any failure.
 */
const BASE = (process.argv[2] || process.env.MOBCODE_BASE || "http://127.0.0.1:8090").replace(/\/+$/, "");
const results = [];
let sessionID = null;
let testFile = `regression-${Date.now()}.txt`;

function rec(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function req(method, path, body, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : (opts.headers || {}),
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(opts.timeoutMs || 20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const expect = (r, ...statuses) => statuses.includes(r.status);

/* ---------- 1/2: platform endpoints ---------- */
{
  const h = await req("GET", "/health");
  rec("health endpoint", expect(h, 200) && h.json?.service === "mobcode" && h.json?.ok === true, `v${h.json?.version} rss=${Math.round((h.json?.memoryRssBytes || 0) / 1e6)}MB`);
  const k = await req("GET", "/health/keepalive");
  rec("keepalive endpoint", expect(k, 200) && k.json?.ok === true, "");
  const pub = await req("GET", "/__mobcode/public");
  rec("companion metadata", expect(pub, 200), "");
}

/* ---------- 3: engine reachable + catalogues ---------- */
{
  const info = await req("GET", "/api/info");
  rec("engine /api/info", expect(info, 200) && Boolean(info.json?.version || info.json?.data?.version), info.json?.version || info.json?.data?.version || `status ${info.status}`);
  const models = await req("GET", "/api/model");
  const list = models.json?.data || models.json || [];
  rec("model catalogue", expect(models, 200) && Array.isArray(list) && list.length > 0, `${list.length} models`);
  const prov = await req("GET", "/api/provider");
  const plist = prov.json?.data || prov.json || [];
  rec("provider catalogue", expect(prov, 200) && Array.isArray(plist) && plist.length > 0, `${plist.length} providers`);
  const mcp = await req("GET", "/api/mcp");
  rec("MCP list", expect(mcp, 200) && (mcp.json?.data || mcp.json) !== undefined, `${(mcp.json?.data || mcp.json || []).length} servers`);
  const proj = await req("GET", "/api/project");
  const prlist = proj.json?.data || proj.json || [];
  rec("project list", expect(proj, 200) && Array.isArray(prlist), `${prlist.length} projects`);
}

/* ---------- 4: session + model switch ---------- */
{
  const created = await req("POST", "/api/session", { agent: "build" });
  const sess = created.json?.data || created.json;
  sessionID = sess?.id;
  rec("session create", expect(created, 200) && Boolean(sessionID), `id=${(sessionID || "").slice(0, 12)}`);

  if (sessionID) {
    const models = await req("GET", "/api/model");
    const list = models.json?.data || models.json || [];
    const pick = list.find((m) => m.providerID && m.id);
    const sw = await req("POST", `/api/session/${sessionID}/model`, { model: { providerID: pick.providerID, id: pick.id } });
    rec("model switch", expect(sw, 200, 201, 204), `${pick.providerID}/${pick.id}`);
  }
}

/* ---------- 5: attachment pipeline (fs write → read) ---------- */
{
  const bytes = new TextEncoder().encode(`Mobcode regression attachment ${Date.now()}`);
  const w = await fetch(`${BASE}/api/experimental/fs/write?path=${encodeURIComponent(testFile)}`, {
    method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes,
    signal: AbortSignal.timeout(20000),
  });
  const wtext = await w.text();
  rec("fs binary write", w.status === 200 || w.status === 201, wtext.slice(0, 80));
  const r = await req("GET", `/api/fs/read/${encodeURIComponent(testFile)}`);
  rec("fs read back", expect(r, 200) && decodeURIComponent(escape(r.text)).includes("Mobcode regression attachment"), `${r.text.length} bytes`);
}

/* ---------- 6: SSE listening while prompting ---------- */
let sseGotRelevantEvent = false;
{
  const ab = new AbortController();
  const seen = [];
  const sse = fetch(`${BASE}/api/event`, { signal: ab.signal }).then(async (res) => {
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            const type = ev.type || "";
            if (type) seen.push(type);
            if (sessionID && JSON.stringify(ev).includes(sessionID) &&
                /session\.created|session\.updated|session\.(text|step|error)|message\.(updated|part)|execution/.test(type)) {
              sseGotRelevantEvent = true;
            }
          } catch {}
        }
      }
    } catch {}
  }).catch(() => {});

  /* ---------- real prompt (steer delivery per engine enum) ---------- */
  if (sessionID) {
    const prompt = await req("POST", `/api/session/${sessionID}/prompt`, {
      text: "Reply with exactly the token MOBCODE-REGRESSION-OK and nothing else.",
      delivery: "steer",
    }, { timeoutMs: 45000 });
    rec("prompt accepted", expect(prompt, 200, 201, 204), `HTTP ${prompt.status}`);

    /* wait for the reply to land (bounded) */
    let replyOK = false;
    let sawAssistant = false;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const msgs = await req("GET", `/api/session/${sessionID}/message`, undefined, { timeoutMs: 20000 });
      const arr = msgs.json?.data || msgs.json || [];
      for (const m of arr) {
        const role = m.role || m.type || "";
        const text = JSON.stringify((m.parts || m.content || []).map((p) => p.text || "")) + (m.error ? JSON.stringify(m.error) : "");
        if (role === "assistant") {
          sawAssistant = true;
          if (text.includes("MOBCODE-REGRESSION-OK")) { replyOK = true; break; }
        }
      }
      if (replyOK) break;
      await new Promise((r) => setTimeout(r, 2500));
    }
    rec("assistant replied with token", replyOK, sawAssistant ? (replyOK ? "" : "assistant seen, token missing") : (sseGotRelevantEvent ? "events seen, no assistant msg yet" : "no assistant message within 120s"));
    rec("SSE event stream", sseGotRelevantEvent, `${seen.length} events observed`);
  }

  setTimeout(() => { try { ab.abort(); } catch {} }, 1000);
}

/* ---------- 7: session cleanup ---------- */
{
  if (sessionID) {
    const del = await req("DELETE", `/api/session/${sessionID}`);
    rec("session delete", expect(del, 200, 204), `HTTP ${del.status}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED` : ""}`);
process.exit(failed.length ? 1 : 0);
