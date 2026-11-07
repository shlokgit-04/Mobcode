/**
 * Mobcode Chat — the centre of the app.
 *
 * Markdown rendering with highlighted code + copy, real agent activity cards
 * (from actual OpenCode tool parts), streaming-friendly refresh, stop, retry,
 * new chat, model switching, and a composer that stays above the keyboard.
 *
 * Attachments: phone files are uploaded into the server workspace
 * (POST /api/experimental/fs/write, binary) and then attached by URI —
 * this is exactly how the engine expects file references in prompts.
 */
import { h, toast, openModal } from "./ui.js";
import { store } from "./store.js";
import { describeError } from "./api.js";
import { fmtTokens, fmtCostSession, fmtTime } from "./format.js";
import { haptic, copyText, shareText } from "./native.js";
import { renderMarkdown } from "./markdown.js";
import { toolMeta, toolDetail, toolOutput, toolIcon } from "./activitymap.js";

export function ChatView(sessionID, { onChangeModel } = {}) {
  const api = window.__api;
  const scroll = h("div", { class: "chat-scroll" },
    h("div", { class: "chat-inner", id: "chat-inner" }));
  const pillBar = h("div", { class: "chat-model-bar" });
  const composerHolder = h("div", { class: "chat-composer" });
  let busy = false;
  const upload = { files: [] };

  const el = h("div", { class: "chat-wrap" }, scroll, pillBar, composerHolder);

  function setConnBusy(state) {
    busy = state;
    setSendState();
    renderMessages(false);
    renderPills();
  }
  window.__chatHandoff = async (sid, payload) => {
    if (sid !== sessionID) return;
    if (payload?.model && payload?.model !== lastModelSent) {
      try { await api.switchModel(sid, payload.model); } catch {}
      lastModelSent = payload.model || null;
    }
    if (payload?.text) {
      if (busy) return;
      await doSend(payload.text, payload.files || []);
    }
  };
  window.__chatAttachSuggest = (path) => {
    setUploadChips();
  };

  /* ---------- pills ---------- */
  let lastModelSent = null;
  function renderPills() {
    const s = store.state.sessionCache.get(sessionID);
    const model = store.state.pendingModel || s?.model;
    const agent = s?.agent || "build";
    const mdl = model
      ? `${model.id}${model.variant ? " · " + model.variant : ""}`
      : "Select model";
    pillBar.replaceChildren(
      h("button", {
        class: `model-pill ${store.state.pendingModel ? "pending" : ""}`,
        onclick: () => onChangeModel?.(),
      },
        h("span", { class: "dot" }), mdl, h("span", { class: "chev" }, "▾")),
      h("button", { class: "model-pill", onclick: agentModal }, agent, h("span", { class: "chev" }, "▾")),
    );
  }

  function agentModal() {
    const agents = (store.state.agents || []).filter((a) => a.mode === "primary" && !a.hidden);
    if (!agents.length) return toast("No agents reported by the server");
    const close = openModal({
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
              close?.();
            } catch (err) { toast(describeError(err, "Agent switch failed"), "err"); }
          },
        },
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, a.name || a.id),
            a.description ? h("div", { class: "row-sub" }, a.description) : null)))),
      actions: [{ label: "Close" }],
    });
  }
  function lastStep(steps) { return steps[steps.length - 1]; }
  /* ---------- composer ---------- */
  const input = h("textarea", {
    rows: 1, placeholder: "Reply…",
    oninput: (e) => autoGrow(e.target),
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendNow(); } },
  });
  const uploadChips = h("div", { style: { display: "none", gap: "4px", flexWrap: "wrap", width: "100%", marginBottom: "6px" } });
  const attachInput = h("input", { type: "file", multiple: true, style: { display: "none" },
    onchange: (e) => { if (e.target.files?.length) addToUploads([...e.target.files]); e.target.value = ""; } });
  const composer = h("div", { style: { flex: 1, minWidth: 0, display: "flex", alignItems: "flex-end", gap: 8 } },
    h("button", {
      class: "icon-btn", "aria-label": "Attach", style: { width: "40px", height: "40px", flexShrink: 0 },
      onclick: () => attachInput.click(),
    }, h("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
      h("path", { d: "m21.5 11.5-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8.5-8.5" }))),
    input,
    attachInput);
  const sendBtn = h("button", { class: "send", "aria-label": "Send" });
  function setSendState() {
    sendBtn.classList.toggle("stop", busy);
    sendBtn.setAttribute("aria-label", busy ? "Stop generating" : "Send");
    sendBtn.onclick = busy ? interrupt : sendNow;
    sendBtn.replaceChildren(
      busy
        ? h("svg", { width: 16, height: 16, viewBox: "0 0 24 24" }, h("rect", { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: "currentColor" }))
        : h("svg", { width: 20, height: 20, viewBox: "0 0 24 24" },
            h("path", { d: "M6 12 3 21l18-9L3 3l3 9zm0 0h7", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" })));
  }
  composerHolder.replaceChildren(uploadChips, composer, sendBtn);

  function addToUploads(files) {
    (async () => {
      for (const f of files) {
        if (f.size > 6 * 1024 * 1024) { toast(`"${f.name}" is over 6 MB — skipped`, "err"); continue; }
        upload.files.push(f);
      }
      setUploadChips();
    })();
  }
  function setUploadChips() {
    if (!upload.files.length) { uploadChips.style.display = "none"; uploadChips.replaceChildren(); return; }
    uploadChips.style.display = "flex";
    uploadChips.replaceChildren(...upload.files.map((f, i) =>
      h("button", { class: "attach-chip" },
        truncate(f.name, 20),
        h("span", { class: "x", onclick: (e) => { e.stopPropagation(); upload.files.splice(i, 1); setUploadChips(); } }, "✕"))));
  }
  /** Uploads pending phone files into the server workspace; returns {uri} refs. */
  async function uploadPending() {
    const out = [];
    for (const f of upload.files) {
      try {
        toast(`Uploading ${truncate(f.name, 24)}…`, "info", 2000);
        const stamp = Date.now();
        const safeName = f.name.replace(/[^\w.\-]+/g, "_") || "file";
        const bytes = await f.arrayBuffer();
        const res = await api.request(
          "POST",
          `/api/experimental/fs/write?path=mobcode-uploads%2F${stamp}-${encodeURIComponent(safeName)}`,
          undefined, undefined,
          { rawBody: bytes, contentType: "application/octet-stream" });
        const abs = res?.data?.path;
        if (abs) out.push({ uri: abs });
        else toast(`Upload failed: ${truncate(f.name, 22)}`, "err", 3600);
      } catch (err) {
        toast(`Upload failed: ${truncate(f.name, 22)}`, "err", 3600);
      }
    }
    return out;
  }

  function autoGrow(t) {
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 140) + "px";
  }

  /* ---------- send / stop / retry ---------- */
  async function sendNow() {
    const text = input.value.trim();
    const pending = upload.files.slice();
    if (!text && !pending.length) return;
    input.value = ""; autoGrow(input);
    haptic("light");
    let refs = [];
    if (pending.length) refs = await uploadPending();
    await doSend(text || "(see the attached files)", refs);
    if (refs.length) upload.files = []; setUploadChips();
  }

  async function doSend(text, files = []) {
    if (busy) return;
    busy = true;
    setSendState();
    try {
      const refs = files.length ? files.filter(Boolean).map((f) => ({ uri: f.uri || f })) : undefined;
      await api.prompt(sessionID, text, "steer", refs);
      haptic("success");
      await refreshMessages();
    } catch (err) {
      busy = false;
      setSendState();
      input.value = text;
      autoGrow(input);
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
      store.logActivity({ at: Date.now(), kind: "run", label: "Generation stopped", status: "err", sessionId: sessionID });
      renderMessages();
      renderPills();
    } catch (err) {
      toast(describeError(err, "Could not interrupt"), "err");
      sendBtn.disabled = false;
    }
  }

  async function retryLast() {
    const msgs = store.state.messageCache.get(sessionID) || [];
    const lastUser = [...msgs].reverse().find((m) => (m.role || m.type) === "user" || m.type === "user");
    if (!lastUser) return toast("Nothing to retry");
    if (busy) return;
    busy = true;
    setSendState();
    try {
      await api.prompt(sessionID, lastUser.text, "steer");
      await refreshMessages();
    } catch (err) {
      toast(describeError(err, "Retry failed"), "err", 4200);
    } finally {
      busy = false;
      setSendState();
    }
  }
  window.__chatRetry = retryLast;

  /* ---------- messages ---------- */
  function renderMessages(scrollToEnd = true) {
    const messages = store.state.messageCache.get(sessionID) || [];
    const inner = scroll.firstChild;
    const nodes = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const node = renderMessage(m, messages[i + 1]);
      if (node) nodes.push(node);
    }
    if (busy) {
      nodes.push(h("div", { class: "msg assistant" },
        h("div", { class: "activity-card" },
          h("div", { class: "act-head", style: { cursor: "default" } },
            h("span", { class: "act-spin" }),
            h("span", { class: "act-label" }, "Agent is working…"))),
        h("div", { class: "msg-bubble", style: { marginTop: 2, width: "96px" } },
          h("span", { class: "typing-dots" }, h("i"), h("i"), h("i")))));
    }
    inner.replaceChildren(...nodes);
    if (scrollToEnd) requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }

  function renderMessage(m, nextMsg) {
    const type = m.type || m.role || "user";
    if (type === "user") {
      if (!m.text?.trim() && !(m.files?.length)) return null;
      return h("div", { class: "msg user" },
        h("div", { class: "msg-bubble" }, m.text || ""),
        m.files?.length
          ? h("div", { class: "msg-meta" }, m.files.map((f) => h("span", { class: "mono" }, truncate(f.name || f.uri || "file", 28))))
          : null,
        m.time?.created ? h("div", { class: "msg-meta" }, fmtTime(m.time.created)) : null);
    }
    if (type !== "assistant") return null; // idle/compaction/etc. rendered by activity card

    // skip invisible assistant turns
    const textParts = (m.content || m.parts || []).filter((p) => p.type === "text" && p.text?.trim());
    const toolParts = (m.content || m.parts || []).filter((p) => p.type === "tool");
    const errText = flattenError(m.error);
    if (!textParts.length && !toolParts.length && !errText) return null;

    const children = [];
    // activity card from real tool parts (rendered before the text)
    if (toolParts.length && nextMsg) children.push(activityCard(toolParts));
    else if (toolParts.length && !nextMsg && !busy) children.push(activityCard(toolParts));

    for (const p of textParts) {
      const bubble = h("div", { class: "msg-bubble" });
      bubble.append(renderMarkdown(p.text));
      children.push(bubble);
    }
    if (errText) {
      children.push(h("div", { class: "msg-bubble", style: { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" } }, `⚠ ${errText}`));
      children.push(h("div", { class: "retry-bar" },
        h("button", { class: "btn small danger", onclick: retryLast }, "Retry"),
        h("button", { class: "btn small", onclick: () => window.__nav?.pop?.() || setTabHome() }, "New chat")));
    }

    const messageText = () => textParts.map((p) => p.text).join("\n\n");
    const meta = [];
    const mref = m.model || {};
    if (mref.providerID && mref.id) meta.push(`${mref.providerID}/${mref.id}${m.id ? "" : ""}`);
    if (m.tokens && (m.tokens.input + m.tokens.output)) meta.push(`${fmtTokens(m.tokens.input + m.tokens.output)} tok`);
    const costLabel = fmtCostSession(m.cost);
    if (costLabel) meta.push(costLabel);
    const mtext = messageText();
    if (mtext) {
      meta.push(h("span", { style: { display: "inline-flex", gap: 10, alignItems: "center" } },
        msgAction("Copy", async () => { await copyText(mtext); return true; }, copyIcon()),
        msgAction("Share", async () => { await shareText("Mobcode reply", mtext); return true; }, shareIcon()),
      ));
    }
    if (m.time?.created) meta.push(fmtTime(m.time.created));

    return h("div", { class: `msg assistant${errText ? " error" : ""}` },
      ...children,
      meta.length ? h("div", { class: "msg-meta" },
        meta.map((x, i) => h("span", {}, x, i < meta.length - 1 && typeof meta[i + 1] !== "object" ? " · " : ""))) : null,
    );
  }

  function setTabHome() { toast("Use the Home tab for a new chat"); }
  function copyIcon() {
    return h("span", { class: "msg-ma-ic" },
      h("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
        h("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" })));
  }
  function shareIcon() {
    return h("span", { class: "msg-ma-ic" },
      h("svg", { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("circle", { cx: "18", cy: "5", r: "3" }), h("circle", { cx: "6", cy: "12", r: "3" }), h("circle", { cx: "18", cy: "19", r: "3" }),
        h("path", { d: "M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" })));
  }
  function msgAction(label, fn, ic) {
    const btn = h("button", { class: "msg-ma", "aria-label": label }, ic);
    btn.onclick = async (e) => {
      e.stopPropagation();
      let ok = false;
      try { ok = await fn(); } catch {}
      if (ok) toast(`${label}d`, "ok", 1200);
    };
    return btn;
  }

  /* ---------- activity card (real tool parts) ---------- */
  function activityCard(toolParts) {
    const steps = toolParts.map((p) => {
      const meta = toolMeta(p.name);
      const status = p.state?.status || "completed";
      const detail = toolDetail(p.name, p.state?.input) ||
        (status === "streaming" || status === "running" ? extractStreamingHint(p.state?.input) : "");
      return { meta, status, detail, state: p.state, name: p.name };
    });
    const running = steps.filter((s) => s.status === "running" || s.status === "streaming");
    const failed = steps.filter((s) => s.status === "error");
    const done = steps.length - running.length - failed.length;

    let headline;
    if (running.length) headline = `${running[0].meta.label}`;
    else if (failed.length) headline = "Something went wrong";
    else if (steps.length) headline = `${lastStep(steps).meta.label}`;
    else headline = "Agent activity";

    const icons = { running: "spin", done: "check", error: "warn" };
    const card = h("div", { class: "activity-card" });
    const head = h("div", { class: "act-head", onclick: () => card.classList.toggle("open") },
      running.length
        ? h("span", { class: "act-spin" })
        : h("span", { class: actStepIcon(failed.length ? "warn" : "check"), style: { display: "inline-flex", alignItems: "center" } }, failed.length ? "⚠" : "✓"),
      h("div", { class: "act-label" }, headline,
        steps.length > 1 ? h("span", { class: "act-count" }, ` · ${steps.length} steps`) : ""),
      h("svg", { class: "act-chev", viewBox: "0 0 24 24", width: "14", height: "14", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" },
        h("path", { d: "m9 6 6 6-6 6" })));
    const stepsEl = h("div", { class: "act-steps" });
    for (const s of steps) {
      const stepEl = h("div", { class: `act-step${s.status === "error" ? " fail" : ""}`, onclick: (e) => toggleStepDetail(e, s, stepEl) },
        h("span", { class: "st-ic", style: { display: "inline-flex", alignItems: "center" } },
          s.status === "running" || s.status === "streaming" ? h("span", { class: "act-spin" }) : s.status === "error" ? "⚠" : "✓"),
        h("span", { class: "st-label" }, s.meta.label, s.detail ? h("span", { class: "path" }, `  ${s.detail}`) : ""));
      stepsEl.append(stepEl);
    }
    card.append(head, stepsEl);
    return card;
  }

  function extractStreamingHint(input) {
    if (typeof input === "string") return truncate(input, 60);
    return "";
  }
  let lastDetailOpen = null;
  function toggleStepDetail(e, s, stepEl) {
    e.stopPropagation();
    const existing = stepEl.parentElement.querySelector(".act-detail");
    if (existing) { existing.remove(); if (lastDetailOpen === stepEl) return; }
    const parts = [];
    if (s.state?.input) parts.push("input:\n" + truncate(JSON.stringify(s.state.input, null, 1), 800));
    const outp = toolOutput(s.state);
    if (outp) parts.push("output:\n" + outp);
    if (s.state?.error) parts.push("error:\n" + truncate(flattenError(s.state.error), 500));
    if (!parts.length) { parts.push("No recorded detail."); }
    stepEl.after(h("div", { class: "act-detail" }, parts.join("\n\n")));
  }
  const actStepIcon = (kind) => (kind === "check" ? "ok-ic" : "warn-ic");

  function lastStep(steps) { return steps[steps.length - 1]; }

  function flattenError(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    if (err.message) return String(err.message);
    if (err.data?.message) return String(err.data.message);
    try { return JSON.stringify(err).slice(0, 280); } catch { return String(err); }
  }
  function truncate(s, n) {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  /* ---------- data ---------- */
  async function loadSession() {
    try {
      const [sRes, mRes] = await Promise.allSettled([api.getSession(sessionID), api.listMessages(sessionID, 200)]);
      if (sRes.status === "fulfilled" && sRes.value) {
        const s = sRes.value?.data || sRes.value;
        const sc = new Map(store.state.sessionCache);
        sc.set(sessionID, s);
        store.set({ sessionCache: sc, activeSessionId: sessionID });
      }
      applyMessages(mRes);
      busy = assistantBusy();
      renderPills();
      renderMessages();
    } catch (err) {
      toast(describeError(err, "Could not open the chat"), "err");
    }
  }

  function applyMessages(mRes) {
    if (mRes.status === "fulfilled" && mRes.value) {
      const msgs = (mRes.value?.data ?? mRes.value ?? []).filter(Boolean);
      msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
      const mc = new Map(store.state.messageCache);
      mc.set(sessionID, msgs);
      store.set({ messageCache: mc });
    }
  }

  async function refreshMessages() {
    try {
      applyMessages({ status: "fulfilled", value: await api.listMessages(sessionID, 200) });
    } catch {}
    const wasBusy = busy;
    busy = assistantBusy();
    if (wasBusy !== busy) { setSendState(); renderPills(); }
    renderMessages();
  }

  function assistantBusy() {
    const msgs = store.state.messageCache.get(sessionID) || [];
    const newestAssistant = [...msgs].reverse().find((m) => (m.role || m.type) === "assistant" && !m.error);
    return Boolean(newestAssistant && !newestAssistant.time?.completed);
  }

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
    if (!document.body.contains(el)) return;
    renderPills();
  });
  el.cleanup = () => {
    unsub();
    if (window.__chatHandoff) delete window.__chatHandoff;
  };

  return el;
}
