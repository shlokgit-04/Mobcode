/** Mobcode model picker — the dynamic catalogue UI.
 *
 * Data comes live from the connected OpenCode server:
 *   GET /api/model         -> the complete catalogue (grouped client-side by provider)
 *   GET /api/provider      -> provider display names
 *   GET /api/model/default -> global default model (when configured server-side)
 *
 * Hardcoded lists: none. Unavailable (enabled:false) models are displayed in a
 * muted section but never selectable. Pricing, context, capability, variant
 * metadata come only from the actual API payload.
 */
import { h, openSheet, sheetHeader, debounce, toast } from "./ui.js";
import { store } from "./store.js";
import {
  fmtContext, pricingLabel, capabilityChips, statusBadge, providersFromModels, matchesQuery,
} from "./format.js";

/* refresh catalogue + provider info (also used by main SSE/poll refresh).
 * On OpenCode 2+ everything is small: /api/model (catalogue), /api/provider
 * (configured providers) and /api/model/default (global default model). */
export async function refreshCatalog(force = false) {
  if (!force && store.state.models) return;
  const api = window.__api;
  api.configure({ baseURL: store.state.target, password: store.state.password, directory: store.state.directory });
  api.authMode = store.state.authMode || api.authMode;

  let models = null;
  try {
    const res = await api.listModels();
    models = Array.isArray(res) ? res : res?.data ?? [];
  } catch {}
  if (!models) {
    toast("Could not refresh the model catalogue", "err");
    if (!store.state.models) store.set({ models: [] });
  } else {
    store.set({ models });
  }

  try {
    const [provRes, defRes] = await Promise.allSettled([
      api.listProviders(),
      api.modelDefault(),
    ]);
    const prov = provRes.status === "fulfilled" ? provRes.value : null;
    const def = defRes.status === "fulfilled" ? defRes.value : null;
    const providers = (Array.isArray(prov) ? prov : prov?.data) ?? [];
    const defaultModel = def && !Array.isArray(def) ? (def?.data ?? def) : null;
    const patch = { providers };
    if (defaultModel?.providerID && defaultModel.id) {
      patch.globalDefaultModel = defaultModel.variant
        ? `${defaultModel.providerID}/${defaultModel.id}@${defaultModel.variant}`
        : `${defaultModel.providerID}/${defaultModel.id}`;
    }
    // "connected" = configured providers that currently expose enabled models
    const withModels = new Set((store.state.models || [])
      .filter((m) => m.enabled !== false)
      .map((m) => m.providerID));
    patch.connectedProviderIds = providers.filter((p) => withModels.has(p.id)).map((p) => p.id);
    store.set(patch);
  } catch {}
}

export function providerName(pid) {
  const st = store.state;
  const p = (st.providers || []).find((x) => x.id === pid);
  if (p?.name) return p.name;
  return pid;
}

function isProviderDefaultModel() {
  return null; // OpenCode 2 exposes only a global default model
}

function isGlobalDefault(m, st) {
  const g = st.globalDefaultModel;
  if (!g || !g.includes("/")) return null;
  const [pid, mid] = g.split("/");
  return pid === m.providerID && mid === m.id ? "App default" : null;
}

/** Open the picker. mode: "session" (switch live) or "newchat". */
export function openModelPicker({ mode, sessionID = null, onNewChat } = {}) {
  let openToken = ++openCounter;
  const doOpen = () => {
    if (openToken !== openCounter) return; // superseded by newer open
    const st0 = store.state;
    if (!st0.models) {
      toast("Loading models…");
      refreshCatalog().finally(() => {
        if (openToken === openCounter) actuallyOpen();
      });
    } else {
      actuallyOpen();
    }
  };
  const actuallyOpen = () => openSheet((sheetApi) => build(sheetApi, { mode, sessionID, onNewChat }));
  doOpen();
}
let openCounter = 0;

/* ————————————————————————————————— sheet build ————————————————————————————————— */

function build(sheetApi, { mode, sessionID, onNewChat }) {
  const api = window.__api;
  const current = sessionID ? store.state.sessionCache.get(sessionID)?.model || null : null;

  const state = {
    query: "",
    filter: null,
    selected: null, // ModelMeta chosen (full model info)
  };

  const countEl = h("span", { class: "sheet-count" }, "");
  const searchInput = h("input", {
    class: "input", type: "search", placeholder: "Search models…",
    autocomplete: "off", spellcheck: "false",
    oninput: debounce((e) => { state.query = e.target.value.trim(); render(); }, 120),
  });
  const searchClear = h("button", {
    class: "search-clear", "aria-label": "Clear", hidden: true,
    onclick: () => { state.query = ""; searchInput.value = ""; searchClear.hidden = true; render(); },
  }, "✕");
  const chipsEl = h("div", { class: "chips" });
  const listEl = h("div", {});
  const foot = h("div", { class: "sheet-foot" });

  const searchIcon = h("span", { class: "search-icon" },
    h("svg", { viewBox: "0 0 24 24", width: 16, height: 16 },
      h("circle", { cx: 11, cy: 11, r: 6.5, fill: "none", stroke: "currentColor", "stroke-width": 2 }),
      h("path", { d: "m16 16 4.5 4.5", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" })));

  const body = h("div", { class: "sheet-body" },
    h("div", { class: "search-wrap", style: { margin: "0 18px 10px" } }, searchIcon, searchInput, searchClear),
    chipsEl,
    listEl,
  );

  const root = h("div", {},
    h("div", { class: "sheet-head" },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-title-row" },
        h("span", { class: "sheet-title" }, mode === "session" ? "Change model" : "Models"),
        countEl,
        h("button", { class: "sheet-close", "aria-label": "Close", onclick: sheetApi.close },
          h("span", { style: { fontSize: "16px", lineHeight: 1 } }, "✕"))),
    ),
    body,
    foot,
  );

  /* ————— picking ————— */

  function chosenVariant(m) {
    return store.state.variantChoice[variantKey(m)];
  }
  function variantKey(m) {
    return `${m.providerID}/${m.id}`.toLowerCase();
  }

  function choose(m, variant) {
    if (variant !== undefined) store.setVariantChoice(variantKey(m), variant);
    state.selected = m;
    render();
  }

  /* ————— confirmation bar ————— */

  function renderFoot() {
    if (!state.selected) {
      foot.replaceChildren(
        h("div", { style: { flex: 1, color: "var(--text-mute)", fontSize: "13px", padding: "6px 2px" } },
          mode === "session"
            ? "Select a model to switch this chat."
            : "Select a model to start a new chat."),
      );
      return;
    }
    const m = state.selected;
    const variant = chosenVariant(m);
    const ref = { providerID: m.providerID, id: m.id };
    if (variant) ref.variant = variant;

    const label = h("div", { style: { minWidth: 0, flex: "0 0 auto", maxWidth: "38%" } },
      h("div", { class: "row-title", style: { whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" } }, m.name || m.id),
      h("div", { class: "row-sub mono" }, `${m.providerID}/${m.id}${variant ? ` · ${variant}` : ""}`),
    );

    if (mode === "session" && sessionID) {
      foot.replaceChildren(
        label,
        h("button", {
          class: "btn primary", style: { flex: "1" }, id: "confirm-btn",
          onclick: () => switchTo(sessionID, ref),
        }, "Switch model"),
      );
    } else {
      foot.replaceChildren(
        label,
        h("button", { class: "btn primary", style: { flex: 1 }, id: "confirm-btn", onclick: () => startChat(ref) }, "New chat"),
      );
    }
  }

  async function switchTo(sessionID, ref) {
    const btn = foot.querySelector("#confirm-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Switching…"; }
    try {
      await api.switchModel(sessionID, ref);
      // optimistic update — SSE event confirms (session.model.selected)
      const cached = store.state.sessionCache.get(sessionID);
      if (cached) {
        const sc = new Map(store.state.sessionCache);
        sc.set(sessionID, { ...cached, model: ref });
        store.set({ sessionCache: sc, pendingModel: ref });
      }
      store.rememberModel({ ...ref }, modelDisplayName(mForRef(ref)));
      toast(`Model switched to ${modelDisplayName(ref)}`, "ok");
      sheetApi.close();
    } catch (err) {
      toast(err?.message || "Failed to switch model", "err", 4200);
      if (btn) { btn.disabled = false; btn.textContent = "Switch model"; }
    }
  }

  function mForRef(ref) {
    return (store.state.models || []).find((m) => m.providerID === ref.providerID && m.id === ref.id);
  }

  function modelDisplayName(ref) {
    const m = mForRef(ref);
    const base = m?.name || ref.id;
    return ref.variant ? `${base} (${ref.variant})` : base;
  }

  async function startChat(ref) {
    const btn = foot.querySelector("#confirm-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
    try {
      store.rememberModel({ ...ref }, modelDisplayName(ref));
      if (onNewChat) await onNewChat(ref);
      sheetApi.close();
    } catch (err) {
      toast(err?.message || "Could not start chat", "err", 4200);
      if (btn) { btn.disabled = false; btn.textContent = "New chat"; }
    }
  }

  /* ————— rendering ————— */

  function renderCount(visible, total) {
    countEl.textContent = state.query || state.filter ? `${visible} of ${total}` : `${total} models`;
  }

  function renderChips(models) {
    const provs = providersFromModels(models);
    chipsEl.replaceChildren(
      h("button", { class: `chip ${state.filter ? "" : "active"}`, onclick: () => { state.filter = null; render(); } }, "All"),
      ...provs.map((p) => h("button", {
        class: `chip ${state.filter === p.id ? "active" : ""}`,
        onclick: () => { state.filter = state.filter === p.id ? null : p.id; render(); },
      }, providerName(p.id),
        h("span", { style: { opacity: 0.55 } }, p.count))),
    );
  }

  function hashColor(s) {
    let x = 0;
    for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) & 0x7fffffff;
    const hues = [262, 172, 200, 340, 285, 42, 152, 205, 320, 12];
    return `hsl(${hues[x % hues.length]} 65% 58%)`;
  }

  function modelRow(m) {
    const baseIsCurrent =
      current?.providerID === m.providerID && current?.id === m.id;
    const currentVariantNorm = baseIsCurrent ? current.variant || null : null;
    const chosen = chosenVariant(m) ?? null; // null means "Default"
    const isExactCurrent = baseIsCurrent && currentVariantNorm === chosen;
    const price = pricingLabel(m);
    const ctx = fmtContext(m.limit?.context);
    const ctxOut = m.limit?.output ? ` · ${fmtContext(m.limit.output)}` : "";
    const caps = capabilityChips(m);
    const badge = statusBadge(m);
    const def = isGlobalDefault(m, store.state) || isProviderDefaultModel(m, store.state);    const isSelected = state.selected?.id === m.id && state.selected?.providerID === m.providerID;

    return h("div", {
      class: `model-row ${isSelected ? "selected" : ""}`,
      role: "button", tabindex: "0",
      onclick: () => choose(m),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(m); } },
    },
      h("div", { class: "mr-main" },
        h("div", { class: "mr-name" },
          h("span", { class: "nm" }, m.name || m.id),
          price ? h("span", { class: `badge ${price.kind === "free" ? "free" : "paid"}` }, price.label) : null,
          ctx ? h("span", { class: "badge mute" }, `${ctx}${ctxOut}`) : null,
          def ? h("span", { class: "badge accent" }, def) : null,
        ),
        h("div", { class: "mr-ref" },
          `${m.providerID}/${m.id}${chosen ?? "" ? ` · ${chosen}` : ""}`),
        caps.length || badge ? h("div", { class: "mr-tags" },
          ...caps.map((c) => h("span", { class: "badge mute" }, c)),
          badge ? h("span", { class: `badge ${badge.kind === "deprecated" ? "deprecated" : "mute"}` }, badge.label) : null,
        ) : null,
        m.variants?.length ? h("div", { class: "variant-strip" },
          h("span", { style: { fontSize: "11px", color: "var(--text-mute)", fontWeight: 600 } }, "Variant"),
          h("button", { class: `variant ${!chosen ? "active" : ""}`,
            onclick: (e) => { e.stopPropagation(); choose(m, null); } }, "Default"),
          m.variants.map((v) => {
            const vid = typeof v === "string" ? v : v?.id;
            if (!vid) return null;
            return h("button", {
              class: `variant ${chosen === vid ? "active" : ""}`,
              onclick: (e) => { e.stopPropagation(); choose(m, vid); },
            }, vid);
          }),
        ) : null,
      ),
      isExactCurrent ? h("div", { class: "mr-check" },
        h("svg", { width: 20, height: 20, viewBox: "0 0 24 24" },
          h("path", { d: "M5 13l4 4 10-10", fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" }))) : null,
    );
  }

  function render() {
    searchClear.hidden = !state.query;
    const models = store.state.models || [];
    const enabled = models.filter((m) => m.enabled !== false);
    const unavailable = models.filter((m) => m.enabled === false);

    renderCount(0, models.length);
    renderChips(models);

    listEl.replaceChildren();

    // active-model banner
    if (!state.query && current) {
      const m = mForRef(current);
      const mModel = m || null;
      listEl.append(
        h("div", { class: "card", style: { margin: "0 14px 10px", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 } },
          h("span", { class: "mg-dot", style: { background: "var(--ok)" } }),
          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", { style: { fontWeight: 650, fontSize: 13.5 } },
              m ? `${m.name}${current.variant ? ` · ${current.variant}` : ""}` : `${current.providerID}/${current.id}`),
            h("div", { class: "mono", style: { fontSize: 11.5, color: "var(--text-mute)" } }, "active in this chat")),
          h("span", { class: "badge ok" }, "Current")),
      );
    }

    // recents
    const recents = store.state.recents.filter((r) =>
      !state.query &&
      (!state.filter || r.providerID === state.filter) &&
      enabled.some((m) => m.providerID === r.providerID && m.id === r.id));
    if (recents.length) {
      listEl.append(h("div", { class: "section-title", style: { padding: "2px 18px 6px" } }, "Recently used"));
      const card = h("div", { class: "card", style: { margin: "0 14px 12px" } });
      for (const r of recents.slice(0, 5)) {
        card.append(
          h("button", {
            class: "recent-row", style: { width: "100%", border: 0, background: "none", color: "inherit", font: "inherit" },
            onclick: () => {
              const m = mForRef(r);
              if (!m) return toast("That model is no longer available", "err");
              choose(m, r.variant);
            },
          },
            h("span", { class: "recent-dot" }),
            h("div", { style: { flex: 1, minWidth: 0, textAlign: "left" } },
              h("div", { class: "recent-name" }, truncate(r.label || r.id, 44)),
              h("div", { class: "recent-sub" }, `${r.providerID}${r.variant ? ` · ${r.variant}` : ""}`)),
          ));
      }
      listEl.append(card);
    }

    // groups by provider (server order preserved)
    const visible = enabled.filter((m) =>
      (!state.filter || m.providerID === state.filter) &&
      matchesQuery(m, providerName(m.providerID), state.query));
    renderCount(visible.length, models.length);

    if (!visible.length) {
      listEl.append(h("div", { class: "empty-state" },
        h("div", { class: "big" }, "⌕"),
        state.query ? `No models match “${state.query}”.` : "No models are available yet.",
        h("div", { class: "hint", style: { marginTop: 6 } },
          "Connect a provider in Providers — the catalogue updates automatically."),
      ));
    } else {
      const groups = new Map();
      for (const m of visible) {
        if (!groups.has(m.providerID)) groups.set(m.providerID, []);
        groups.get(m.providerID).push(m);
      }
      for (const [pid, items] of groups) {
        listEl.append(
          h("div", { class: "mg-head" },
            h("span", { class: "mg-dot", style: { background: hashColor(pid) } }),
            h("span", {}, providerName(pid)),
            h("span", { class: "mg-id mono" }, pid),
            h("span", { class: "mg-count" }, items.length),
          ));
        for (const m of items) listEl.append(modelRow(m));
        listEl.append(h("div", { style: { height: 6 } }));
      }

      // unavailable: shown, not selectable
      if (unavailable.length) {
        listEl.append(h("div", { class: "section-title", style: { padding: "6px 18px" } }, "Unavailable on server"));
        const cardEl = h("div", { class: "card", style: { margin: "0 14px 12px" } });
        for (const m of unavailable.slice(0, 10)) {
          cardEl.append(h("div", { class: "model-row unavailable", style: { cursor: "not-allowed" }, "aria-disabled": "true" },
            h("div", { class: "mr-main" },
              h("div", { class: "mr-name" }, h("span", { class: "nm" }, m.name || m.id)),
              h("div", { class: "mr-ref" }, `${m.providerID}/${m.id}`)),
            h("span", { class: "badge unavail" }, "Disabled")));
        }
        listEl.append(cardEl);
      }
    }

    renderFoot();
  }

  render();
  return root;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
