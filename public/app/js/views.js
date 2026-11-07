/** Mobcode views: Connect, Chats (home), Chat, Providers screen, Settings. */
import { h, toast, openModal } from "./ui.js";
import { store } from "./store.js";
import { describeError, OpenCodeError } from "./api.js";
import { fmtTokens, fmtCostSession, timeAgo, fmtTime } from "./format.js";
import {
  isNative, urlIsAllowed, probeConnection, saveConnection, loadConnection, clearConnection,
  haptic, copyText, shareText,
} from "./native.js";
import {
  providerDisplayName, providerModelsCount,
} from "./providers.js";

/* ————————————————————————————————— connect ————————————————————————————————— */

export function ConnectView() {
  const st = store.state;
  const nativeMode = isNative();
  let testing = false;

  const suggested = nativeMode
    ? "" // the user's own backend URL — deliberately not pre-filled
    : `${location.protocol}//${location.hostname}:46000`;
  const urlInput = h("input", {
    class: "input", value: st.target || suggested,
    placeholder: nativeMode ? "https://your-mobcode-backend.onrender.com" : suggested,
    autocomplete: "url", spellcheck: "false", inputmode: "url",
  });
  const pwInput = h("input", { class: "input", type: "password", placeholder: nativeMode ? "only if the backend requires it" : (st.host.hasPassword ? "(already configured on host)" : "optional — if the server has a password"), autocomplete: "off" });
  const dirInput = h("input", { class: "input", value: st.directory, placeholder: "empty = server default", spellcheck: "false" });
  const status = h("div", { class: "status-line" });

  function showStatus(kind, text) {
    status.className = `status-line ${kind}`;
    status.replaceChildren(text);
  }

  async function trySave() {
    if (testing) return;
    const url = urlInput.value.trim();
    if (!url) return showStatus("err", "Enter the Mobcode backend URL.");

    if (nativeMode) {
      testing = true;
      status.className = "status-line";
      status.replaceChildren(h("span", { class: "spin" }), " Connecting…");
      try {
        const check = urlIsAllowed(url);
        if (!check.ok) { showStatus("err", check.error); testing = false; return; }
        const base = String(check.url).replace(/\/+$/, "");
        const password = pwInput.value.trim();
        const probed = await probeConnection(base, password);
        if (!probed.ok) throw new OpenCodeError(probed.error || "Could not reach the server", 0);
        await saveConnection({ url: base, password, kind: probed.kind, directory: dirInput.value.trim() });
        store.set({ directory: dirInput.value.trim(), password, target: base });
        store.persistPrefs?.();
        showStatus("ok", "Connected. Loading…");
        await window.__boot?.();
        window.__nav?.home();
      } catch (err) {
        showStatus("err", describeError(err, "Connection failed"));
      }
      testing = false;
      return;
    }

    testing = true;
    status.className = "status-line";
    status.replaceChildren(h("span", { class: "spin" }), " Connecting…");
    try {
      if (st.host.companion) {
        await window.__api.saveHostConfig({ open: url, directory: dirInput.value.trim(), password: pwInput.value.trim() || "" });
      } else {
        const probe = await verifyDirect(url, pwInput.value.trim());
        if (!probe.ok) throw new OpenCodeError(probe.error || "Could not reach the server", 0);
        localStorage.setItem("mobcode.target", url);
        store.set({ target: url, password: "" });
      }
      showStatus("ok", "Connected. Preparing…");
      await window.__boot?.();
      window.__nav?.home();
    } catch (err) {
      showStatus("err", describeError(err, "Connection failed"));
    }
    testing = false;
  }

  async function verifyDirect(url, password) {
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`, { headers: password ? { Authorization: `Bearer ${password}` } : {} });
      return { ok: res.ok };
    } catch {
      return { ok: false, error: "Could not reach the server (check the URL)." };
    }
  }

  return h("div", { class: "container fade-in" },
    h("div", { class: "connect-logo" },
      h("div", { class: "mark" },
        h("svg", { width: 26, height: 26, viewBox: "0 0 24 24" },
          h("path", { d: "M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9.5L5.5 21v-3.5h-1A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5z", fill: "#fff", fillOpacity: 0.9 }))),
      h("div", {},
        h("h1", {}, "Mobcode"),
        h("p", {}, "Your code. Your agent. Anywhere."))),
    h("div", { class: "card", style: { padding: "16px 14px" } },
      h("div", { class: "field" },
        h("span", { class: "field-label" }, "OpenCode server URL"),
        urlInput),
      h("div", { class: "field" },
        h("span", { class: "field-label" }, "Server password (optional)"),
        pwInput),
      st.host.companion || nativeMode ? h("div", { class: "field" },
        h("span", { class: "field-label" }, "Workspace directory"),
        dirInput,
        h("div", { class: "hint" }, "Scopes models & chats. Usually leave empty for the server's default."),
      ) : null,
      h("button", { class: "btn primary block", onclick: trySave }, "Connect"),
      status),
    h("div", { class: "hint", style: { margin: "14px 4px" } },
      nativeMode
        ? h("div", {},
            "Point Mobcode at your own deployed backend (e.g. Mobcode on Render). HTTPS is required; credentials are stored encrypted on this device, never in the app bundle.")
        : h("div", {},
            h("div", {}, "Start a server: ", h("span", { class: "kbd" }, "opencode serve --port 46000")),
            h("div", { style: { marginTop: 6 } }, "Mobcode talks only to this server — it never calls model provider APIs or stores your keys.")),
    ),
  );
}

/* ————————————————————————————————— home / sessions ————————————————————————————————— */

export function HomeView({ onOpenChat }) {
  const list = h("div", { class: "container", id: "session-list" });
  const el = h("div", {}, list);

  function renderList() {
    const sessions = [...store.state.sessions].sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
    list.replaceChildren(h("div", { style: { padding: "2px 2px 10px", fontSize: 19, fontWeight: 800 } }, "Chats"));
    if (!sessions.length) {
      list.append(h("div", { class: "empty-state" },
        h("div", { class: "big" }, "💬"),
        "No chats yet.",
        h("div", { class: "hint", style: { marginTop: 8 } }, "Tap New to start one with any model your server offers.")));
      return;
    }
    for (const s of sessions) {
      const model = s.model;
      list.append(h("button", { class: "row-item", onclick: () => onOpenChat(s.id) },
        h("div", { class: "avatar-sm" }, (s.title || "?").trim().slice(0, 1).toUpperCase()),
        h("div", { class: "row-main" },
          h("div", { class: "row-title" }, s.title || "Untitled"),
          h("div", { class: "row-sub" },
            model ? `${model.providerID}/${model.id}${model.variant ? ` · ${model.variant}` : ""}` : (s.agent ? "" : ""),
            s.agent ? ` · ${s.agent}` : "")),
        h("div", { class: "row-end" },
          h("div", {}, timeAgo(s.time?.updated)),
          s.cost ? h("div", {}, fmtCostSession(s.cost) || "") : null)));
    }
  }

  el.render = async () => {
    renderList();
    // refresh in background
    try {
      const res = await window.__api.listSessions();
      const arr = res?.data ?? res ?? [];
      const sc = new Map(store.state.sessionCache);
      for (const s of arr) sc.set(s.id, s);
      store.set({ sessions: arr, sessionCache: sc });
      renderList();
    } catch (err) {
      toast(describeError(err, "Could not load chats"), "err");
    }
  };
  el.renderList = renderList;
  renderList();
  return el;
}

/* ————————————————————————————————— chat ————————————————————————————————— */

export function ChatView(sessionID, { onChangeModel } = {}) {
  const api = window.__api;
  const scroll = h("div", { class: "chat-scroll" });
  const pillBar = h("div", { class: "chat-model-bar" });
  let busy = false;

  const input = h("textarea", {
    class: "input", rows: 1, placeholder: "Message…",
    oninput: (e) => autoGrow(e.target),
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } },
  });
  const sendBtn = h("button", { class: "send", "aria-label": "Send" });
  function setSendState() {
    sendBtn.classList.toggle("stop", busy);
    sendBtn.setAttribute("aria-label", busy ? "Interrupt" : "Send");
    sendBtn.onclick = busy ? interrupt : send;
    sendBtn.replaceChildren(
      busy
        ? h("svg", { width: 16, height: 16, viewBox: "0 0 24 24" }, h("rect", { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: "currentColor" }))
        : h("svg", { width: 20, height: 20, viewBox: "0 0 24 24" },
            h("path", { d: "M6 12 3 21l18-9L3 3l3 9zm0 0h7", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" })));
  }

  const composer = h("div", { class: "composer" }, input, sendBtn);
  const el = h("div", { class: "chat-wrap" }, scroll, pillBar, composer);

  function autoGrow(t) {
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 130) + "px";
  }

  /* ——— model/agent pills ——— */
  function renderPills() {
    const s = store.state.sessionCache.get(sessionID);
    const model = store.state.pendingModel || s?.model;
    pillBar.replaceChildren(
      h("button", {
        class: `model-pill ${store.state.pendingModel ? "pending" : ""}`,
        onclick: () => onChangeModel?.(),
      },
        h("span", { class: "dot" }),
        model ? `${model.id}${model.variant ? ` · ${model.variant}` : ""}` : "Select model",
        store.state.pendingModel ? h("svg", { width: 12, height: 12, viewBox: "0 0 24 24", class: "spin", style: { marginLeft: 2 } }) : null,
        h("span", { class: "chev" }, "▾")),
      h("button", {
        class: "model-pill",
        onclick: switchAgentModal,
      }, (s?.agent || "build") + " ▾"),
    );
  }

  function switchAgentModal() {
    const agents = (store.state.agents || []).filter((a) => a.mode === "primary" && !a.hidden);
    if (!agents.length) return toast("No agents reported by the server");
    const mclose = openModal({
      title: "Switch agent",
      body: h("div", {}, ...agents.map((a) =>
        h("button", {
          class: "row-item",
          onclick: async () => {
            try {
              await api.switchAgent(sessionID, a.id);
              const sc = new Map(store.state.sessionCache);
              const s = sc.get(sessionID);
              if (s) { sc.set(sessionID, { ...s, agent: a.id }); store.set({ sessionCache: sc }); }
              toast(`Agent switched to ${a.name || a.id}`, "ok");
              mclose?.();
            } catch (err) { toast(describeError(err, "Agent switch failed"), "err"); }
          },
        },
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, a.name || a.id),
            a.description ? h("div", { class: "row-sub" }, a.description) : null)))),
      actions: [{ label: "Close" }],
    });
  }

  /* ——— messages ——— */
  function renderMessages() {
    const messages = store.state.messageCache.get(sessionID) || [];
    const nodes = messages.map(renderMessage);
    if (busy) {
      nodes.push(h("div", { class: "msg assistant" },
        h("div", { class: "msg-bubble" }, h("span", { class: "typing-dots" }, h("i"), h("i"), h("i")))));
    }
    scroll.replaceChildren(...nodes.filter(Boolean));
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }

  function renderMessage(m) {
    const role = m.role || m.type || "user";
    const isUser = role === "user";
    if (role !== "user" && role !== "assistant") return null; // v2: None/system/compaction/iDLE entries
    const parts = m.parts?.length
      ? m.parts
      : m.content?.length
        ? m.content
        : (m.text ? [{ type: "text", text: m.text }] : []);

    const bubbles = [];
    for (const p of parts) {
      if (p.type === "text") {
        if (p.text?.trim()) bubbles.push(h("div", { class: "msg-bubble" }, p.text));
      } else if (p.type === "reasoning" || p.type?.includes("reasoning")) {
        // implicit chain-of-thought stays out of the visible thread
      } else if (p.type === "tool" || p.type?.includes("tool")) {
        const name = p.name || p.tool || p.state?.title || "";
        const status = p.state?.status || "";
        if (name) bubbles.push(h("div", {},
          h("span", { class: "badge mute", style: { fontSize: 9.5 } }, `⚒ ${name}${status ? ` · ${status}` : ""}`)));
      }
    }
    const errText = flattenError(m.error);
    if (errText) {
      bubbles.push(h("div", { class: "msg-bubble", style: { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" } }, `⚠ ${errText}`));
    }
    if (!bubbles.length) return null;

    const messageText = () =>
      parts.filter((p) => p.type === "text" && p.text?.trim()).map((p) => p.text).join("\n\n");

    function metaAction(children, label, doneToast, fn) {
      const btn = h("button", { class: "msg-ma", "aria-label": label, title: label }, ...children);
      btn.onclick = async (e) => {
        e.stopPropagation();
        let ok = false;
        try { ok = await fn(); } catch {}
        toast(ok ? doneToast : `${label} is not available here`, ok ? "ok" : "err", 1600);
      };
      return btn;
    }

    const copyIcon = h("span", { class: "msg-ma-ic" },
      h("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
        h("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" })));
    const shareIcon = h("span", { class: "msg-ma-ic" },
      h("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("circle", { cx: "18", cy: "5", r: "3" }),
        h("circle", { cx: "6", cy: "12", r: "3" }),
        h("circle", { cx: "18", cy: "19", r: "3" }),
        h("path", { d: "M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" })));

    const meta = [];
    if (!isUser) {
      const mref = m.model || m; // v2 nests {providerID, id}; v1 keeps providerID/modelID fields
      const pid = mref.providerID || m.providerID;
      const mid = mref.id || m.modelID;
      if (pid && mid) meta.push(`${pid}/${mid}`);
      if (m.tokens && (m.tokens.input + m.tokens.output)) meta.push(`${fmtTokens(m.tokens.input + m.tokens.output)} tok`);
      const costLabel = fmtCostSession(m.cost);
      if (costLabel) meta.push(costLabel);
      const mtext = messageText();
      if (mtext) {
        meta.push(h("span", { style: { display: "inline-flex", gap: 10, alignItems: "center" } },
          metaAction([copyIcon], "Copy", "Copied to clipboard", async () => { haptic("light"); return copyText(mtext); }),
          metaAction([shareIcon], "Share", "Opening share sheet", async () => { haptic("light"); return shareText("Mobcode reply", mtext); }),
        ));
      }
    }
    if (m.time?.created) meta.push(fmtTime(m.time.created));

    return h("div", { class: `msg ${isUser ? "user" : "assistant"}` },
      ...bubbles,
      meta.length ? h("div", { class: "msg-meta", style: isUser ? { justifyContent: "flex-end" } : {} },
        meta.map((x, i) => h("span", {}, x, i < meta.length - 1 ? " · " : ""))) : null,
    );
  }

  function flattenError(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err.message) return String(err.message);
    if (err.data?.message) return String(err.data.message);
    try { return JSON.stringify(err).slice(0, 280); } catch { return String(err); }
  }

  /* ——— actions ——— */
  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; autoGrow(input);
    haptic("light");
    await doSend(text);
  }

  async function doSend(text) {
    if (busy) return;
    busy = true;
    setSendState();
    renderMessages();
    try {
      await api.prompt(sessionID, text);
      haptic("success");
      await refreshMessages();
    } catch (err) {
      busy = false;
      setSendState();
      renderMessages();
      // never silently lose the user's message — restore it into the composer
      input.value = text;
      autoGrow(input);
      input.focus?.();
      toast(describeError(err, "Could not send"), "err", 4200);
    }
  }

  async function interrupt() {
    try {
      sendBtn.disabled = true;
      await api.interrupt(sessionID);
      sendBtn.disabled = false;
      busy = false;
      setSendState();
      renderMessages();
    } catch (err) {
      toast(describeError(err, "Could not interrupt"), "err");
      sendBtn.disabled = false;
    }
  }

  /* ——— data ——— */
  async function loadSession() {
    try {
      const [sRes, mRes] = await Promise.allSettled([api.getSession(sessionID), api.listMessages(sessionID, 200)]);
      if (sRes.status === "fulfilled" && sRes.value) {
        const s = sRes.value?.data || sRes.value;
        const sc = new Map(store.state.sessionCache);
        sc.set(sessionID, s);
        store.set({ sessionCache: sc });
      }
      if (mRes.status === "fulfilled" && mRes.value) {
        const msgs = (mRes.value?.data ?? mRes.value ?? []).filter(Boolean);
        // API returns newest-first; store chronologically so rendering + busy
        // detection see a stable oldest->newest order.
        msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
        const mc = new Map(store.state.messageCache);
        mc.set(sessionID, msgs);
        store.set({ messageCache: mc });
      }
      busy = assistantBusy();
      renderPills();
      renderMessages();
    } catch (err) {
      toast(describeError(err, "Could not open the chat"), "err");
    }
  }

  async function refreshMessages() {
    try {
      const res = await api.listMessages(sessionID, 200);
      const msgs = (res?.data ?? res ?? []).filter(Boolean);
      // keep chronological order (API streams newest-first)
      msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
      const mc = new Map(store.state.messageCache);
      mc.set(sessionID, msgs);
      store.set({ messageCache: mc });
    } catch {}
    const wasBusy = busy;
    busy = assistantBusy();
    if (wasBusy !== busy || true) setSendState();
    renderPills();
    renderMessages();
  }

  function assistantBusy() {
    const msgs = store.state.messageCache.get(sessionID) || [];
    const newestAssistant = [...msgs].reverse().find((m) => (m.role || m.type) === "assistant" && !m.error);
    return Boolean(newestAssistant && !newestAssistant.time?.completed);
  }

  // externally triggered refresh (SSE deltas, model switch confirmations)
  el.refreshMessages = refreshMessages;

  setSendState();
  renderPills();
  loadSession();

  const unsub = store.subscribe((st) => {
    const s = st.sessionCache.get(sessionID);
    const p = st.pendingModel;
    const m = s?.model;
    if (p && m && p.providerID === m.providerID && p.id === m.id && (p.variant || undefined) === (m.variant || undefined)) {
      store.set({ pendingModel: null });
    }
    renderPills();
  });
  el.cleanup = () => { unsub(); };

  return el;
}

/* ————————————————————————————————— providers screen ————————————————————————————————— */

export function ProvidersView({ onConnect, onDisconnect, onBrowseModels } = {}) {
  const searchState = { q: "" };
  const searchInput = h("input", {
    class: "input", placeholder: "Search providers…", autocomplete: "off",
    oninput: (e) => { searchState.q = e.target.value.toLowerCase(); renderAvailable(); },
  });
  const connectedHolder = h("div", {});
  const availHolder = h("div", {});

  function connectedCards() {
    const ids = store.state.connectedProviderIds || [];
    if (!ids.length) {
      return h("div", { class: "hint", style: { padding: "2px 2px 6px" } },
        "No providers are connected on this server yet — connect one below. Models appear automatically once connected.");
    }
    return ids.map((pid) => {
      const name = providerDisplayName(pid);
      const count = providerModelsCount(pid);
      return h("div", { class: "card prov-card" },
        h("div", { class: "prov-head" },
          h("span", { class: "mg-dot", style: { background: "var(--ok)" } }),
          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", { class: "prov-name" }, name),
            h("div", { class: "prov-id mono" }, pid)),
          h("span", { class: "badge ok" }, "Connected")),
        h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          count !== null ? h("span", { class: "badge mute" }, `${count} models`) : null),
        h("div", { class: "prov-actions" },
          h("button", { class: "btn small", onclick: () => onBrowseModels?.(pid) }, "Browse models"),
          h("button", { class: "btn small danger", onclick: () => onDisconnect?.(pid) }, "Disconnect")));
    });
  }

  function renderAvailable() {
    const q = searchState.q;
    availHolder.replaceChildren();
    let entries = (store.state.integrations || []).slice()
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    if (q) entries = entries.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.id || "").toLowerCase().includes(q));

    if (!entries.length) {
      availHolder.append(h("div", { class: "empty-state" }, h("div", { class: "big" }, "⌕"), q ? `No providers matching “${q}”.` : "Server catalog is empty."));
      return;
    }
    for (const p of entries) {
      const connected = (store.state.connectedProviderIds || []).includes(p.id) ||
        (p.connections || []).length > 0;
      const count = providerModelsCount(p.id);
      const methods = p.methods || [];
      const mFlags = [
        methods.some((m) => m.type === "oauth" || m.type === "external") ? "OAuth" : null,
        methods.some((m) => m.type === "key") ? "Key" : null,
        methods.some((m) => m.type === "env") ? "Env" : null,
      ].filter(Boolean).slice(0, 2).join(" · ");
      availHolder.append(h("button", {
        class: "connect-row", style: { opacity: connected ? 0.72 : 1 },
        onclick: () => (connected ? onBrowseModels?.(p.id) : onConnect?.(p.id)),
      },
        h("div", { class: "row-main" },
          h("div", { class: "row-title" }, p.name || p.id, connected ? h("span", { class: "badge ok", style: { fontSize: 9, marginLeft: 8 } }, "connected") : null),
          h("div", { class: "row-sub mono" }, p.id),
          mFlags ? h("div", { class: "row-sub" }, mFlags) : null),
        h("div", { class: "row-end", style: { gap: 4 } },
          count !== null ? h("span", { class: "badge mute", style: { alignSelf: "flex-start" } }, `${count} models`) : null)));
    }
  }

  const el = h("div", { class: "container fade-in" },
    h("div", { class: "section-title", style: { marginTop: 4 } }, "Connected on your server"),
    connectedHolder,
    h("div", { class: "section-title" }, "All known providers"),
    h("div", { class: "field" }, searchInput),
    availHolder,
    h("div", { class: "hint", style: { margin: "8px 2px" } },
      "Connections run the OpenCode server's own authentication flows — keys and OAuth tokens are stored server-side, never in Mobcode."),
  );

  el.render = () => { connectedHolder.replaceChildren(...connectedCards()); renderAvailable(); };
  el.render();
  return el;
}

/* ————————————————————————————————— settings ————————————————————————————————— */

export function SettingsView() {
  const st = store.state;
  const nativeMode = isNative();

  const dirInput = h("input", { class: "input", value: st.directory || st.host.directory || "", placeholder: "empty = server default", spellcheck: "false" });
  const statusLine = h("div", { class: "status-line" });

  async function editConnection() {
    const cfg = (await loadConnection()) || { url: "", password: "", kind: "companion", directory: st.directory };
    const urlInput = h("input", { class: "input", value: cfg.url || "", placeholder: "https://your-mobcode-backend.onrender.com", spellcheck: "false", inputmode: "url" });
    const pwInput = h("input", { class: "input", type: "password", placeholder: cfg.password ? "(keep current)" : "only if the backend requires it", autocomplete: "off" });
    const dirInput2 = h("input", { class: "input", value: cfg.directory || st.directory || "", placeholder: "empty = server default", spellcheck: "false" });
    const errLine = h("div", { class: "status-line" });
    openModal({
      title: "Mobcode backend connection",
      body: h("div", {},
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Server URL"), urlInput),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Password (optional)"), pwInput),
        h("div", { class: "field" }, h("span", { class: "field-label" }, "Workspace directory"), dirInput2),
        errLine),
      actions: [
        { label: "Cancel" },
        {
          label: "Save connection", class: "btn primary",
          onClick: async (_e, close) => {
            const url = urlInput.value.trim();
            if (!url) { errLine.className = "status-line err"; errLine.textContent = "Enter the server URL."; return; }
            const check = urlIsAllowed(url);
            if (!check.ok) { errLine.className = "status-line err"; errLine.textContent = check.error; return; }
            errLine.className = "status-line";
            errLine.replaceChildren(h("span", { class: "spin" }), " Verifying…");
            const base = String(check.url).replace(/\/+$/, "");
            const password = pwInput.value ? pwInput.value.trim() : (cfg.password || "");
            const probed = await probeConnection(base, password);
            if (!probed.ok) {
              errLine.className = "status-line err";
              errLine.textContent = probed.error || "Connection test failed.";
              return;
            }
            await saveConnection({ url: base, password, kind: probed.kind, directory: dirInput2.value.trim() });
            close();
            store.set({ connected: false, authMode: probed.kind === "opencode" ? "basic" : "bearer" });
            await window.__boot?.();
            window.__nav?.home();
            toast("Connection updated", "ok");
          },
        },
      ],
    });
  }

  async function saveDirectory() {
    const dir = dirInput.value.trim();
    store.set({ directory: dir });
    store.persistPrefs?.();
    if (st.host.companion) {
      try {
        await window.__api.saveHostConfig({ open: null, directory: dir, password: "" });
        statusLine.className = "status-line ok";
        statusLine.textContent = "Saved. Refreshing catalogue…";
        await window.__refreshAll?.(true);
        statusLine.textContent = "Saved.";
        return;
      } catch (err) {
        statusLine.className = "status-line err";
        statusLine.textContent = describeError(err, "Failed to save on host");
        return;
      }
    }
    await window.__refreshAll?.(true);
    statusLine.className = "status-line ok";
    statusLine.textContent = "Saved locally.";
  }

  async function newChatAgentOptions() {
    const agents = (store.state.agents || []).filter((a) => a.mode === "primary" && !a.hidden);
    return agents;
  }

  const agentSelect = h("select", { class: "input", id: "agent-select" });
  newChatAgentOptions().then((agents) => {
    agentSelect.replaceChildren(...agents.map((a) => h("option", { value: a.id, selected: (store.state.agentsChoice ?? "build") === a.id }, a.name || a.id)));
  });

  const el = h("div", { class: "container fade-in" },
    nativeMode ? h("div", { class: "section-title", style: { marginTop: 4 } }, "Server connection") : null,
    nativeMode ? h("div", { class: "card", style: { padding: "14px", fontSize: 13.5 } },
      h("div", { style: { display: "flex", gap: 8, alignItems: "center", minWidth: 0 } },
        h("span", { class: "mg-dot", style: { background: st.connected ? "var(--ok)" : "var(--danger)" } }),
        h("div", { class: "mono", style: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          st.target || "(no backend configured)")),
      h("div", { class: "divider" }),
      h("button", { class: "btn block", onclick: editConnection }, "Edit connection"),
      h("div", { class: "hint", style: { marginTop: 8 } },
        "Stored encrypted on this device (EncryptedSharedPreferences). HTTPS enforced; credentials never leave the app.")) : null,

    h("div", { class: "section-title", style: nativeMode ? {} : { marginTop: 4 } }, "Server"),
    h("div", { class: "card", style: { padding: "14px", fontSize: 13.5 } },
      h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
        h("span", { class: `mg-dot`, style: { background: st.connected ? "var(--ok)" : "var(--danger)" } }),
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", { style: { fontWeight: 600 } }, st.host.companion ? "Companion proxy" : "Direct connection"),
          h("div", { class: "mono", style: { fontSize: 11, color: "var(--text-mute)" } }, st.target || "same-origin"))
      ),
      h("div", { class: "divider" }),
      h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
        h("div", { style: { flex: 1, fontSize: 12, color: "var(--text-mute)" } },
          "Live events: ",
          { "init": "connecting…", connected: "streaming", disconnected: "reconnecting", error: "offline" }[st.sseStatus] || st.sseStatus),
        SSEBadge()),
      h("div", { class: "divider" }),
      h("div", { class: "field" },
        h("span", { class: "field-label" }, "Workspace directory"),
        dirInput),
      h("button", { class: "btn block", onclick: saveDirectory }, "Save directory"),
      h("div", { class: "hint", style: { marginTop: 8 } },
        "Applies to model/catalogue + session listing. Leave empty for the server default."),
      statusLine),

    h("div", { class: "section-title" }, "New chats"),
    h("div", { class: "card", style: { padding: "14px" } },
      h("div", { class: "field", style: { marginBottom: 0 } },
        h("span", { class: "field-label" }, "Agent"),
        agentSelect,
        h("div", { class: "hint" }, "Used when starting a fresh chat from the Models sheet."))),

    h("div", { class: "section-title" }, "About"),
    h("div", { class: "card", style: { padding: "14px", fontSize: 12.5, color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: 6 } },
      h("div", {}, "Mobcode v1.0"),
      h("div", {}, "Dynamic model catalogue — fetched live from your OpenCode server (GET /api/model). No hardcoded provider or model lists."),
      h("div", {}, "Credentials are handled server-side; Mobcode never stores keys or talks to providers directly.")),

    h("div", { style: { margin: "22px 0" } },
      h("button", {
        class: "btn danger block",
        onclick: () => {
          openModal({
            title: "Disconnect from the OpenCode server?",
            body: h("p", {}, "The Mobcode host will forget this server URL. Nothing on the OpenCode server is changed."),
            actions: [
              { label: "Cancel" },
              {
                label: "Disconnect", class: "btn danger",
                onClick: async (_e, close) => {
                  close();
                  if (nativeMode) await clearConnection();
                  await window.__api.disconnectHost?.();
                  store.set({ connected: false, models: null, sessions: [], connectedProviderIds: [], catalog: [] });
                  window.__nav?.connect();
                },
              },
            ],
          });
        },
      }, "Forget this server")),
  );

  function SSEBadge() {
    return h("span", {
      class: `chip static ${st.sseStatus === "connected" ? "" : ""}`,
      style: { borderRadius: 999, padding: "4px 10px", background: st.sseStatus === "connected" ? "rgba(52,211,153,.12)" : "rgba(251,191,36,.12)" },
    }, st.sseStatus === "connected" ? "● live" : "◌ offline");
  }

  // live updates for sse status
  const unsub = store.subscribe((s) => {
    if (!document.body.contains(el)) return;
    el.querySelector(".chip.static")?.replaceChildren(s.sseStatus === "connected" ? "● live" : "◌ offline");
    el.querySelector(".chip.static").style.background = s.sseStatus === "connected" ? "rgba(52,211,153,.12)" : "rgba(251,191,36,.12)";
  });
  el.cleanup = unsub;

  return el;
}
