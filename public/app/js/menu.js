/**
 * Mobcode secondary menu — advanced areas one tap away, not on the home screen.
 *  - Integrations: preserved provider management (providers.js flows)
 *  - MCP:        real GET /api/mcp servers + connect/disconnect actions
 *  - Workspace:  default directory scope
 *  - Appearance: dark (default) / light
 *  - Connection: developer-only backend override (native + override builds only)
 *  - About:      version + honest capability notes
 */
import { h, toast, openSheet, openModal } from "./ui.js";
import { store } from "./store.js";
import { describeError } from "./api.js";
import { openConnectProviderSheet, confirmDisconnect, providerDisplayName, providerModelsCount, fetchMcpServers } from "./providers.js";
import { openModelPicker } from "./modelpicker.js";
import { isNative, loadConnection, saveConnection, urlIsAllowed } from "./native.js";
import { MOBCODE_VERSION, ALLOW_DEV_SERVER_OVERRIDE, PRODUCTION_API_BASE_URL } from "./config.js";

/** The profile-menu bottom sheet. */
export function openMenuSheet() {
  openSheet((s) => {
    const body = h("div", { class: "sheet-body", style: { padding: "0 16px 26px" } });

    const items = [
      { ic: ic("🔌"), title: "Integrations & providers", sub: "Connect AI providers — keys stay on your server", go: integrationsSheet },
      { ic: ic("⚡"), title: "MCP connections", sub: "Extra tools the agent can use", go: mcpSheet },
      { ic: ic("📁"), title: "Workspace", sub: "Default directory & project scope", go: workspaceSheet },
      { ic: ic("🎨"), title: "Appearance", sub: "Dark is default; light available", go: themeSheet },
    ];
    if (isNative() && ALLOW_DEV_SERVER_OVERRIDE) {
      items.push({ ic: ic("🔗"), title: "Backend connection", sub: "Server URL, password, workspace", go: connectionSheet });
    }
    items.push({ ic: ic("ⓘ"), title: "About Mobcode", sub: `v${MOBCODE_VERSION}`, go: aboutSheet });

    for (const it of items) {
      body.append(h("button", { class: "row-item", onclick: () => { s.close(); setTimeout(it.go, 140); } },
        it.ic,
        h("div", { class: "row-main" },
          h("div", { class: "row-title" }, it.title),
          h("div", { class: "row-sub" }, it.sub))));
    }

    return sheetShell(s, "Mobcode", body);
  });
}

function sheetShell(s, title, body) {
  return h("div", {},
    h("div", { class: "sheet-head" },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-title-row" },
        h("span", { class: "sheet-title" }, title),
        h("button", { class: "sheet-close", "aria-label": "Close", onclick: s.close }, "✕"))),
    body);
}

/* ————————————————— integrations (preserved provider flows) ————————————————— */

export function integrationsSheet() {
  openSheet((s) => {
    const connectedHolder = h("div", {});
    const availHolder = h("div", {});
    const search = { q: "" };
    const searchInput = h("input", {
      class: "input", placeholder: "Search providers…", autocomplete: "off",
      oninput: (e) => { search.q = e.target.value.toLowerCase(); renderAvailable(); },
    });

    function connectedCards() {
      const ids = store.state.connectedProviderIds || [];
      if (!ids.length) {
        return [h("div", { class: "hint", style: { padding: "8px 4px" } },
          "No providers connected yet — connect one below and its models appear automatically.")];
      }
      return ids.map((pid) => h("div", { class: "card prov-card" },
        h("div", { class: "prov-head" },
          h("span", { class: "mg-dot", style: { background: "var(--ok)" } }),
          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", { class: "prov-name" }, providerDisplayName(pid)),
            h("div", { class: "prov-id mono" }, pid)),
          h("span", { class: "badge ok" }, "Connected")),
        h("div", { class: "prov-actions" },
          h("button", { class: "btn small", onclick: () => { s.close(); setTimeout(() => openModelPicker({ mode: "newchat", onNewChat: window.__onModelForNewChat }), 160); } }, "Browse models"),
          h("button", { class: "btn small danger", onclick: () => confirmDisconnect(pid) }, "Disconnect"))));
    }

    function renderAvailable() {
      availHolder.replaceChildren();
      let entries = (store.state.integrations || []).slice()
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      if (search.q) entries = entries.filter((p) => (p.name || "").toLowerCase().includes(search.q) || (p.id || "").toLowerCase().includes(search.q));
      if (!entries.length) {
        availHolder.append(h("div", { class: "empty-state", style: { padding: "20px" } },
          search.q ? "No matching providers." : "Server catalog is empty."));
        return;
      }
      for (const p of entries) {
        const connected = (store.state.connectedProviderIds || []).includes(p.id) || (p.connections || []).length > 0;
        const count = providerModelsCount(p.id);
        const methods = p.methods || [];
        const mFlags = [
          methods.some((m) => m.type === "oauth" || m.type === "external") ? "OAuth" : null,
          methods.some((m) => m.type === "key") ? "Key" : null,
          methods.some((m) => m.type === "env") ? "Env" : null,
        ].filter(Boolean).slice(0, 2).join(" · ");
        availHolder.append(h("button", {
          class: "connect-row", style: { opacity: connected ? 0.75 : 1 },
          onclick: () => { s.close(); setTimeout(() => openConnectProviderSheet(p.id), 160); },
        },
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, p.name || p.id, connected ? h("span", { class: "badge ok", style: { fontSize: 9, marginLeft: 8 } }, "connected") : null),
            h("div", { class: "row-sub mono" }, p.id),
            mFlags ? h("div", { class: "row-sub" }, mFlags) : null),
          count !== null ? h("span", { class: "badge mute" }, `${count} models`) : null));
      }
    }

    function renderAll() {
      connectedHolder.replaceChildren(...connectedCards());
      renderAvailable();
    }

    const body = h("div", { class: "sheet-body", style: { padding: "0 16px 26px" } },
      h("div", { style: { marginTop: 4 } }, connectedHolder),
      h("div", { class: "section-title" }, "All providers"),
      h("div", { class: "field" }, searchInput),
      availHolder,
      h("div", { class: "hint", style: { margin: "10px 2px" } },
        "Authentication runs through your OpenCode server's own flows. Keys and tokens are stored server-side, never in Mobcode."));

    renderAll();
    const unsub = store.subscribe(() => { if (!document.body.contains(body)) return; renderAll(); });
    const root = sheetShell(s, "Integrations", body);
    const origClose = s.close;
    // ensure the store subscription is released when the sheet closes
    s.close = () => { unsub(); origClose(); };
    return root;
  });
}

/* ————————————————— MCP (real /api/mcp) ————————————————— */

export function mcpSheet() {
  openSheet((s) => {
    const bodyEl = h("div", { class: "sheet-body", style: { padding: "0 16px 26px" } });
    bodyEl.append(h("div", { class: "loading" }, h("span", { class: "spin" }), "Reading MCP servers…"));

    async function render() {
      try { await fetchMcpServers(window.__api); } catch {}
      const servers = store.state.mcpServers || [];
      bodyEl.replaceChildren();
      bodyEl.append(h("div", { class: "hint", style: { margin: "2px 2px 14px" } },
        "MCP servers are defined in the OpenCode server's configuration (mcp section). They give the agent extra tools."));
      if (!servers.length) {
        bodyEl.append(h("div", { class: "empty-state" }, "No MCP servers configured.",
          h("div", { class: "hint", style: { marginTop: 8 } }, "Add them in opencode.json on the server, then refresh here.")));
        return;
      }
      for (const srv of servers) {
        const enabled = srv.enabled !== false;
        const connected = srv.state === "connected";
        bodyEl.append(h("div", { class: "card prov-card" },
          h("div", { class: "prov-head" },
            h("span", { class: "mg-dot", style: { background: connected ? "var(--ok)" : "var(--text-mute)" } }),
            h("div", { style: { flex: 1, minWidth: 0 } },
              h("div", { class: "prov-name" }, srv.name || srv.id || "server"),
              h("div", { class: "prov-id mono" }, srv.id || "")),
            h("span", { class: `badge ${connected ? "ok" : "mute"}` }, connected ? "connected" : (enabled ? "available" : "disabled"))),
          h("div", { class: "hint" }, describeMcp(srv)),
          h("div", { class: "prov-actions" },
            h("button", {
              class: "btn small", onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await window.__api.post(`/api/experimental/mcp/${encodeURIComponent(srv.id)}/connect`);
                  await fetchMcpServers(window.__api);
                  toast("MCP connected", "ok");
                } catch (err) { toast(describeError(err, "Connect failed"), "err"); }
                render();
              },
            }, "Connect"),
            h("button", {
              class: "btn small danger", onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await window.__api.post(`/api/experimental/mcp/${encodeURIComponent(srv.id)}/disconnect`);
                  await fetchMcpServers(window.__api);
                  toast("MCP disconnected", "ok");
                } catch (err) { toast(describeError(err, "Disconnect failed"), "err"); }
                render();
              },
            }, "Disconnect"))));
      }
    }
    render();
    return sheetShell(s, "MCP connections", bodyEl);
  });
}
function describeMcp(srv) {
  const t = srv?.config?.type || srv?.type || "";
  const c = srv?.config?.command ? `runs "${srv.config.command}"` : "";
  return (srv?.description || c || (t ? `type ${t}` : "Model-context server")).toString();
}

/* ————————————————— workspace ————————————————— */

export function workspaceSheet() {
  openSheet((s) => {
    const st = store.state;
    const dirInput = h("input", { class: "input", value: st.directory || st.host?.directory || "", placeholder: "empty = server default", spellcheck: "false" });
    const line = h("div", { class: "status-line" });
    return sheetShell(s, "Workspace",
      h("div", { class: "sheet-body", style: { padding: "0 16px 26px" } },
        h("div", { class: "hint", style: { margin: "0 2px 14px" } },
          "The directory the agent operates on. It scopes models, chats and file access. Leave empty for the server default."),
        h("div", { class: "field" },
          h("span", { class: "field-label" }, "Default directory"),
          dirInput),
        h("button", {
          class: "btn primary block", onclick: async () => {
            const dir = dirInput.value.trim();
            store.set({ directory: dir });
            store.persistPrefs?.();
            line.className = "status-line";
            line.replaceChildren(h("span", { class: "spin" }), " Saving…");
            try {
              if (st.host?.companion) await window.__api.saveHostConfig({ open: null, directory: dir, password: "" });
              await window.__refreshAll?.(true);
              line.className = "status-line ok";
              line.textContent = "Saved.";
              setTimeout(() => s.close?.(), 500);
            } catch (err) {
              line.className = "status-line err";
              line.textContent = describeError(err, "Save failed");
            }
          },
        }, "Save"),
        line,
        h("div", { class: "hint", style: { marginTop: 12 } },
          PRODUCTION_API_BASE_URL && isNative()
            ? "Production backend: this scopes your session on the managed server."
            : "Changes refresh the model catalogue and project list.")));
  });
}

/* ————————————————— theme ————————————————— */

export function themeSheet() {
  return openSheet((s) => {
    const pick = (t) => {
      store.setTheme(t);
      setTimeout(() => s.close?.(), 260);
    };
    return sheetShell(s, "Appearance",
      h("div", { class: "sheet-body", style: { padding: "0 16px 26px" } },
        h("button", { class: "row-item", onclick: () => pick("dark") },
          h("div", { class: "avatar-sm" }, "🌙"),
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, "Dark"),
            h("div", { class: "row-sub" }, "Deep navy — recommended")),
          store.state.theme === "dark" ? h("span", { class: "badge accent" }, "Active") : null),
        h("button", { class: "row-item", onclick: () => pick("light") },
          h("div", { class: "avatar-sm" }, "☀"),
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, "Light"),
            h("div", { class: "row-sub" }, "Bright and clean")),
          store.state.theme === "light" ? h("span", { class: "badge accent" }, "Active") : null)));
  });
}

/* ————————————————— connection (dev builds only) ————————————————— */

async function connectionSheet() {
  const cfg = (await loadConnection()) || { url: "", password: "", kind: "companion", directory: store.state.directory };
  openModal({
    title: "Mobcode backend connection",
    body: h("div", {},
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Server URL"),
        h("input", { class: "input", id: "cn-url", value: cfg.url || "", placeholder: "https://your-mobcode-backend.onrender.com", inputmode: "url" })),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Password (optional)"),
        h("input", { class: "input", id: "cn-pw", type: "password", placeholder: cfg.password ? "(keep current)" : "empty", autocomplete: "off" })),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Workspace directory"),
        h("input", { class: "input", id: "cn-dir", value: cfg.directory || store.state.directory || "", placeholder: "empty = server default" })),
      h("div", { class: "status-line", id: "cn-line" })),
    actions: [
      { label: "Cancel" },
      {
        label: "Verify & save", class: "btn primary",
        onClick: async (_e, close) => {
          const url = document.getElementById("cn-url").value.trim();
          if (!url) { document.getElementById("cn-line").replaceChildren("Enter the URL."); return; }
          const ok = urlIsAllowed(url);
          if (!ok.ok) { document.getElementById("cn-line").replaceChildren(ok.error); return; }
          await saveConnection({ url: String(ok.url).replace(/\/+$/, ""), password: document.getElementById("cn-pw").value.trim() || cfg.password || "", kind: cfg.kind, directory: document.getElementById("cn-dir").value.trim() });
          close();
          toast("Connection saved — reconnecting", "ok");
          store.set({ connected: false });
          setTimeout(() => window.__boot?.(), 250);
        },
      },
    ],
  });
}

/* ————————————————— about ————————————————— */

export function aboutSheet() {
  openModal({
    title: `Mobcode ${MOBCODE_VERSION}`,
    body: h("div", {},
      h("p", {},
        "Mobile client for the OpenCode agent. Mobcode speaks only to your OpenCode server — it never calls AI providers directly and never stores API keys."),
      h("p", { class: "hint" },
        "Models, providers and MCP come from the connected engine in real time — the app shows real data or real errors, never fakes."),
      h("p", { class: "hint" },
        isNative()
          ? "Android · Capacitor 8 · connection credentials live in an encrypted native store"
          : "Progressive web app · installable from your browser menu")),
    actions: [{ label: "Close" }],
  });
}

/* ————————————————— icons ————————————————— */

/** Small rounded glyph used in menu rows. */
function ic(glyph) {
  return h("div", { class: "avatar-sm" },
    h("span", { class: "act-ic", style: { display: "inline-flex" }, "aria-hidden": "true" }, glyph));
}
