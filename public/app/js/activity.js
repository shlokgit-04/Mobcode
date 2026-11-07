/**
 * Mobcode Activity — a readable timeline of what the agent actually did.
 *
 * Sources, all real (no fabricated progress):
 *  - SSE-derived store.activityLog (session/run/integration events)
 *  - per-session tool parts (messageCache) rendered as human labels
 *  Advanced tool payloads stay expandable behind a tap.
 */
import { h, toast } from "./ui.js";
import { store } from "./store.js";
import { toolMeta, toolDetail, toolOutput } from "./activitymap.js";
import { fmtTime, timeAgo } from "./format.js";

export function ActivityView({ onOpenChat } = {}) {
  const list = h("div", {});
  const detailFor = { openRef: null };

  const el = h("div", { class: "view-pad fade-in" },
    h("div", { class: "home-hero", style: { paddingBottom: 0 } },
      h("h1", { class: "home-headline", style: { fontSize: "23px" } }, "Activity"),
      h("p", { class: "greeting", style: { marginTop: 2 } }, "What your agent did — in plain words.")),
    list);

  function dayGroup(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  function entryIcon(entry) {
    const kinds = {
      run: "▶", session: "💬", integration: "⚡", tool: "⚒",
    };
    const color = { err: "var(--danger)", ok: "var(--ok)" }[entry.status] || "var(--accent-2)";
    return h("div", { class: "avatar-sm", style: { width: "36px", height: "36px", borderRadius: "11px", color, fontSize: "13px" } }, kinds[entry.kind] || "•");
  }

  function toolEntries() {
    const out = [];
    for (const [sid, tools] of (window.__chatToolFrames?.() || new Map())) {
      for (const t of tools.slice(-25)) {
        const meta = toolMeta(t.name);
        const status = t.state?.status || "";
        out.push({
          at: t.time?.created || Date.now(),
          kind: "tool",
          sessionId: sid,
          label: meta.label,
          detail: toolDetail(t.name, t.state?.input),
          status: status === "error" ? "err" : "ok",
          state: t.state,
          name: t.name,
        });
      }
    }
    return out;
  }

  function render() {
    const entries = [...store.state.activityLog, ...toolEntries()]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, 120);
    list.replaceChildren();
    if (!entries.length) {
      list.append(h("div", { class: "empty-state" },
        h("div", { class: "big" }, "◎"),
        "Nothing yet — the agent's actions appear here as it works.",
        h("div", { class: "hint", style: { marginTop: 8 } }, "Ask for something on the Home tab to see it in action.")));
      return;
    }
    let lastDay = "";
    for (const entry of entries) {
      const day = dayGroup(entry.at);
      if (day !== lastDay) {
        lastDay = day;
        list.append(h("div", { class: "day-sep" }, day));
      }
      list.append(entryRow(entry));
    }
  }

  function entryRow(entry) {
    const sess = store.state.sessionCache.get(entry.sessionId);
    const title = sess?.title || (entry.sessionId ? truncate(entry.sessionId, 16) : "");
    const iconName = { err: "var(--danger)", ok: "var(--ok)" }[entry.status];
    const row = h("button", { class: "row-item act-timeline" },
      entryIcon(entry),
      h("div", { class: "row-main" },
        h("div", { class: "row-title" }, entry.label),
        h("div", { class: "row-sub" },
          entry.detail ? truncate(entry.detail, 46) + "  ·  " : "",
          title ? `${title}` : "")),
      h("div", { class: "row-end" },
        h("div", {}, fmtTime(entry.at)),
        h("div", {}, timeAgo(entry.at).replace(" ago", ""))));

    if (entry.kind === "tool" && entry.state) {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDetail(entry, row);
      });
    } else if (entry.sessionId) {
      row.onclick = () => { if (store.state.sessions.some((s) => s.id === entry.sessionId)) onOpenChat?.(entry.sessionId); };
    }
    return row;
  }

  function toggleDetail(entry, row) {
    const existing = row.parentElement.querySelector(".act-detail.expanded");
    if (existing) { existing.remove(); if (detailFor.openRef === entry) return; }
    const parts = [];
    if (entry.state?.input) {
      try { parts.push("input:\n" + truncate(JSON.stringify(entry.state.input, null, 1), 700)); } catch {}
    }
    const outp = toolOutput(entry.state);
    if (outp) parts.push("output:\n" + outp);
    if (entry.state?.error) parts.push("error:\n" + truncate(String(entry.state.error?.message || entry.state.error), 400));
    if (!parts.length) parts.push("No recorded detail.");
    const detail = h("div", { class: "act-detail expanded" }, parts.join("\n\n"));
    row.after(detail);
    detailFor.openRef = entry;
  }

  el.render = render;
  const unsub = store.subscribe(() => { if (!document.body.contains(el)) return; render(); });
  el.cleanup = () => unsub();
  return el;
}

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
