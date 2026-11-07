/** Mobcode app bootstrap: host probe, connection, routing, SSE, refreshes. */
import { MobcodeApi, describeError } from "./api.js";
import { store } from "./store.js";
import { h, toast } from "./ui.js";
import { isNative, loadConnection, probeConnection, initNative } from "./native.js";
import { refreshCatalog, openModelPicker } from "./modelpicker.js";
import { fetchProviderData, openConnectProviderSheet, confirmDisconnect, providerDisplayName } from "./providers.js";
import { ConnectView, HomeView, ChatView, ProvidersView, SettingsView } from "./views.js";

/* ————— globals shared with modules ————— */
const api = new MobcodeApi();
window.__api = api;
window.__refreshProviders = refreshProvidersData;

async function refreshAll(force = false) {
  await Promise.allSettled([
    refreshCatalog(force),
    refreshProvidersData(true),
    listSessionsSilently(),
  ]);
}
window.__refreshAll = refreshAll;

/* ————— routing ————— */
const appbar = document.getElementById("appbar");
const appbarTitle = document.getElementById("appbar-title");
const appbarActions = document.getElementById("appbar-actions");
const btnBack = document.getElementById("btn-back");
const viewRoot = document.getElementById("view");
const tabbar = document.getElementById("tabbar");

const nav = { stack: [] };
window.__nav = nav;

nav.push = (entry, opts) => {
  entry.opts = { title: "", back: true, tabs: true, ...opts };
  nav.stack.push(entry);
  renderRoute(entry);
};
nav.home = () => setCurrentTab("home");
nav.connect = () => {
  nav.stack = [];
  nav.push({ kind: "connect" }, { back: false, tabs: false });
};
nav.pop = () => {
  nav.stack.pop();
  const prev = nav.stack[nav.stack.length - 1];
  if (!prev) return setCurrentTab(currentTab);
  renderRoute(prev);
};

function renderRoute(entry) {
  const o = entry.opts ?? { title: "", back: true, tabs: true };
  btnBack.hidden = !o.back;
  tabbar.hidden = !o.tabs;
  appbar.hidden = entry.kind === "connect" || entry.kind === "home";
  appbarTitle.textContent = o.title || "";
  appbarActions.replaceChildren();
  if (o.actions) for (const a of o.actions) appbarActions.append(a);

  // release view subscriptions
  for (const c of viewRoot.querySelectorAll("*")) if (c?.cleanup) { try { c.cleanup(); } catch {} }

  switch (entry.kind) {
    case "connect":
      viewRoot.replaceChildren(ConnectView());
      break;
    case "home": {
      tabbar.hidden = false;
      const home = HomeView({ onOpenChat: (id) => nav.push({ kind: "chat", sessionID: id }, { title: "Chat" }) });
      viewRoot.replaceChildren(home);
      home.render();
      break;
    }
    case "chat": {
      const chatEl = ChatView(entry.sessionID, { onChangeModel: () => openModelPicker({ mode: "session", sessionID: entry.sessionID }) });
      viewRoot.replaceChildren(chatEl);
      break;
    }
    case "providers":
      navProvidersView();
      break;
    case "settings":
      viewRoot.replaceChildren(SettingsView());
      break;
  }
}

/* ————— tab handling ————— */
let currentTab = "home";

tabbar?.addEventListener("click", (e) => {
  const tab = e.target.closest?.(".tab");
  if (!tab) return;
  const kind = tab.dataset.tab;
  if (kind === "new") {
    openModelPicker({ mode: "newchat", onNewChat: createSessionWithModel });
    return;
  }
  setCurrentTab(kind);
});

function setCurrentTab(kind) {
  currentTab = kind;
  nav.stack = [];
  renderTabActive();
  if (kind === "home") {
    tabbar.hidden = false;
    appbar.hidden = true;
    btnBack.hidden = true;
    renderRoute({ kind: "home", opts: { back: false, tabs: true } });
  } else if (kind === "providers") {
    appbar.hidden = false;
    appbarTitle.textContent = "Providers";
    btnBack.hidden = true;
    tabbar.hidden = false;
    navProvidersView();
  } else if (kind === "settings") {
    appbar.hidden = false;
    appbarTitle.textContent = "Settings";
    btnBack.hidden = true;
    tabbar.hidden = false;
    viewRoot.replaceChildren(SettingsView());
  }
}

function renderTabActive() {
  if (!tabbar || tabbar.hidden) return;
  for (const t of tabbar.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === currentTab);
}

function navProvidersView() {
  tabbar.hidden = false;
  appbar.hidden = false;
  appbarTitle.textContent = "Providers";
  btnBack.hidden = true;
  const refreshBtn = h("button", { class: "appbar-btn", "aria-label": "Refresh" },
    h("svg", { width: 20, height: 20, viewBox: "0 0 24 24" },
      h("path", { d: "M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })));
  refreshBtn.onclick = () => refreshProvidersData(true);
  appbarActions.replaceChildren(refreshBtn);
  const pv = ProvidersView({
    onConnect: (pid) => openConnectProviderSheet(pid),
    onDisconnect: (pid) => confirmDisconnect(pid),
    onBrowseModels: () => openModelPicker({ mode: "newchat", onNewChat: createSessionWithModel }),
  });
  viewRoot.replaceChildren(pv);
  renderTabActive();
}

async function refreshProvidersData(force = false) {
  await fetchProviderData(api);
  const pv = viewRoot.firstChild;
  if (pv?.render) pv.render();
}

/* ————— model → new session ————— */
window.__onModelForNewChat = createSessionWithModel;
async function createSessionWithModel(modelRef) {
  try {
    const agent = store.state.agentsChoice || "build";
    const res = await api.createSession({ agent, model: modelRef });
    const session = res?.data || res;
    const sc = new Map(store.state.sessionCache);
    sc.set(session.id, session);
    const mc = new Map(store.state.messageCache);
    mc.set(session.id, []);
    store.set({ sessionCache: sc, messageCache: mc, pendingModel: modelRef, sessions: [session, ...store.state.sessions] });
    nav.push({ kind: "chat", sessionID: session.id }, { title: session.title || "New chat" });
    toast(`New chat on ${modelRef.id}`, "ok");
  } catch (err) {
    toast(describeError(err, "Could not create the chat"), "err", 4200);
    throw err;
  }
}

/* ————— SSE + polling ————— */
let sse = null;
let pollTimer = null;

function startEvents() {
  sse?.close();
  sse = api.events(handleEvent, (status) => {
    if (status !== store.state.sseStatus) store.set({ sseStatus: status });
    if (status === "connected") softRefresh();
  });
}

let reconnectPoll = null;

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    // hard refresh of catalogue + sessions (fallback when SSE is not streaming)
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

function handleEvent(e) {
  const type = e?.type || "";
  const data = e?.data ?? e?.properties ?? {};
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
        // keep home list in sync
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
        // clear pending marker exactly when confirmed
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
    case "session.step.streamed":
    case "session.step.started":
    case "session.step.ended":
    case "session.inbox.enqueued":
    case "session.exec.merged":
    case "message.updated":               // OpenCode 1
    case "message.part.updated":
    case "message.part.delta": {
      const sid = data.sessionID;
      const activeId = nav.stack[nav.stack.length - 1]?.sessionID;
      if (sid && sid === activeId) {
        const chatEl = viewRoot.firstChild;
        if (chatEl?.refreshMessages) {
          clearTimeout(chatEl.__refrT);
          chatEl.__refrT = setTimeout(() => chatEl.refreshMessages?.(), 180);
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
    case "session.credentials.updated":       // OpenCode 2 equivalent surface
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
}

/* ————— boot ————— */
window.__boot = boot;
window.__restartEvents = startEvents;

async function boot() {
  if (isNative()) {
    // ── Android: bundle has no same-origin companion; the authoritative
    //    backend URL lives in the encrypted connection profile.
    store.set({ host: { companion: false, staticOnly: false, connected: false, hasPassword: false, directory: "" } });
    const cfg = await loadConnection();
    if (!cfg?.url) {
      store.set({ connected: false, nativeMode: true });
      nav.connect();
      return;
    }
    api.configure({ baseURL: cfg.url, password: cfg.password || "", directory: store.state.directory || cfg.directory || "" });
    api.authMode = cfg.kind === "opencode" ? "basic" : "bearer";
    const probe = await probeConnection(cfg.url, cfg.password || "");
    if (!probe.ok) {
      store.set({ connected: false, nativeMode: true });
      nav.connect();
      toast(probe.error || "Server unreachable — reconnect in Settings", "err", 4200);
      return;
    }
    if (probe.kind === "companion" && probe.data?.connected === false) {
      store.set({ connected: false, nativeMode: true });
      nav.connect();
      toast("Backend is not connected to an OpenCode engine yet — finish configuration on the host.", "err", 5200);
      return;
    }
    store.set({ connected: true, nativeMode: true, target: cfg.url, authMode: cfg.kind === "opencode" ? "basic" : "bearer" });
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
    // static-only hosting: needs a direct OpenCode URL
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
  } catch (err) {
    store.set({ connected: false });
    nav.connect();
    toast(describeError(err, "OpenCode server is not reachable"), "err");
    return;
  }

  api.configure({ baseURL: store.state.target, password: store.state.password, directory: store.state.directory });
  api.authMode = store.state.authMode || "bearer";
  // render immediately; heavy catalogue/provider loads stream in via SSE + refresh
  startEvents();
  startPolling();
  nav.home();

  await Promise.allSettled([
    fetchProviderData(api),
    listSessionsSilently(),
  ]);
  const agentsRes = await api.listAgents().catch(() => null);
  store.set({ agents: agentsRes?.data ?? agentsRes ?? [] });
  await Promise.allSettled([
    refreshCatalog(true),
  ]);
}

btnBack.addEventListener("click", () => nav.pop());

initNative({ restartEvents: () => startEvents(), refreshAll }).catch(() => {});

boot().catch((err) => {
  console.error(err);
  toast(describeError(err, "Startup failed"), "err");
});
