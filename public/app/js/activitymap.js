/**
 * Agent activity mapping — OpenCode tool parts → human-readable activity.
 *
 * Everything here derives from REAL engine events (message parts with
 * type:"tool", their name + state.status + state.input). Nothing is invented:
 * if a tool is unknown, we show its actual name.
 */

const TOOL_MAP = {
  read: { label: "Reading source code", icon: "read", expand: "file" },
  glob: { label: "Exploring project files", icon: "explore", expand: "pattern" },
  list: { label: "Exploring project files", icon: "explore", expand: "path" },
  grep: { label: "Searching the codebase", icon: "search", expand: "pattern" },
  find: { label: "Locating text in files", icon: "search", expand: "pattern" },
  write: { label: "Writing code", icon: "write", expand: "filePath" },
  edit: { label: "Editing code", icon: "write", expand: "filePath" },
  multiedit: { label: "Editing code", icon: "write", expand: "filePath" },
  patch: { label: "Applying changes", icon: "write", expand: "filePath" },
  bash: { label: "Running commands", icon: "terminal", expand: "command" },
  task: { label: "Delegating to a sub-agent", icon: "agent", expand: "description" },
  todowrite: { label: "Planning changes", icon: "plan", expand: "todos" },
  todoread: { label: "Reviewing the plan", icon: "plan", expand: "" },
  webfetch: { label: "Fetching documentation", icon: "web", expand: "url" },
  fetch: { label: "Fetching a page", icon: "web", expand: "url" },
  tests: { label: "Running tests", icon: "test", expand: "" },
  snapshot: { label: "Checkpointing progress", icon: "snapshot", expand: "" },
  opencode: { label: "Talking to OpenCode", icon: "agent", expand: "" },
  git: { label: "Preparing Git operations", icon: "git", expand: "command" },
  commit: { label: "Preparing Git commit", icon: "git", expand: "" },
  ls: { label: "Exploring project files", icon: "explore", expand: "path" },
  shell: { label: "Running commands", icon: "terminal", expand: "command" },
};

export function toolMeta(name) {
  const meta = TOOL_MAP[String(name || "").toLowerCase()];
  if (meta) return meta;
  return { label: name ? `Running ${name}` : "Working", icon: "tool", expand: "" };
}

function shortPath(p) {
  if (!p) return "";
  return String(p).replace(/^\/(data|home)\//, "").split("/").slice(-2).join("/");
}

/** Short detail string from a tool part's input (whatever exists). */
export function toolDetail(name, input) {
  if (!input || typeof input !== "object") return "";
  const meta = toolMeta(name);
  for (const key of [meta.expand, "filePath", "file", "path", "pattern", "command", "url", "query", "location"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) {
      const s = v.trim();
      if (key === "command" || key === "pattern") return s.length > 64 ? s.slice(0, 64) + "…" : s;
      return shortPath(s.length > 80 ? s.slice(0, 80) + "…" : s);
    }
  }
  if (JSON.stringify(input) !== "{}") {
    try {
      const s = JSON.stringify(input);
      return s.length > 90 ? s.slice(0, 90) + "…" : s;
    } catch {}
  }
  return "";
}

/** Output preview from completed state (first text content, truncated). */
export function toolOutput(state) {
  if (!state || state.status !== "completed") return "";
  const parts = state.content || [];
  for (const c of parts) {
    if (c.type === "text" && c.text) {
      const t = c.text.trim();
      return t.length > 300 ? t.slice(0, 300) + "…" : t;
    }
    if (c.type === "file") return c.uri || "";
  }
  return "";
}

const ICONS = {
  read: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.5 5 8.5 4.5 6 4.5c-1 0-2 .1-3 .4v14c1-.3 2-.4 3-.4 2.5 0 4.5.5 6 2 1.5-1.5 3.5-2 6-2 1 0 2 .1 3 .4v-14c-1-.3-2-.4-3-.4-2.5 0-4.5.5-6 2z"/><path d="M12 6.5v14"/></svg>`,
  explore: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16.5 16.5 4 4"/></svg>`,
  write: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5 19.5 10 8 21.5H2.5V16z"/><path d="m12.5 6 5.5 5.5"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M12 15h5"/></svg>`,
  agent: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 7V4M8 4h8"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3.5 5 1 1 2-2"/><path d="m3.5 12 1 1 2-2"/><path d="m3.5 19 1 1 2-2"/></svg>`,
  web: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.2 12.5 0 17M12 3.5c-2.5 2.5-3.2 12.5 0 17"/></svg>`,
  test: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6L4.8 17A3 3 0 0 0 7.5 21h9a3 3 0 0 0 2.7-4L15 9V3"/><path d="M7 3h10M6.5 15h11"/></svg>`,
  git: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M6.5 8v8M6.5 12c4 0 11 .5 11-3z"/></svg>`,
  tool: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6.5 17.5 9.5 7 20H4v-3z"/><path d="m13 8 3 3"/></svg>`,
  snapshot: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.4"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="4 3"/></svg>`,
};

export function toolIcon(name) {
  const meta = TOOL_MAP[String(name || "").toLowerCase()];
  const key = meta ? meta.icon : "tool";
  const svg = ICONS[key] || ICONS.tool;
  const el = h("span", { class: "act-ic", style: { display: "inline-flex" }, "aria-hidden": "true" });
  el.innerHTML = svg;
  return el;
}
