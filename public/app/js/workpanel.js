/**
 * Mobcode workspace panel — advanced tools in a bottom sheet, hidden from
 * normal users until they need them. Tabs:
 *  - Files    : real directory listing via GET /api/fs/list + file preview
 *               via GET /api/fs/read/*
 *  - Changes  : the current session's actual diffs via GET /api/session/:id/diff
 *  - Git      : GET /api/vcs/status + branch + diff where the workspace is a repo
 */
import { h, openSheet, toast } from "./ui.js";
import { store } from "./store.js";
import { fmtContext } from "./format.js";
import { describeError } from "./api.js";

export function openWorkPanel({ sessionID, api } = {}) {
  const state = { tab: "files", dir: currentDir() };

  const tabsEl = h("div", { class: "work-tabs" });
  const body = h("div", { class: "work-body" });

  let sheetApi = null;
  const root = h("div", {},
    h("div", { class: "sheet-head", style: { padding: "8px 18px 4px" } },
      h("div", { class: "sheet-grip" }),
      h("div", { class: "sheet-title-row" },
        h("span", { class: "sheet-title" }, "Workspace"),
        h("span", { id: "workpanel-dir", class: "mono", style: { color: "var(--text-mute)", fontSize: "11px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, state.dir || "default"),
        h("button", { class: "sheet-close", "aria-label": "Close", onclick: () => sheetApi?.close?.() }, "✕"))),
    tabsEl,
    body,
  );

  const sheet = openSheet((api_) => { sheetApi = api_; return root; });

  function renderTabs() {
    const tabs = [
      ["files", "Files"],
      ["changes", "Changes"],
      ["git", "Git"],
    ];
    tabsEl.replaceChildren(...tabs.map(([id, label]) =>
      h("button", {
        class: `work-tab ${state.tab === id ? "active" : ""}`,
        onclick: () => { state.tab = id; renderTabs(); render(); },
      }, label)));
  }

  function currentDir() {
    const st = store.state;
    if (st.currentProjectId) {
      const p = st.projects.find((x) => x.id === st.currentProjectId);
      if (p) return p.canonical || p.directory || "";
    }
    return st.directory || st.host?.directory || "";
  }

  function locationParam() {
    return state.dir ? new URLSearchParams({ location: JSON.stringify({ directory: state.dir }) }) : new URLSearchParams();
  }

  async function render() {
    if (state.tab === "files") await renderFiles();
    else if (state.tab === "changes") await renderChanges();
    else await renderGit();
  }

  /* ---------- files ---------- */
  async function renderFiles(path = "") {
    body.replaceChildren(spinnerEl("Listing files"));
    try {
      const params = locationParam();
      if (path) params.set("path", path);
      const res = await api.get("/api/fs/list", params);
      const data = res?.data ?? res ?? {};
      // fs/list response varies (recursive listing object). Normalize:
      let listWrap = data;
      if (Array.isArray(data)) listWrap = { "/": data };
      const show = path || "/";
      const items = listWrap[show] || listWrap[path] || Object.values(listWrap)[0] || [];
      const rows = h("div", {});
      if (!items.length) rows.append(h("div", { class: "empty-state" }, "Empty directory."));
      for (const it of items) {
        const p = it.path?.startsWith("/") ? it.path : path ? `${path}/${it.path}` : (it.path || it.name);
        const isDir = it.type === "directory" || p?.endsWith("/");
        rows.append(h("div", { class: "file-row", onclick: () => isDir ? renderFiles(p) : previewFile(p) },
          h("span", { class: "f-ic" }, isDir ? folderIcon() : fileIcon()),
          h("span", { class: "f-name" }, it.name || it.path?.split("/").pop()),
          h("span", { class: "f-size" }, isDir ? "dir" : (fmtContext(it.size) || ""))));
      }
      body.replaceChildren(rows);
      if (path) {
        const up = path.split("/").slice(0, -1).join("/");
        body.prepend(h("div", { class: "file-row", onclick: () => renderFiles(up) },
          h("span", { class: "f-ic" }, "‹"),
          h("span", { class: "f-name", style: { color: "var(--accent-2)" } }, `.. ${up || "/"}`)));
      }
    } catch (err) {
      body.replaceChildren(errorBox(describeError(err, "Could not list files")));
    }
  }

  async function previewFile(path) {
    body.replaceChildren(spinnerEl("Reading file"));
    try {
      const res = await fetch(api.url(`/api/fs/read/${encodePath(path)}`, locationParam()), {
        headers: api.headers(), cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message || "HTTP " + res.status);
      const content = j?.data?.content ?? j?.content ?? "";
      const pre = h("pre", { class: "act-detail", style: { margin: "12px", maxHeight: "none", whiteSpace: "pre-wrap" } }, truncate(content, 4000));
      const head = h("div", { class: "diff-file" }, fileIcon(), path,
        h("button", { class: "code-copy", style: { marginLeft: "auto" }, onclick: () => { navigator.clipboard?.writeText(content); toast("Copied", "ok", 1100); } }, "⧉ Copy"));
      body.replaceChildren(h("div", {}, head, pre));
    } catch (err) {
      body.replaceChildren(errorBox(describeError(err, "Could not read the file")));
    }
  }
  /** preserve slashes in path segments */
  function encodePath(p) {
    return String(p).split("/").map(encodeURIComponent).join("/");
  }

  /* ---------- changes (session diff) ---------- */
  async function renderChanges() {
    if (!sessionID) { body.replaceChildren(errorBox("Open a chat first — changes are per conversation.")); return; }
    body.replaceChildren(spinnerEl("Loading changes"));
    try {
      const res = await api.get(`/api/session/${sessionID}/diff`);
      const diffs = res?.data ?? res ?? [];
      if (!Array.isArray(diffs) || !diffs.length) {
        body.replaceChildren(h("div", { class: "empty-state" }, "No file changes in this chat yet."));
        return;
      }
      body.replaceChildren(...diffs.map(d => diffBlock(d)));
    } catch (err) {
      body.replaceChildren(errorBox(describeError(err, "Could not load diffs")));
    }
  }

  function diffBlock(d) {
    const colorize = (line) => {
      const cls = line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") ? "" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
      return h("div", { class: `diff-line ${cls}` }, line);
    };
    const lines = String(d.patch || "").split("\n").slice(0, 180);
    return h("div", { class: "card", style: { margin: "12px", overflow: "hidden" } },
      h("div", { class: "diff-file" }, fileIcon(), truncate(d.file, 40),
        h("span", { class: "diff-stat-add", style: { marginLeft: "auto" } }, `+${d.additions ?? 0}`),
        h("span", { class: "diff-stat-del" }, `-${d.deletions ?? 0}`)),
      ...lines.map(colorize));
  }

  /* ---------- git ---------- */
  async function renderGit() {
    body.replaceChildren(spinnerEl("Checking repository"));
    try {
      const [branchRes, statusRes] = await Promise.allSettled([
        api.get("/api/vcs/branch", locationParam()),
        api.get("/api/vcs/status", locationParam()),
      ]);
      if (branchRes.status !== "fulfilled" || statusRes.status !== "fulfilled") {
        body.replaceChildren(h("div", { class: "empty-state" }, "Not a Git repository.",
          h("div", { class: "hint", style: { marginTop: 8 } }, "This workspace doesn't have Git initialized on the server.")));
        return;
      }
      const branch = branchRes.value?.data ?? branchRes.value ?? "?";
      const status = statusRes.value?.data ?? statusRes.value ?? {};
      const out = [];
      out.push(h("div", { class: "row-item", style: { margin: "12px", cursor: "default" } },
        h("div", { class: "row-main" },
          h("div", { class: "row-title" }, `Branch: ${typeof branch === "string" ? branch : branch?.name || "?"}`)),
        status?.dirty ? h("span", { class: "badge paid" }, "modified") : h("span", { class: "badge ok" }, "clean")));
      // compact status file list when the engine provides one
      const files = statusDetail(status);
      if (files.length) {
        for (const f of files.slice(0, 40)) {
          out.push(h("div", { class: "file-row", style: { cursor: "default" } },
            h("span", { class: "f-ic" }, fileIcon()),
            h("span", { class: "f-name" }, truncate(f, 60))));
        }
      }
      body.replaceChildren(...out);
    } catch (err) {
      body.replaceChildren(errorBox(describeError(err, "Could not check Git status")));
    }
  }

  function statusDetail(status) {
    if (!status) return [];
    for (const k of ["files", "paths", "entries", "changes"]) {
      const v = status[k];
      if (Array.isArray(v)) return v.map((f) => typeof f === "string" ? f : f.path || f.file || f.name || "").filter(Boolean);
    }
    return [];
  }

  function spinnerEl(label) {
    return h("div", { class: "loading" }, h("span", { class: "spin" }), label, "…");
  }
  function errorBox(msg) {
    return h("div", { class: "empty-state" }, "⚠", h("div", { class: "hint", style: { marginTop: 8 } }, msg));
  }
  function folderIcon() {
    return h("svg", { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
      h("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }));
  }
  function fileIcon() {
    return h("svg", { viewBox: "0 0 24 24", width: 15, height: 15, fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
      h("path", { d: "M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }));
  }
  function truncate(s, n) {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  renderTabs();
  render();
  return sheet;
}
