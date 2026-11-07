/** Mobcode app bootstrap v2: production config, routing, SSE, refreshes. */
import { MobcodeApi, describeError } from "./api.js";
import { store } from "./store.js";
import { h, toast, openSheet } from "./ui.js";
import { isNative, loadConnection, probeConnection, initNative } from "./native.js";
import { resolveApiBase, PRODUCTION_API_BASE_URL, ALLOW_DEV_SERVER_OVERRIDE, MOBCODE_VERSION } from "./config.js";
import { refreshCatalog, openModelPicker } from "./modelpicker.js";
import { fetchProviderData, confirmDisconnect, providerDisplayName, fetchMcpServers } from "./providers.js";
import { ConnectView, createSessionWithModel } from "./views.js";
import { HomeView } from "./home.js";
import { ChatView } from "./chat.js";
import { ProjectsView } from "./projects.js";
import { ActivityView } from "./activity.js";
import { openWorkPanel } from "./workpanel.js";
import { openMenuSheet } from "./menu.js";

/* ————— globals shared with modules ————— */
const api = new MobcodeApi();
window.__api = api;
window.__refreshProviders = refreshProvidersData;

async function refreshAll(force = false) {
  await Promise.allSettled([
    refreshCatalog(force),
    refreshProvidersData(true),
    listSessionsSilently(),
    refreshProjects(),
  ]);
}
window.__refreshAll = refreshAll;

/* ————— static chrome ————— */
const topbar = document.getElementById("topbar");
const connState = document.getElementById("conn-state");
const topbarTitle = document.getElementById("topbar-title");
const btnProfile = document.getElementById("btn-profile");
const viewRoot = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

const nav = { stack: [] };
window.__nav = nav;

/* ————— routing ————— */
nav.push = (entry, opts) => {
  if (entry.kind === "chat") nav.stack = []; // chat replaces nav history (mobile-flat)
  entry.opts ??= {};
  nav.stack.push(entry);
  renderRoute(entry);
};
nav.pop = () => {
  nav.stack.pop();
  if (nav.stack.some((s) => s.kind === "chat")) return;
  setTab(currentTab);
};
nav.home = () => setTab("home");
nav.projects = () => setTab("projects");
nav.activity = () => setTab("activity");
nav.connect = () => {
  nav.stack = [];
  showChrome(false);
  viewRoot.replaceChildren(ConnectView());
};

function showChrome(on) {
  topbar.hidden = !on;
  tabbar.hidden = !on;
  if (!on) {
    document.getElementById("topbar-actions").replaceChildren();
    if (topbarTitle) topbarTitle.textContent = "Mobcode";
    connState.classList.remove("on", "wait");
    connState.querySelector("span.lbl").textContent = "offline";
  }
}
function showTabbar(on) {
  tabbar.hidden = typeof on === "boolean" ? !on : false;
  topbar.hidden = typeof on === "boolean" ? !on : false;
}
function renderRoute(entry) {
  if (entry.kind === "chat") renderChat(entry.sessionID);
}

const tabs = { home: null, projects: null, activity: null };
let currentTab = "home";

function setTab(kind) {
  if (kind !== "chat") currentTab = kind;
  nav.stack = [];
  showChrome(true);
  if (topbarTitle) topbarTitle.textContent = "Mobcode";
  for (const t of tabbar.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === kind);
  for (const c of viewRoot.querySelectorAll("*")) if (c?.cleanup) { try { c.cleanup(); } catch {} }

  if (kind === "home") {
    const el = HomeView({ onOpenChat: openChat, onProject: (pid) => { setTab("projects"); window.__focusProject?.(pid); } });
    viewRoot.replaceChildren(el);
    el.render();
  } else if (kind === "projects") {
    const el = ProjectsView({ onOpenProject: openProjectChat, onOpenChat: openChat });
    viewRoot.replaceChildren(el);
    el.render();
  } else if (kind === "activity") {
    const el = ActivityView({ onOpenChat: openChat });
    viewRoot.replaceChildren(el);
    el.render();
  }
}

function setConn(state) {
  connState.classList.toggle("on", state === "ok");
  connState.classList.toggle("wait", state === "wait");
  connState.querySelector("span.lbl").textContent = state === "ok" ? "online" : state === "wait" ? "linking" : "offline";
}

window.__setConn = setConn;

btnProfile.addEventListener("click", () => {
  openMenuSheet({ currentView: null });
});

/* workspace panel button lives on chat only; hook to workpanel */
window.__openWorkPanel = (sessionID) => openWorkPanel({ sessionID, api });

/* ————— chat navigation ————— */
function openChat(sessionID) {
  nav.push({ kind: "chat", sessionID });
}
async function renderChat(sessionID) {
  setConn("ok");
  topbar.hidden = false;
  tabbar.hidden = true;
  for (const c of viewRoot.querySelectorAll("*")) if (c?.cleanup) { try { c.cleanup(); } catch {} }
  const header = h("div", { class: "chat-topbar-actions" },
    h("button", {
      class: "icon-btn", "aria-label": "Back to Home", title: "Back to Home",
      onclick: () => nav.home(),
    },
      h("svg", { viewBox: "0 0 24 24", width: "21", height: "21", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("path", { d: "M15.5 19 8.5 12 15.5 5" }))),
    h("button", {
      class: "icon-btn", "aria-label": "Workspace", title: "Workspace",
      onclick: () => window.__openWorkPanel?.(sessionID),
    },
      h("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }))),
    h("button", {
      class: "icon-btn", "aria-label": "New chat", title: "New chat",
      onclick: () => openModelPicker({ mode: "newchat", onNewChat: createSessionWithModel }),
    },
      h("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" },
        h("path", { d: "M12 5v14M5 12h14" }))),
  );
  document.getElementById("topbar-actions").replaceChildren(header);
  if (topbarTitle) {
    const t = store.state.sessionCache.get?.(sessionID)?.title || "Chat";
    topbarTitle.textContent = t.length > 26 ? `${t.slice(0, 25)}…` : t;
  }
  const chat = ChatView(sessionID, { onChangeModel: () => openModelPicker({ mode: "session", sessionID }) });
  viewRoot.replaceChildren(chat);
}
window.__renderChat = renderChat;
nav.renderChat = renderChat;

/* ————— project helpers ————— */
async function refreshProjects() {
  try {
    const res = await api.get("/api/project");
    const arr = Array.isArray(res) ? res : res?.data ?? [];
    store.set({ projects: arr.filter((p) => p.id !== "global") });
  } catch {}
}
window.__refreshProjects = refreshProjects;

/** Open a chat rooted at a project directory (creates a session there). */
async function openProjectChat(project) {
  try {
    const dir = project.canonical || project.directory;
    if (!dir) throw new Error("Project has no directory");
    const res = await api.createSession({ agent: store.state.agentsChoice || "build", location: { directory: dir } });
    const session = res?.data || res;
    const sc = new Map(store.state.sessionCache);
    sc.set(session.id, session);
    const mc = new Map(store.state.messageCache);
    mc.set(session.id, []);
    store.set({ sessionCache: sc, messageCache: mc, currentProjectId: project.id, sessions: [session, ...store.state.sessions] });
    toast(`Working in ${dir.split("/").pop()}`, "ok");
    openChat(session.id);
  } catch (err) {
    toast(describeError(err, "Could not start a chat in this project"), "err", 4200);
  }
}

/* ————— tab events ————— */
tabbar?.addEventListener("click", (e) => {
  const tab = e.target.closest?.(".tab");
  if (!tab) return;
  setTab(tab.dataset.tab);
});

/* ————— providers/MCP refresh ————— */
async function refreshProvidersData(force = false) {
  await fetchProviderData(api);
  await fetchMcpServers(api).catch(() => {});
  const pv = viewRoot.querySelector(".integrations-root");
  if (pv?.render) pv.render();
}

/* ————— model → new session ————— */
window.__onModelForNewChat = createSessionWithModel;

/* ————— SSE + polling ————— */
let sse = null;
let pollTimer = null;

function startEvents() {
  sse?.close();
  sse = api.events(handleEvent, (status) => {
    if (status !== store.state.sseStatus) store.set({ sseStatus: status });
    if (status === "connected") { softRefresh(); setConn("ok"); }
    else if (status === "disconnected") setConn("wait");
    else if (status === "error") setConn("wait");
  });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (store.state.sseStatus !== "connected") {
      refreshCatalog(true).catch(() => {});
      listSessionsSilently().catch(() => {});
    }
  }, 45000);
}

async function listSessionsSilently() {
  try {
    const res = await api.listSessions();
    const arr = res?.data ?? res ?? [];
    const sc = new Map(store.state.sessionCache);
    for (const s of arr) sc.set(s.id, s);
    store.set({ sessions: arr, sessionCache: sc });
  } catch {}
}

function rememberServerActivity(type, data, sessionID) {
  // friendly one-liner into the Activity tab feed — real events only
  const map = {
    "session.created": { label: "Session started", kind: "session" },
    "session.renamed": { label: "Session renamed", kind: "session" },
    "session.model.switched": { label: "Model switched", kind: "session" },
    "session.model.selected": { label: "Model selected", kind: "session" },
    "session.next.model.switched": { label: "Model selected", kind: "session" },
    "session.execution.started": { label: "Agent run started", kind: "run" },
    "session.execution.succeeded": { label: "Agent run completed", kind: "run", status: "ok" },
    "session.execution.failed": { label: "Agent run failed", kind: "run", status: "err" },
    "session.error": { label: "Agent run failed", kind: "run", status: "err" },
    "session.compaction.completed": { label: "Conversation compacted", kind: "run", status: "ok" },
    "session.compaction.started": { label: "Compacting conversation", kind: "run" },
    "integration.connected": { label: "Provider connected", kind: "integration" },
    "integration.disconnected": { label: "Provider disconnected", kind: "integration" },
    "mcp.connected": { label: "MCP connected", kind: "integration" },
    "mcp.disconnected": { label: "MCP disconnected", kind: "integration" },
    "server.connected": null,
  };
  const t = map[type];
  if (!t) return;
  store.logActivity({
    at: Date.now(), kind: t.kind, label: t.label, status: t.status || "",
    sessionId: sessionID || data?.info?.id || data?.sessionID || "",
  });
}

/* ————— per-chat activity extraction (real tool parts) ————— */
let actSessionFrames = new Map(); // sessionID -> [{name,state,input} ..] (trimmed)

function recordToolParts(messages, sessionID) {
  const tools = [];
  for (const m of messages || []) {
    const parts = m.parts || m.content || [];
    for (const p of parts) {
      if (p?.type === "tool") {
        tools.push({ name: p.name, state: p.state, time: p.time });
      }
    }
  }
  actSessionFrames.set(sessionID, tools.slice(-40));
}
window.__chatToolFrames = () => actSessionFrames;

function handleEvent(e) {
  const type = e?.type || "";
  const data = e?.data ?? e?.properties ?? {};
  rememberServerActivity(type, data, "");
  switch (type) {
    case "server.connected": {
      softRefresh();
      break;
    }
    case "session.updated": {
      const info = data.info;
      if (info?.id) {
        const sc = new Map(store.state.sessionCache);
        sc.set(info.id, { ...sc.get(info.id), ...info });
        store.set({ sessionCache: sc });
        const i = store.state.sessions.findIndex((s) => s.id === info.id);
        if (i >= 0) {
          const arr = store.state.sessions.slice();
          arr[i] = { ...arr[i], ...info };
          store.set({ sessions: arr });
        }
      }
      break;
    }
    case "session.deleted": {
      store.set({
        sessions: store.state.sessions.filter((s) => s.id !== data.info?.id && s.id !== data.sessionID),
      });
      break;
    }
    case "session.model.selected":            // OpenCode 2+
    case "session.next.model.switched": {     // OpenCode 1
      const sid = data.sessionID;
      const model = data.model;
      if (sid && model) {
        const sc = new Map(store.state.sessionCache);
        if (sc.has(sid)) {
          sc.set(sid, { ...sc.get(sid), model });
          store.set({ sessionCache: sc });
        }
        const pending = store.state.pendingModel;
        if (pending && pending.providerID === model.providerID && pending.id === model.id && (pending.variant || undefined) === (model.variant || undefined)) {
          store.set({ pendingModel: null });
        }
      }
      break;
    }
    case "session.text.started":          // OpenCode 2
    case "session.text.delta":
    case "session.text.ended":
    case "session.step.started":
    case "session.step.ended":
    case "session.inbox.enqueued":
    case "session.exec.merged":
    case "message.updated":               // OpenCode 1
    case "message.part.updated":
    case "message.part.delta": {
      const sid = data.sessionID;
      const activeId = nav.stack[nav.stack.length - 1]?.sessionID;
      if (!sid) break;
      // one throttled message refetch refreshes BOTH the bubbles and the
      // activity strip from the same real data source
      if (sid === activeId) {
        const chatEl = viewRoot.firstChild;
        if (chatEl?.refreshMessages) {
          clearTimeout(chatEl.__refrT);
          chatEl.__refrT = setTimeout(() => chatEl.refreshMessages?.(), 160);
        }
      }
      break;
    }
    case "session.execution.failed":          // OpenCode 2
    case "session.error": {                   // OpenCode 1
      if (data.sessionID) {
        const activeId = nav.stack[nav.stack.length - 1]?.sessionID;
        listSessionsSilently();
        if (activeId === data.sessionID) {
          const chatEl = viewRoot.firstChild;
          if (chatEl?.refreshMessages) {
            clearTimeout(chatEl.__refrT);
            chatEl.__refrT = setTimeout(() => chatEl.refreshMessages?.(), 180);
          }
        }
      }
      break;
    }
    case "session.renamed":                   // OpenCode 2
    case "session.created":
    case "session.usage.updated":
    case "session.execution.succeeded":
    case "session.execution.started": {
      listSessionsSilently();
      break;
    }
    case "provider.auth.updated":             // OpenCode 1
    case "session.credentials.updated":
    case "credential.updated":
    case "integration.connected":
    case "integration.disconnected": {
      refreshCatalog(true);
      refreshProvidersData();
      break;
    }
  }
}

async function softRefresh() {
  listSessionsSilently();
  refreshCatalog(true);
  refreshProvidersData();
  refreshProjects();
}

/* ————— boot ————— */
window.__boot = boot;
window.__restartEvents = startEvents;

async function boot() {
  if (isNative()) {
    // ── Android: the bundle has no same-origin companion. Start from the
    //    build-time production URL; the encrypted profile is a developer
    //    override only when production isn't compiled in.
    store.set({ host: { companion: false, staticOnly: false, connected: false, hasPassword: false, directory: "" } });
    const cfg = await loadConnection();
    const resolved = resolveApiBase({ secureProfileUrl: cfg?.url || "" });
    if (!resolved.base) {
      store.set({ connected: false, nativeMode: true });
      nav.connect();
      return;
    }
    api.configure({
      baseURL: resolved.base,
      password: resolved.source === "profile" ? (cfg?.password || "") : "",
      directory: store.state.directory || cfg?.directory || "",
    });
    api.authMode = resolved.source === "profile" && cfg?.kind === "opencode" ? "basic" : "bearer";
    setConn("wait");
    store.set({ connected: true, nativeMode: true, target: resolved.base, authMode: api.authMode, prodLocked: resolved.locked });
    await loadApp();
    return;
  }

  const host = await api.probeHost();
  store.set({ host });

  // The companion proxy manages credentials itself; clients send no password.
  api.configure({ baseURL: "", password: "", directory: store.state.directory || host.directory || "" });

  if (host.companion && host.connected) {
    store.set({ target: "", connected: true });
  } else {
    const last = localStorage.getItem("mobcode.target");
    if (last) {
      store.set({ target: last });
      api.configure({ baseURL: last, password: "", directory: store.state.directory });
    }
  }

  if (!host.companion ? !store.state.target : !host.connected) {
    nav.connect();
    return;
  }

  await loadApp();
}

async function loadApp() {
  // verify health
  try {
    await api.health();
    store.set({ connected: true });
    setConn("ok");
  } catch (err) {
    store.set({ connected: false });
    nav.connect();
    toast(describeError(err, "OpenCode server is not reachable"), "err");
    return;
  }

  startEvents();
  startPolling();
  setTab("home");

  await Promise.allSettled([
    fetchProviderData(api),
    listSessionsSilently(),
    refreshProjects(),
  ]);
  const agentsRes = await api.listAgents().catch(() => null);
  store.set({ agents: agentsRes?.data ?? agentsRes ?? [] });
  await Promise.allSettled([
    refreshCatalog(true),
  ]);
}

/* apply stored theme before paint */
store.setTheme(store.state.theme);

if (!PRODUCTION_API_BASE_URL && !ALLOW_DEV_SERVER_OVERRIDE) {
  // build guard mismatch — never silently connect to a wrong endpoint
  console.warn("Mobcode: production URL unset with overrides disabled; Connect screen will show.");
}

initNative({ restartEvents: () => startEvents(), refreshAll }).catch(() => {});

boot().catch((err) => {
  console.error(err);
  toast(describeError(err, "Startup failed"), "err");
});
