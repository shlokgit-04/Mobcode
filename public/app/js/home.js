/**
 * Mobcode Home — the calm starting point.
 *
 * Greeting, one big prompt composer (model + project selector, attachments,
 * send), recent conversations, recent projects, new-project shortcut.
 * No dashboards, no statistics, no technical clutter.
 */
import { h, toast } from "./ui.js";
import { store } from "./store.js";
import { describeError } from "./api.js";
import { createSessionWithModel } from "./views.js";
import { openModelPicker } from "./modelpicker.js";
import { timeAgo } from "./format.js";
import { copyText } from "./native.js";

function greet() {
  const h0 = new Date().getHours();
  if (h0 < 5) return "Working late";
  if (h0 < 12) return "Good morning";
  if (h0 < 17) return "Good afternoon";
  if (h0 < 22) return "Good evening";
  return "Good night";
}

export function HomeView({ onOpenChat, onProject } = {}) {
  const state = { text: "", files: [] }; // files: [{name, mime, data(base64)}]
  const api = window.__api;

  const textarea = h("textarea", {
    placeholder: "Describe what you want to create or change...",
    rows: 3, spellcheck: "true",
    oninput: (e) => {
      state.text = e.target.value;
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 220) + "px";
      sendBtn.disabled = !state.text.trim();
      },
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } },
  });

  const attachHolder = h("span", { style: { display: "contents" } });
  const modelBtn = h("button", {
    class: "composer-pill", onclick: () => {
      const s = store.state.sessionCache.get(pendingSessionId());
      openModelPicker({
        mode: "newchat",
        onNewChat: (ref) => startWithModel(ref),
      });
    },
  }, h("span", { class: "dot" }), h("span", { class: "lbl" }, "Model"), h("span", { class: "chev" }, "▾"));

  const projectBtn = h("button", {
    class: "composer-pill", onclick: openProjectPicker,
  }, h("svg", { viewBox: "0 0 24 24", width: "13", height: "13", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
    h("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" })), h("span", { class: "lbl" }, "Project"), h("span", { class: "chev" }, "▾"));

  const fileInput = h("input", { type: "file", multiple: true, style: { display: "none" },
    onchange: (e) => { addFiles([...e.target.files]); e.target.value = ""; } });
  const attachBtn = h("button", { class: "tool-btn", "aria-label": "Attach files", onclick: () => fileInput.click() },
    h("svg", { viewBox: "0 0 24 24", width: "17", height: "17", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
      h("path", { d: "m21.5 11.5-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8.5-8.5" })));

  const voiceBtn = h("button", {
    class: "tool-btn", "aria-label": "Voice input", hidden: !voiceSupported(),
    onclick: toggleVoice,
  },
    h("svg", { viewBox: "0 0 24 24", width: "17", height: "17", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" },
      h("rect", { x: "9", y: "2.5", width: "6", height: "11", rx: "3" }),
      h("path", { d: "M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" })));

  const sendBtn = h("button", { class: "send-fab", "aria-label": "Send", disabled: true, onclick: send },
    h("svg", { viewBox: "0 0 24 24", width: "19", height: "19" },
      h("path", { d: "M6 12 3 21l18-9L3 3l3 9zm0 0h7", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" })));

  function pendingSessionId() { return store.state.activeSessionId || ""; }

  /* ————— attachments ————— */
  function addFiles(fl) {
    for (const f of fl) {
      if (f.size > 3.5 * 1024 * 1024) { toast(`"${f.name}" is over 3.5 MB — skipped`, "err"); continue; }
      state.files.push({ name: f.name, mime: f.type || "application/octet-stream", file: f });
    }
    renderChips();
  }
  function renderChips() {
    attachHolder.replaceChildren(
      ...state.files.map((f, i) =>
        h("button", { class: "attach-chip", onclick: (e) => { e.stopPropagation(); state.files.splice(i, 1); renderChips(); } },
          truncate(f.name, 22), h("span", { class: "x" }, "✕"))));
  }

  /* ————— voice ————— */
  function voiceSupported() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return Boolean(SR);
  }
  let rec = null;
  function toggleVoice() {
    if (rec) { rec.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported on this device", "err"); return; }
    try {
      rec = new SR();
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e2) => {
        const said = e2.results[e2.results.length - 1][0].transcript;
        state.text = (state.text ? state.text + " " : "") + said;
        textarea.value = state.text;
        sendBtn.disabled = !state.text.trim();
      };
      rec.onend = () => { rec = null; voiceBtn.style.color = ""; };
      rec.onerror = () => { rec = null; toast("Voice input failed", "err"); };
      rec.start();
      voiceBtn.style.color = "var(--accent-2)";
      toast("Listening…", "ok", 1400);
    } catch { rec = null; }
  }

  /* ————— project picker ————— */
  function openProjectPicker() {
    const projects = store.state.projects.filter((p) => p.id !== "global");
    openSheet((s) => {
      const body = h("div", { class: "sheet-body", style: { padding: "0 18px 24px" } });
      body.append(h("div", { class: "hint", style: { margin: "4px 2px 12px" } },
        "Chats run inside a project. Pick one to work in — a fresh chat is created there."));
      for (const p of projects) {
        const dir = p.canonical || p.directory || "";
        body.append(h("button", { class: "row-item", onclick: () => { s.close(); pick(p, dir); } },
          h("div", { class: "avatar-sm" }, (dir.split("/").pop() || "?").slice(0, 1).toUpperCase()),
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, dir.split("/").pop() || p.id),
            h("div", { class: "row-sub mono" }, dir)),
          store.state.currentProjectId === p.id ? h("span", { class: "badge ok" }, "Current") : null));
      }
      return h("div", {},
        h("div", { class: "sheet-head" },
          h("div", { class: "sheet-grip" }),
          h("div", { class: "sheet-title-row" },
            h("span", { class: "sheet-title" }, "Choose project"),
            h("button", { class: "sheet-close", "aria-label": "Close", onclick: s.close }, "✕"))),
        body);
    });
  }
  function pick(p, dir) {
    store.set({ currentProjectId: p?.id || "", directory: dir });
    store.persistPrefs?.();
    updateProjectLabel();
  }
  function updateProjectLabel() {
    const dir = projectDirectory();
    const name = dir ? dir.split("/").pop() : "Project";
    projectBtn.querySelector(".lbl").textContent = truncate(name, 18);
  }

  /* ————— send ————— */
  async function startWithModel(ref) {
    const dir = projectDirectory();
    const session = await createSessionWithModel(ref, dir ? { directory: dir } : undefined);
    // hand off the composer text + files to the chat screen
    if (state._handoff) state._handoff({ text: state.text, files: state.files });
    return session;
  }

  async function send() {
    const text = state.text.trim();
    if (!text) return;
    const files = state.files.slice();
    state.text = ""; textarea.value = ""; textarea.style.height = "auto";
    sendBtn.disabled = true;
    try {
      // resolve pending attachment files → base64 payload (real attachments)
      const payloadFiles = [];
      for (const f of files) {
        const data = await readAsBase64(f.file);
        payloadFiles.push({ data, mime: f.mime, name: f.name, source: { type: "inline" } });
      }
      await handoffToChat(text, payloadFiles);
    } catch (err) {
      toast(describeError(err, "Could not start the chat"), "err", 4200);
      state.text = text; textarea.value = text; sendBtn.disabled = false;
    }
  }

  /** Hand the composed prompt to a new chat (or the most recent chat). */
  async function handoffToChat(text, files) {
    const dir = projectDirectory();
    const session = await createSessionWithModel(null, dir ? { directory: dir } : undefined);
    const sel = store.state.pendingModel; // model chosen moments ago, if any
    await new Promise((r) => setTimeout(r, 60)); // allow route render first
    window.__chatHandoff?.(session.id, { text, files, model: sel });
  }
  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /* ————— list rendering ————— */
  const listEl = h("div", {});
  const el = h("div", { class: "view-pad fade-in" },
    h("div", { class: "home-hero" },
      h("p", { class: "greeting" }, greet()),
      h("h1", { class: "home-headline" }, "What do you want to ", h("span", { class: "grad" }, "build"), "?"),
    ),
    h("div", { class: "composer-card" },
      textarea,
      attachHolder,
      h("div", { class: "composer-tools" },
        attachBtn, voiceBtn, fileInput,
        h("span", { style: { flex: 1 } }),
        modelBtn, projectBtn,
        sendBtn),
    ),
    h("div", { class: "section-title", style: { marginTop: 18 } }, h("div", { style: { flex: 1 } }, "Recent"), ""),
    h("div", { class: "recent-chip-row", id: "home-recent-chats" }),
    h("div", { class: "section-title" }, h("div", { style: { flex: 1 } }, "Projects"), "" ),
    h("div", { class: "recent-chip-row", id: "home-recent-projects" }),
    h("div", { style: { marginTop: 8 } },
      h("button", { class: "home-quick", onclick: () => window.__navProjects?.() },
        h("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" },
          h("path", { d: "M12 5v14M5 12h14" })),
        "Start a new project"),
    ),
  );

  function chipRow(holder, items, mk) {
    holder.replaceChildren();
    if (!items.length) return;
    const row = h("div", { class: "recent-chip-row" });
    items.forEach((it) => row.append(mk(it)));
    holder.replaceChildren(row);
  }

  function renderRecents() {
    const chats = [...store.state.sessions]
      .sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
      .slice(0, 6);
    const holder = el.querySelector("#home-recent-chats");
    if (!chats.length) {
      holder.replaceChildren(h("div", { class: "hint", style: { padding: "4px 2px" } }, "Your conversations will appear here."));
    } else {
      chipRow(holder, chats, (s) => {
        const c = h("button", { class: "recent-chip", onclick: () => onOpenChat?.(s.id) },
          h("span", { class: "t" }, truncate(s.title || "New chat", 30)), h("span", { class: "n" }, timeAgo(s.time?.updated).replace(" ago", "")));
        return c;
      });
    }
    const projects = store.state.projects.filter((p) => p.id !== "global").slice(0, 6);
    const ph = el.querySelector("#home-recent-projects");
    if (!projects.length) {
      ph.replaceChildren(h("div", { class: "hint", style: { padding: "4px 2px" } }, "Projects from your server appear here."));
    } else {
      chipRow(ph, projects, (p) => {
        const dir = p.canonical || p.directory || "";
        return h("button", { class: "recent-chip", onclick: () => { pick(p, dir); onOpenChatFromProject(p); } },
          h("span", { class: "t" }, truncate(dir.split("/").pop() || p.id, 24)),
          h("span", { class: "n" }, timeAgo(p.time?.active).replace(" ago", "")));
      });
    }
  }
  async function onOpenChatFromProject(p) {
    try {
      const dir = p.canonical || p.directory;
      const res = await api.createSession({ agent: store.state.agentsChoice || "build", location: { directory: dir } });
      const session = res?.data || res;
      const sc = new Map(store.state.sessionCache);
      sc.set(session.id, session);
      const mc = new Map(store.state.messageCache);
      mc.set(session.id, []);
      store.set({ sessionCache: sc, messageCache: mc, currentProjectId: p.id, sessions: [session, ...store.state.sessions] });
      window.__nav.renderChat(session.id);
    } catch (err) { toast(describeError(err, "Could not open project"), "err"); }
  }

  window.__navProjects = () => { onProject?.(); };

  /* handoff receiver from chat creation */
  state._handoff = (payload) => { window.__chatHandoff?.(store.state.activeSessionId, payload); };

  el.render = async () => {
    updateProjectLabel();
    renderRecents();
    try {
      const [sess, proj] = await Promise.allSettled([api.listSessions(), api.get("/api/project")]);
      if (sess.status === "fulfilled") {
        const arr = sess.value?.data ?? sess.value ?? [];
        const sc = new Map(store.state.sessionCache);
        for (const s of arr) sc.set(s.id, s);
        store.set({ sessions: arr, sessionCache: sc });
      }
      if (proj.status === "fulfilled") {
        const arr = Array.isArray(proj.value) ? proj.value : proj.value?.data ?? [];
        store.set({ projects: arr.filter((p) => p.id !== "global") });
      }
    } catch {}
    renderRecents();
    updateProjectLabel();
  };
  const unsub = store.subscribe(() => {
    if (!document.body.contains(el)) return;
    renderRecents();
    updateProjectLabel();
  });
  el.cleanup = () => unsub();

  return el;
}

function projectDirectory() {
  const st = store.state;
  if (st.currentProjectId) {
    const p = st.projects.find((x) => x.id === st.currentProjectId);
    if (p) return p.canonical || p.directory || "";
  }
  return st.directory || "";
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
