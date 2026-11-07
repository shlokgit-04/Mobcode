/** Mobcode provider management.
 *
 * Shows providers from the connected OpenCode server (OpenCode 2+):
 *   - Provider display names            (GET /api/provider)
 *   - Model counts per provider         (derived from GET /api/model)
 *   - Integrations with server-defined  (GET /api/integration)
 *     connect methods (key / env / oauth)
 *   - Stored credentials                (GET /api/credential)
 *
 * Credentials are sent only to the OpenCode server (POST /api/integration/
 * {id}/connect/key, POST .../connect/oauth). Nothing is stored client-side
 * and there are no local-only fake auth forms.
 */
import { h, openSheet, openModal, toast } from "./ui.js";
import { store } from "./store.js";
import { refreshCatalog } from "./modelpicker.js";

/* ————— data ————— */

export async function fetchProviderData(api) {
  try {
    const [integRes, credRes] = await Promise.allSettled([
      api.integrations(),
      api.credentials(),
    ]);
    const integ = integRes.status === "fulfilled" ? integRes.value : null;
    const cred = credRes.status === "fulfilled" ? credRes.value : null;
    store.set({
      integrations: integ?.data ?? store.state.integrations ?? [],
      credentials: cred?.data ?? store.state.credentials ?? [],
    });
  } catch (err) {
    toast(err?.message || "Could not load providers", "err");
  }
}

export function providerCatalogEntry(providerID) {
  return (store.state.integrations || []).find((p) => p.id === providerID);
}

export function providerModelsCount(providerID) {
  // derived from the live catalogue, not a heavy catalog fetch
  return (store.state.models || []).filter((m) => m.providerID === providerID).length || null;
}

/* ————— connect flow (sheet) ————— */

export function openConnectProviderSheet(providerID) {
  const displayName = providerDisplayName(providerID);
  const api = window.__api;
  const methods = (store.state.integrations || []).find((x) => x.id === providerID)?.methods || [];

  const sheet = openSheet((s) => renderMethodList(s, providerID, displayName, methods));
  return sheet;

  /* summary sheet listing the server-defined methods */
  function renderMethodList(s, pid, name, mlist) {
    const head = h("div", { class: "sheet-head" },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-title-row" },
        h("span", { class: "sheet-title" }, name),
        h("span", { class: "badge mute mono" }, pid),
        h("button", { class: "sheet-close", "aria-label": "Close", onclick: s.close }, "✕")));

    const bodyEl = h("div", { class: "sheet-body", style: { padding: "0 18px 24px" } });
    const count = providerModelsCount(pid);
    bodyEl.append(h("div", { class: "hint", style: { margin: "0 0 14px" } },
      count === null
        ? "Connection method defined on the server below."
        : `${count} models will be added to the catalogue once connected.`));

    const conns = (store.state.integrations || []).find((x) => x.id === pid)?.connections || [];
    if (conns.length) {
      bodyEl.append(h("div", { class: "hint ok", style: { margin: "0 0 14px" } },
        `Already connected (${conns.length} connection${conns.length > 1 ? "s" : ""}).`));
    }

    if (!mlist.length) {
      bodyEl.append(h("div", { class: "empty-state" },
        h("div", { class: "big" }, "🔌"),
        h("div", {}, "The server does not define an interactive auth method for this provider."),
        h("div", { class: "hint", style: { marginTop: 8 } },
          "Configure it on the machine running OpenCode (auth or environment), then refresh.")));
    }
    mlist.forEach((m, i) => {
      const isEnv = m.type === "env";
      const isOauth = m.type === "oauth" || m.type === "external";
      bodyEl.append(
        h("button", { class: "row-item", onclick: () => isEnv ? renderEnvHint(s, pid, name, m) : renderMethod(s, pid, name, m, i) },
          h("div", { class: "avatar-sm" }, isEnv ? "⚙" : isOauth ? "↗" : "🔑"),
          h("div", { class: "row-main" },
            h("div", { class: "row-title" }, m.label || (isEnv ? "Environment" : isOauth ? "OAuth" : "API key")),
            isEnv
              ? h("div", { class: "row-sub" }, `Set on the server machine: ${(m.names || []).join(", ") || "—"}`)
              : isOauth
                ? h("div", { class: "row-sub" }, "Server-side flow via the OpenCode server")
                : h("div", { class: "row-sub" }, "Sent to your OpenCode server only")),
        ));
    });

    return h("div", {}, head, bodyEl);
  }

  /* env-configured provider: nothing to send from here */
  function renderEnvHint(s, pid, name, m) {
    const names = (m.names || []).join(", ") || "a server-side variable";
    s.swap(h("div", {},
      h("div", { class: "sheet-head" },
        h("div", { class: "sheet-grip" }),
        h("div", { class: "sheet-title-row" },
          h("button", {
            class: "sheet-close", "aria-label": "Back",
            onclick: () => s.swap(renderMethodList(s, pid, name, (store.state.integrations || []).find((x) => x.id === pid)?.methods || [])),
          }, "‹"),
          h("span", { class: "sheet-title" }, "Environment"),
          h("button", { class: "sheet-close", onclick: s.close }, "✕"))),
      h("div", { class: "sheet-body", style: { padding: "0 18px 24px" } },
        h("div", { class: "empty-state" },
          h("div", { class: "big" }, "⚙"),
          h("div", {}, `This provider reads ${names} from the environment of the machine running OpenCode.`),
          h("div", { class: "hint", style: { marginTop: 8 } },
            "Set the variable there (or in opencode.json), restart the server, then refresh.")))));
  }

  /* one method's flow — server-defined method rendered verbatim */
  function renderMethod(s, pid, name, m, index) {
    const isOauth = m.type === "oauth" || m.type === "external";
    const status = h("div", { class: "status-line" });
    const dynamic = h("div", {});

    async function go() {
      try {
        if (isOauth) {
          status.className = "status-line";
          status.replaceChildren(h("span", { class: "spin" }), " Requesting authorization from the server…");
          const res = await api.connectOauth(pid, m.id ?? String(index));
          renderOauthSteps(res, m);
        } else {
          renderKeyForm();
        }
      } catch (err) {
        status.className = "status-line err";
        status.textContent = err?.message || "Could not start this flow";
      }
    }

    function renderKeyForm() {
      dynamic.replaceChildren();
      dynamic.append(
        h("div", { style: { padding: "14px 18px 24px" } },
          h("div", { class: "hint", style: { marginBottom: 10 } },
            `The key goes to your OpenCode server only (POST /api/integration/${pid}/connect/key). Mobcode never keeps or shows it afterwards.`),
          h("label", { class: "field" },
            h("span", { class: "field-label" }, m.label || "API key"),
            h("input", { class: "input", type: "password", placeholder: "key…", id: "api-key-input", autocomplete: "off" })),
          h("button", { class: "btn primary block", id: "connect-key-btn", onclick: connectKey }, "Connect"),
          status));
    }

    async function connectKey(e) {
      const key = document.getElementById("api-key-input").value.trim();
      if (!key) { status.className = "status-line err"; status.textContent = "Enter the key."; return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      status.className = "status-line";
      status.replaceChildren(h("span", { class: "spin" }), " Saving on the OpenCode server…");
      try {
        await api.connectKey(pid, key);
        await finishConnect();
      } catch (err) {
        status.className = "status-line err";
        status.textContent = err?.message || "Server rejected the key";
        btn.disabled = false;
      }
    }

    function renderOauthSteps(res, m) {
      /* res.data: { attemptID, url, instructions, mode: "auto" | "code" } */
      const a = res?.data ?? res;
      status.replaceChildren();
      dynamic.replaceChildren();
      const steps = h("div", { style: { padding: "0 0 14px" }, class: "oauth-steps" });
      if (a?.instructions) steps.append(h("p", { class: "hint", style: { margin: "6px 0 12px" } }, a.instructions));
      if (a?.url) {
        steps.append(
          h("a", { class: "btn primary block", href: a.url, target: "_blank", rel: "noopener" },
            "Open provider authorization ↗"));
      }

      if (a?.mode === "code") {
        steps.append(h("p", { class: "hint", style: { margin: "12px 0 6px" } }, "If the provider issued a verification code, paste it below."));
        steps.append(h("label", { class: "field" },
          h("input", { class: "input", id: "oauth-code", placeholder: "paste code", autocomplete: "off" })));
        steps.append(h("button", {
          class: "btn primary block",
          onclick: async (e) => {
            const code = document.getElementById("oauth-code").value.trim();
            if (!code) { status.className = "status-line err"; status.textContent = "Enter the provider's code."; return; }
            const b = e.currentTarget; b.disabled = true;
            status.className = "status-line";
            status.replaceChildren(h("span", { class: "spin" }), " Completing with the server…");
            try {
              await api.oauthComplete(pid, a.attemptID, code);
              await finishConnect();
            } catch (err) {
              status.className = "status-line err";
              status.textContent = err?.message || "The server rejected the code";
              b.disabled = false;
            }
          },
        }, "Finish connect"));
        dynamic.append(steps);
      } else {
        steps.append(h("p", { class: "hint", style: { margin: "10px 0" } },
          "The OpenCode server completes this automatically when the provider calls back. If nothing happens, finish in your browser then verify."));
        steps.append(h("button", {
          class: "btn block",
          onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            status.className = "status-line";
            status.replaceChildren(h("span", { class: "spin" }), " Verifying connection…");
            const ok = await pollConnected(pid, api);
            if (ok) await finishConnect();
            else {
              status.className = "status-line err";
              status.textContent = "Not connected yet — complete the flow, then verify again.";
              b.disabled = false;
            }
          },
        }, "I've authorized — verify"));
        dynamic.append(steps);
      }
    }

    async function finishConnect() {
      status.className = "status-line ok";
      status.textContent = `Connected to ${name}. Refreshing catalogue…`;
      await refreshCatalog(true);
      await fetchProviderData(window.__api);
      window.__refreshProviders?.();
      toast(`${name} connected`, "ok");
      setTimeout(() => s.close(), 650);
    }

    const head = h("div", { class: "sheet-head" },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-title-row" },
        h("button", {
          class: "sheet-close", "aria-label": "Back",
          onclick: () => s.swap(renderMethodList(s, pid, name, (store.state.integrations || []).find((x) => x.id === pid)?.methods || [])),
        }, "‹"),
        h("span", { class: "sheet-title" }, m.label || (isOauth ? "OAuth" : "API key")),
        h("button", { class: "sheet-close", onclick: s.close }, "✕")));

    const bodyEl = h("div", { class: "sheet-body", style: { padding: "0 18px 24px" } });
    bodyEl.append(dynamic, status);

    go(); // key form or oauth attempt: render immediately
    s.swap(h("div", {}, head, bodyEl));
  }
}

export function providerDisplayName(providerID) {
  const st = store.state;
  const integ = (st.integrations || []).find((p) => p.id === providerID);
  if (integ?.name) return integ.name;
  const p = (st.providers || []).find((x) => x.id === providerID);
  if (p?.name) return p.name;
  return providerID;
}

/** Load MCP servers (GET /api/mcp) into the store for the MCP sheet and status dots. */
export async function fetchMcpServers(api) {
  try {
    const res = await api.mcp();
    const servers = res?.data ?? res?.servers ?? [];
    store.set({ mcpServers: Array.isArray(servers) ? servers : [] });
  } catch {
    /* keep the last known list — the sheet shows a real error there if needed */
    if (!Array.isArray(store.state.mcpServers)) store.set({ mcpServers: [] });
  }
}

async function pollConnected(providerID, api, tries = 24) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await api.credentials();
      const creds = res?.data ?? [];
      if (creds.some((c) => c.integrationID === providerID)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

export function confirmDisconnect(providerID) {
  const displayName = providerDisplayName(providerID);
  openModal({
    title: `Disconnect ${displayName}?`,
    body: h("p", {}, "The OpenCode server will remove the stored credentials for this provider. Its models disappear from the catalogue automatically."),
    actions: [
      { label: "Cancel" },
      {
        label: "Disconnect", class: "btn danger",
        onClick: async (_e, close) => {
          try {
            const creds = ((await window.__api.credentials())?.data ?? [])
              .filter((c) => c.integrationID === providerID);
            for (const c of creds) {
              try { await window.__api.deleteCredential(c.id); } catch {}
            }
            await Promise.all([
              refreshCatalog(true),
              fetchProviderData(window.__api),
            ]);
            window.__refreshProviders?.();
            toast(`${displayName} disconnected`, "ok");
          } catch (err) {
            toast(err?.message || "Failed to disconnect", "err");
          }
          close();
        },
      },
    ],
  });
}
