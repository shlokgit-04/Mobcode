/** Mobcode views: Connect (dev only) + shared session creation. */
import { h, toast } from "./ui.js";
import { store } from "./store.js";
import { describeError, OpenCodeError } from "./api.js";
import { isNative, urlIsAllowed, probeConnection, saveConnection, loadConnection, haptic } from "./native.js";
import { PRODUCTION_API_BASE_URL, ALLOW_DEV_SERVER_OVERRIDE } from "./config.js";
import { MOBCODE_VERSION } from "./config.js";

/** Create a session (optionally with model ref and location/directory). */
export async function createSessionWithModel(modelRef, location) {
  try {
    const agent = store.state.agentsChoice || "build";
    const body = { agent };
    if (modelRef) body.model = modelRef;
    if (location?.directory) body.location = { directory: location.directory };
    const res = await window.__api.createSession(body);
    const session = res?.data || res;
    const sc = new Map(store.state.sessionCache);
    sc.set(session.id, session);
    const mc = new Map(store.state.messageCache);
    mc.set(session.id, []);
    store.set({
      sessionCache: sc, messageCache: mc,
      pendingModel: modelRef || store.state.pendingModel,
      sessions: [session, ...store.state.sessions],
    });
    toast(`New chat on ${modelRef ? modelRef.id : "default model"}`, "ok");
    window.__nav.renderChat(session.id);
    return session;
  } catch (err) {
    toast(describeError(err, "Could not create the chat"), "err", 4200);
    throw err;
  }
}

/* ————————————————— connect (developer override screen) ————————————————— */

export function ConnectView() {
  const st = store.state;
  const nativeMode = isNative();
  const isDev = ALLOW_DEV_SERVER_OVERRIDE;
  let testing = false;

  const status = h("div", { class: "status-line" });

  function showStatus(kind, text) {
    status.className = `status-line ${kind}`;
    status.replaceChildren(text);
  }

  async function trySave() {
    if (testing) return;
    const url = urlInput.value.trim();
    if (!url) return showStatus("err", "Enter the Mobcode backend URL.");
    testing = true;
    status.className = "status-line";
    status.replaceChildren(h("span", { class: "spin" }), " Connecting…");
    try {
      if (nativeMode) {
        const check = urlIsAllowed(url);
        if (!check.ok) throw new OpenCodeError(check.error, 0);
        const base = String(check.url).replace(/\/+$/, "");
        const password = pwInput.value.trim();
        const probed = await probeConnection(base, password);
        if (!probed.ok) throw new OpenCodeError(probed.error || "Could not reach the server", 0);
        localStorage.setItem("mobcode.dev-url", base);
        await saveConnection({ url: base, password, kind: probed.kind, directory: dirInput.value.trim() });
        store.set({ directory: dirInput.value.trim(), password, target: base });
        showStatus("ok", "Connected. Loading…");
        await window.__boot?.();
        window.__nav?.home();
        return;
      }
      if (st.host.companion) {
        await window.__api.saveHostConfig({ open: url, directory: dirInput.value.trim(), password: pwInput.value.trim() || "" });
      } else {
        localStorage.setItem("mobcode.target", base(url));
        store.set({ target: base(url), password: "" });
      }
      showStatus("ok", "Connected. Preparing…");
      await window.__boot?.();
      window.__nav?.home();
    } catch (err) {
      showStatus("err", describeError(err, "Connection failed"));
    }
    testing = false;
  }
  const base = (u) => u.replace(/\/+$/, "");

  const urlInput = h("input", {
    class: "input", value: st.target || "",
    placeholder: "https://your-mobcode-backend.onrender.com",
    autocomplete: "url", spellcheck: "false", inputmode: "url",
  });
  const pwInput = h("input", { class: "input", type: "password", placeholder: st.host.hasPassword ? "(already configured on host)" : "only if the backend requires it", autocomplete: "off" });
  const dirInput = h("input", { class: "input", value: st.directory, placeholder: "empty = server default", spellcheck: "false" });

  const productionNote = PRODUCTION_API_BASE_URL
    ? h("div", { class: "hint", style: { margin: "12px 4px", textAlign: "center" } },
        h("span", { class: "badge ok", style: { marginRight: 8 } }, "production"),
        "This build auto-connects to the managed Mobcode server.")
    : null;

  return h("div", { class: "container view-pad fade-in" },
    h("div", { class: "connect-logo" },
      h("div", { class: "mark" },
        h("svg", { width: 30, height: 30, viewBox: "0 0 24 24" },
          h("path", { d: "M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9.5L5.5 21v-3.5h-1A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5z", fill: "#fff", fillOpacity: "0.92" }),
          h("path", { d: "m8 12 2-2M8 14l2 2M15 10h1.5M13 14h3.5", stroke: "#fff", "stroke-width": 1.4, "stroke-linecap": "round", opacity: "0.9" }))),
      h("h1", {}, "Mobcode"),
      h("p", {}, "Your code. Your agent. Anywhere.")),
    productionNote,
    isDev ? h("div", { class: "card", style: { padding: "16px 14px" } },
      h("div", { class: "hint", style: { margin: "0 0 12px" } },
        h("span", { class: "badge accent", style: { marginRight: 6 } }, "dev"),
        "Developer backend override. Point Mobcode at your own deployed backend to test."),
      h("div", { class: "field" },
        h("span", { class: "field-label" }, "Mobcode backend URL"),
        urlInput),
      h("div", { class: "field" },
        h("span", { class: "field-label" }, "Server password (optional)"),
        pwInput),
      h("div", { class: "field" },
        h("span", { class: "field-label" }, "Workspace directory"),
        dirInput,
        h("div", { class: "hint" }, "Scopes models & chats. Usually leave empty for the server's default.")),
      h("button", { class: "btn primary block", onclick: trySave }, "Connect"),
      status) : h("div", { class: "empty-state" },
        h("div", { class: "big" }, "⚠"),
        h("div", {}, "This build has no configured server and no override enabled.",
        h("div", { class: "hint" }, `Mobcode ${MOBCODE_VERSION} — rebuild with the production URL.`))),
  );
}
