/** Mobcode — OpenCode server API client + SSE.
 *
 * Every call targets the same-origin Mobcode companion server, which proxies
 * to the user's connected OpenCode server (or a user-supplied direct URL).
 * Mobcode never calls model provider APIs directly and never stores keys —
 * credentials go only to the OpenCode server via /api/integration connect
 * endpoints (OpenCode 2+).
 */

const PROXY_PREFIXES = [
  "/api/", "/event", "/config", "/provider", "/auth", "/session", "/log",
  "/project", "/find", "/file", "/command", "/agent", "/lsp", "/formatter",
  "/mcp", "/tui", "/global", "/experimental", "/question", "/permission",
  "/vcs", "/sync", "/model", "/path", "/pty", "/openapi.json",
];

export class OpenCodeError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status ?? 0;
    this.payload = payload;
  }
}

export function describeError(err, fallback = "Request failed") {
  if (err instanceof OpenCodeError) {
    if (err.status === 0) return `Cannot reach the OpenCode server. ${err.message}`;
    if (err.status === 401 || err.status === 403) return `Not authorized (${err.status}). ${err.message}`;
    return `${err.message || fallback}${err.status ? ` (${err.status})` : ""}`;
  }
  return err?.message || fallback;
}

export class MobcodeApi {
  constructor() {
    this.baseURL = "";        // proxied companion server, or direct OpenCode URL
    this.password = "";       // only for direct mode; forwarded per authMode
    this.authMode = "bearer"; // "bearer" (PWA direct) or "basic" (engine direct from Android)
    this.directory = "";      // opencode workspace directory scope
    this.staticOnly = false;  // no companion proxy available
  }

  /** GET /__mobcode/public — what the companion server is set up with. */
  async probeHost() {
    try {
      const res = await fetch("/__mobcode/public", { cache: "no-store" });
      if (res.ok) {
        const cfg = await res.json();
        return { companion: true, ...cfg };
      }
    } catch {}
    return { companion: false, staticOnly: true, connected: false, hasPassword: false, directory: "" };
  }

  configure({ baseURL = "", password = "", directory = "" }) {
    this.baseURL = baseURL.trim().replace(/\/+$/, "");
    this.password = password || "";
    this.directory = (directory || "").trim();
  }

  isProxiedPath(path) {
    return this.baseURL === "" && PROXY_PREFIXES.some((p) => path.startsWith(p));
  }

  url(path, params) {
    let full;
    if (this.fixedOriginTarget) {
      full = this.fixedOriginTarget + path;
    } else if (this.baseURL) {
      full = this.baseURL + path;
    } else {
      full = path;
    }
    const q = new URLSearchParams(params || {});
    if (this.directory && !q.has("directory")) q.set("directory", this.directory);
    const qs = q.toString();
    return full + (qs ? (full.includes("?") ? "&" : "?") + qs : "");
  }

  headers(extra = {}) {
    const h = { "Accept": "application/json", ...extra };
    if (this.baseURL !== "" && this.password) {
      if (this.authMode === "basic") {
        h["Authorization"] = `Basic ${btoa(`opencode:${this.password}`)}`;
      } else {
        h["Authorization"] = `Bearer ${this.password}`;
      }
    }
    return h;
  }

  async request(method, path, body, params, opts = {}) {
    const res = await fetch(this.url(path, params), {
      method,
      headers: this.headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      let payload = null;
      let message = res.statusText || "Request failed";
      try {
        const text = await res.text();
        if (text) {
          payload = JSON.parse(text);
          message = payload?.message || payload?.error?.message || payload?.error || message;
          if (payload?.data?.message) message = payload.data.message;
          if (typeof payload === "string") message = payload;
        }
      } catch {}
      throw new OpenCodeError(`${message}`, res.status, payload);
    }
    if (res.status === 204) return undefined;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json") || ct.includes("text/json")) {
      const json = await res.json();
      return json?.data !== undefined && json?.data !== null && "location" in json ? json : json;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  get(path, params, opts) { return this.request("GET", path, undefined, params, opts); }
  post(path, body, params, opts) { return this.request("POST", path, body, params, opts); }
  put(path, body, params, opts) { return this.request("PUT", path, body, params, opts); }
  patch(path, body, params, opts) { return this.request("PATCH", path, body, params, opts); }
  del(path, params, opts) { return this.request("DELETE", path, undefined, params, opts); }

  // ————— proxies to companion server —————
  async saveHostConfig({ open, directory, password }) {
    const res = await fetch("/__mobcode/target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open, directory, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new OpenCodeError(json?.error || `Host provisioning failed (${res.status})`, res.status, json);
    return json;
  }

  async disconnectHost() {
    const res = await fetch("/__mobcode/disconnect", { method: "POST" }).catch(() => null);
    return res?.ok ?? false;
  }

  // ————— OpenCode API surface —————
  /** Health probe. v2 has no /api/health — /api/config stands in (200 with
   *  the array of config docs); v1 answers /api/health. */
  async health() {
    try {
      return await this.get("/api/config");
    } catch (err) {
      if (err instanceof OpenCodeError && (err.status === 404 || err.status === 405)) {
        return this.get("/api/health");
      }
      throw err;
    }
  }

  /** Full dynamically-discovered model catalogue. */
  listModels(directory) { return this.get("/api/model", emptyOverride(directory, this)); }

  /** Provider list with plenty of detail (name/activation/settings). */
  listProviders(directory) { return this.get("/api/provider", emptyOverride(directory, this)); }

  /** Global default model ({data: Model} from /api/model/default). */
  modelDefault() { return this.get("/api/model/default", emptyOverride(null, this)); }

  /** Provider integrations: {data: [{id, name, methods, connections}]}.
   *  methods: [{type:"key"}|{type:"env",names:[...]}|{type:"oauth",...}]. */
  integrations() { return this.get("/api/integration", emptyOverride(null, this)); }

  /** Stored credentials: {data: [{id, integrationID, label, active, ...}]} */
  credentials() { return this.get("/api/credential", emptyOverride(null, this)); }

  /** Store an API key credential for an integration (like `opencode auth login`). */
  connectKey(integrationID, key, label) {
    return this.post(`/api/integration/${encodeURIComponent(integrationID)}/connect/key`, {
      key, ...(label ? { label } : {}),
    });
  }

  /** Begin a server-defined OAuth flow → {data:{attemptID, url, instructions, mode}}. */
  connectOauth(integrationID, methodID) {
    return this.post(`/api/integration/${encodeURIComponent(integrationID)}/connect/oauth`, { methodID });
  }

  /** Complete a headless OAuth attempt with the user's code. */
  oauthComplete(integrationID, attemptID, code) {
    return this.post(
      `/api/integration/${encodeURIComponent(integrationID)}/connect/oauth/${encodeURIComponent(attemptID)}/complete`,
      code ? { code } : {},
    );
  }

  /** Activate a stored credential. */
  activateCredential(credentialID) {
    return this.post(`/api/credential/${encodeURIComponent(credentialID)}/activate`);
  }

  /** Remove a stored credential. */
  deleteCredential(credentialID) {
    return this.del(`/api/credential/${encodeURIComponent(credentialID)}`);
  }

  /** App config documents (v2 /api/config; v1 returns the {json} doc). */
  getConfig() { return this.get("/api/config"); }

  listAgents() { return this.get("/api/agent"); }

  listSessions(directory, limit = 60) {
    return this.get("/api/session", { limit, ...emptyOverride(directory, this) });
  }

  createSession({ agent, model } = {}) {
    const body = {};
    if (agent) body.agent = agent;
    if (model) body.model = model;
    return this.post("/api/session", body);
  }

  getSession(sessionID) { return this.get(`/api/session/${sessionID}`); }

  deleteSession(sessionID) { return this.del(`/api/session/${sessionID}`); }

  listMessages(sessionID, limit = 100) {
    return this.get(`/api/session/${sessionID}/message`, { limit });
  }

  /** Switch the model for subsequent agent turns of the session. */
  switchModel(sessionID, modelRef) {
    return this.post(`/api/session/${sessionID}/model`, { model: modelRef });
  }

  switchAgent(sessionID, agent) {
    return this.post(`/api/session/${sessionID}/agent`, { agent });
  }

  /** Prompt the agent. v2 payload is flat (text/delivery at top level). */
  prompt(sessionID, text, delivery = "steer", files) {
    const body = { text };
    if (files?.length) body.files = files;
    return this.post(`/api/session/${sessionID}/prompt`, { ...body, delivery });
  }

  interrupt(sessionID) { return this.post(`/api/session/${sessionID}/interrupt`); }

  /** SSE event stream. */
  events(onEvent, onStatus) {
    const url = this.url("/api/event");
    let es = null;
    let closed = false;
    let reconnectDelay = 1000;

    const connect = () => {
      if (closed) return;
      try { es = new EventSource(urlWithAuthHint(url)); } catch {
        onStatus?.("error");
        return;
      }
      es.onopen = () => { reconnectDelay = 1000; onStatus?.("connected"); };
      es.onmessage = (e) => {
        if (!e.data) return;
        try {
          const parsed = JSON.parse(e.data);
          onEvent?.(parsed);
        } catch {}
      };
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) es = null;
        onStatus?.("disconnected");
        // browsers auto-retry; add our own backoff as a safety net
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 20000);
      };
    };
    connect();

    return {
      close() {
        closed = true;
        es?.close();
      },
    };
  }
}

function emptyOverride(directory, api) {
  // when companion proxy exists it already injects directory; direct mode may pass explicit one
  return directory && api.baseURL ? { directory } : {};
}

/** EventSource can't set headers; the companion proxy adds the password. In
 *  direct mode, servers with password auth won't stream — surface status. */
function urlWithAuthHint(url) {
  return url;
}
