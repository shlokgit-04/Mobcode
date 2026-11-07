/** DOM helpers, toasts, sheets, modals. */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value" || k === "checked" || k === "selected" || k === "indeterminate") el[k] = v;
      else if (k === "html") el.innerHTML = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(parent, child) {
  parent.replaceChildren(child);
}

/* ————— toasts ————— */
export function toast(message, kind = "info", ms = 2800) {
  const root = document.getElementById("toast-root");
  const el = h("div", { class: `toast ${kind}`, role: "status" }, message);
  root.append(el);
  const live = document.getElementById("live-region");
  if (live) live.textContent = message;
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/* ————— bottom sheet ————— */
export function openSheet(build) {
  const root = document.getElementById("sheet-root");
  const backdrop = h("div", { class: "sheet-backdrop" });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
  const close = () => {
    if (window.__sheetClose === close) window.__sheetClose = undefined;
    sheet.style.translate = "0 40%";
    sheet.style.opacity = "0";
    sheet.style.transition = "translate .18s ease, opacity .18s ease";
    backdrop.style.opacity = "0";
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 200);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", close);

  const api = { close, el: sheet };
  // Back-button/closing helpers: the hardware back handler (bridge.js in the
  // Android app) closes the topmost sheet instead of leaving the app.
  window.__sheetClose = close;
  api.swap = (newContent) => {
    sheet.replaceChildren(
      h("div", { style: { display: "contents" } }, ...[].concat(newContent))
    );
  };
  const content = build(api);
  if (content) sheet.append(content);
  root.append(backdrop, sheet);
  (sheet.querySelector("input, [tabindex], button") || sheet).focus?.();
  return api;
}

/* ————— modal ————— */
export function openModal({ title, body, actions = [] }) {
  const root = document.getElementById("modal-root");
  const backdrop = h("div", { class: "modal-backdrop" });
  const close = () => {
    backdrop.remove();
    if (window.__sheetClose === close) window.__sheetClose = undefined;
  };
  window.__sheetClose = close;
  const m = h(
    "div",
    { class: "modal", role: "dialog", "aria-modal": "true" },
    h("h3", {}, title),
    body,
    h("div", { class: "modal-actions" }, ...actions.map((a) =>
      h("button", { class: a.class || "btn", onclick: (e) => a.onClick?.(e, close) }, a.label)))
  );
  m.addEventListener("click", (e) => e.stopPropagation());
  backdrop.addEventListener("click", close);
  backdrop.append(m);
  root.append(backdrop);
  return close;
}

/* ————— misc ————— */
export function spinner(label = "Loading") {
  return h("div", { class: "loading" }, h("span", { class: "spin" }), label, "…");
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function sheetHeader(title, count, api) {
  return h(
    "div",
    { class: "sheet-head" },
    h("div", { class: "sheet-grip" }),
    h(
      "div",
      { class: "sheet-title-row" },
      h("div", { class: "sheet-title" }, title),
      count !== undefined ? h("div", { class: "sheet-count", id: "sheet-count" }, count) : null,
      h("button", { class: "sheet-close", "aria-label": "Close", onclick: api.close },
        h("span", { style: { fontSize: "17px", lineHeight: 1 } }, "✕"))
    )
  );
}
