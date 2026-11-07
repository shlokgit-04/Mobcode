/**
 * Mobcode Projects — attractive cards from the engine's real projects
 * (GET /api/project): name, path, git state where available, last activity,
 * actions: Open project (new session there) and Start new session (also new).
 * Plus a simple new-project flow (directory + first chat inside it).
 */
import { h, toast, openSheet } from "./ui.js";
import { store } from "./store.js";
import { describeError } from "./api.js";
import { timeAgo } from "./format.js";
import { createSessionWithModel } from "./views.js";

export function ProjectsView({ onOpenProject, onOpenChat } = {}) {
  const listHolder = h("div", { style: { marginTop: 12 } });

  function sessionsFor(projectId) {
    return store.state.sessions.filter((s) => s.projectID === projectId);
  }

  function lastActive(p) {
    const sess = sessionsFor(p.id);
    const t = Math.max(
      p.time?.active || 0,
      p.time?.updated || 0,
      ...sess.map((s) => s.time?.updated || 0),
    );
    return t;
  }

  function renderList() {
    const projects = store.state.projects;
    listHolder.replaceChildren();
    if (!projects.length) {
      listHolder.append(h("div", { class: "empty-state" },
        h("div", { class: "big" }, "🗂"),
        "No projects yet on this server.",
        h("div", { class: "hint", style: { marginTop: 8 } },
          "Projects appear as your agent works on code directories.")));
      return;
    }
    const sorted = [...projects].sort((a, b) => lastActive(b) - lastActive(a));
    for (const p of sorted) {
      const dir = p.canonical || p.directory || "";
      const name = dir.split("/").filter(Boolean).pop() || "Project";
      const sess = sessionsFor(p.id);
      const last = lastActive(p);
      listHolder.append(projectCard(p, name, dir, sess.length, last));
    }
  }

  function projectCard(p, name, dir, nSessions, last) {
    const modelLine = [];
    if (p.vcs) modelLine.push(h("span", { class: "badge ok" }, p.vcs));
    modelLine.push(h("span", {}, timeAgo(last) || "new"));
    if (nSessions) modelLine.push(h("span", {}, `${nSessions} chat${nSessions > 1 ? "s" : ""}`));

    return h("div", { class: "proj-card" },
      h("div", {
        class: "proj-head",
        onclick: () => openProject(p),
      },
        h("div", { class: "proj-ic" }, name.slice(0, 1).toUpperCase()),
        h("div", { style: { minWidth: 0, flex: 1 } },
          h("div", { class: "proj-name" }, name),
          h("div", { class: "proj-path mono" }, dir))),
      h("div", { class: "proj-meta" }, ...modelLine),
      h("div", { class: "proj-actions" },
        h("button", { class: "btn small primary", onclick: () => { store.set({ currentProjectId: p.id, directory: dir }); newChatIn(p, dir); } },
          h("svg", { viewBox: "0 0 24 24", width: 13, height: 13, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" },
            h("path", { d: "M12 5v14M5 12h14" })),
          "New session"),
        h("button", { class: "btn small", onclick: () => openSessionsSheet(p, name) }, "Chats")),
    );
  }

  async function openProject(p) {
    const dir = p.canonical || p.directory || "";
    store.set({ currentProjectId: p.id, directory: dir });
    store.persistPrefs?.();
    openSessionsSheet(p, dir.split("/").pop());
  }

  async function newChatIn(p, dir) {
    try {
      toast(`Opening ${dir.split("/").pop()}…`, "info", 1600);
      await createSessionWithModel(null, { directory: dir });
    } catch {}
  }

  function openSessionsSheet(p, name) {
    openSheet((s) => {
      const body = h("div", { class: "sheet-body", style: { padding: "0 16px 24px" } });
      const sess = sessionsFor(p.id).sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
      if (!sess.length) {
        body.append(h("div", { class: "empty-state" }, h("div", { class: "big" }, "💬"),
          "No chats in this project yet.", h("div", { class: "hint", style: { marginTop: 8 } },
            `Start one and the agent will work inside ${p.canonical || p.directory || "this directory"}.`)));
      } else {
        for (const session of sess) {
          const m = session.model;
          body.append(h("button", { class: "row-item", onclick: () => { s.close(); onOpenChat?.(session.id); } },
            h("div", { class: "avatar-sm" }, (session.title || "?").slice(0, 1).toUpperCase()),
            h("div", { class: "row-main" },
              h("div", { class: "row-title" }, session.title || "Untitled"),
              h("div", { class: "row-sub" }, m ? `${m.providerID}/${m.id}` : session.agent || "")),
            h("div", { class: "row-end" }, timeAgo(session.time?.updated))));
        }
      }
      return h("div", {},
        h("div", { class: "sheet-head" },
          h("div", { class: "sheet-grip" }),
          h("div", { class: "sheet-title-row" },
            h("span", { class: "sheet-title" }, name),
            h("button", { class: "sheet-close", "aria-label": "Close", onclick: s.close }, "✕"))),
        body);
    });
  }

  function newProjectSheet() {
    openSheet((s) => {
      const dirInput = h("input", {
        class: "input", id: "np-dir",
        placeholder: store.state.directory || "/data/mobcode-workspace/my-app",
        spellcheck: "false", inputmode: "url",
        value: store.state.directory || "",
      });
      const errLine = h("div", { class: "status-line" });
      async function create(e) {
        const dir = dirInput.value.trim().replace(/\/+$/, "");
        if (!dir.startsWith("/")) {
          errLine.className = "status-line err";
          errLine.textContent = "Enter an absolute path on the server, e.g. /data/mobcode-workspace/todo";
          return;
        }
        errLine.className = "status-line";
        errLine.replaceChildren(h("span", { class: "spin" }), " Verifying the directory on the server…");
        try {
          // verify the directory exists / is listable via the real FS API
          const pl = new URLSearchParams({ location: JSON.stringify({ directory: dir }) });
          const res = await window.__api.get("/api/fs/list", pl);
          errLine.className = "status-line ok";
          errLine.textContent = "Directory verified. Creating chat…";
          store.set({ currentProjectId: "", directory: dir });
          store.persistPrefs?.();
          s.close();
          await createSessionWithModel(null, { directory: dir });
          window.__refreshProjects?.();
        } catch (err) {
          errLine.className = "status-line err";
          errLine.textContent = describeError(err, "That directory isn't reachable on the server");
        }
      }
      return h("div", {},
        h("div", { class: "sheet-head" },
          h("div", { class: "sheet-grip" }),
          h("div", { class: "sheet-title-row" },
            h("span", { class: "sheet-title" }, "New project"),
            h("button", { class: "sheet-close", "aria-label": "Close", onclick: s.close }, "✕"))),
        h("div", { class: "sheet-body", style: { padding: "8px 18px 26px" } },
          h("div", { class: "hint", style: { margin: "0 2px 14px" } },
            "Give the folder on your Mobcode server where the agent should work. It should already exist (or the agent can create code in a workspace root)."),
          h("div", { class: "field" },
            h("span", { class: "field-label" }, "Directory on server"),
            dirInput),
          h("button", { class: "btn primary block", onclick: create }, "Create & start chatting"),
          errLine),
      );
    });
  }

  const el = h("div", { class: "view-pad fade-in" },
    h("div", { class: "home-hero", style: { paddingBottom: 0 } },
      h("h1", { class: "home-headline", style: { fontSize: "23px" } }, "Projects"),
      h("p", { class: "greeting", style: { marginTop: 2 } }, "Everything your agent works on lives here.")),
    listHolder,
    h("div", { style: { marginTop: 16 } },
      h("button", { class: "home-quick", onclick: newProjectSheet },
        h("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" },
          h("path", { d: "M12 5v14M5 12h14" })),
        "New project")),
  );

  el.render = async () => {
    renderList();
    try {
      const res = await window.__api.get("/api/project");
      const arr = Array.isArray(res) ? res : res?.data ?? [];
      store.set({ projects: arr.filter((p) => p.id !== "global") });
    } catch {}
    renderList();
  };
  const unsub = store.subscribe(() => { if (document.body.contains(el)) renderList(); });
  el.cleanup = () => unsub();
  void onOpenProject;

  el.render();
  return el;
}

function escapeIni(s) { return String(s); }
