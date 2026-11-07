/**
 * Mobcode native bridge — active only inside the packaged Android app.
 *
 * In the APK the bundle is served from the Capacitor WebView (https://localhost),
 * so there is same-origin companion server. Every API call goes straight to the
 * user-configured Mobcode backend over HTTPS (direct mode in api.js), using the
 * authoritative connection URL stored in the encrypted native store.
 *
 * Responsibilities:
 *   - connection config: probe / verify / save (AES-256-GCM secure store) / edit
 *   - HTTPS enforcement for production (http only for private dev hosts)
 *   - hardware back-button, native splash/layout init, status bar styling
 *   - haptics, clipboard, share helpers (native where available)
 *   - network recovery: reconnect SSE + data refresh when connectivity returns,
 *     refresh on return to foreground
 */
import { store } from "./store.js";
import { toast, openModal } from "./ui.js";

const CAP = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor : null);
export const isNative = () => Boolean(CAP());

const CONN_KEY = "connection.v1";

/* ————————————————— secure connection config ————————————————— */

export async function loadConnection() {
  const c = CAP();
  let raw = null;
  if (c) {
    // Encrypted native store first (MobcodeSecureStore), Preferences as bridge fallback
    try {
      const r = await c.Plugins.MobcodeSecureStore?.get({ key: CONN_KEY });
      if (r?.value) raw = r.value;
    } catch {}
    if (!raw) {
      try {
        const r = await c.Plugins.Preferences?.get({ key: CONN_KEY });
        if (r?.value) raw = r.value;
      } catch {}
    }
  } else {
    raw = localStorage.getItem("mobcode.connection") || null;
  }
  if (!raw) return null;
  try {
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg.url !== "string" || !cfg.url) return null;
    return cfg;
  } catch {
    return null;
  }
}

export async function saveConnection(cfg) {
  const c = CAP();
  if (c) {
    const saved = await c.Plugins.MobcodeSecureStore.set({ key: CONN_KEY, value: JSON.stringify(cfg) })
      .catch(async () => {
        // extremely unlikely; Preferences fallback keeps the app usable
        await c.Plugins.Preferences?.set({ key: CONN_KEY, value: JSON.stringify(cfg) });
      });
    return saved;
  }
  try { localStorage.setItem("mobcode.connection", JSON.stringify(cfg)); } catch {}
  return true;
}

export async function clearConnection() {
  const c = CAP();
  if (c) {
    try { await c.Plugins.MobcodeSecureStore?.remove({ key: CONN_KEY }); } catch {}
    try { await c.Plugins.Preferences?.remove({ key: CONN_KEY }); } catch {}
  }
  try { localStorage.removeItem("mobcode.connection"); } catch {}
}

/* ————————————————— URL validation / probing ————————————————— */

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|::1|\[::1\])$/;

/** Production rule: HTTPS required. HTTP only ever allowed for dev hosts. */
export function urlIsAllowed(rawUrl) {
  let u;
  try { u = new URL(rawUrl.trim()); } catch { return { ok: false, error: "That doesn't look like a server URL." }; }
  if (u.protocol === "https:") return { ok: true, url: u };
  if (u.protocol === "http:") {
    if (PRIVATE_HOST.test(u.hostname)) return { ok: true, url: u };
    return { ok: false, error: "Insecure HTTP is rejected. Use https:// for the Mobcode backend (http is permitted only for local development hosts)." };
  }
  return { ok: false, error: "URL must start with http:// or https:// (https required)." };
}

/**
 * Probe a backend URL. The Mobcode companion (PWA host) answers
 * /__mobcode/public; a bare OpenCode server answers /api/config or /api/health.
 * Returns { ok, kind, data?, error? }.
 */
export async function probeConnection(url, password = "") {
  const headers = password ? { Authorization: `Bearer ${password}` } : {};
  const base = url.replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/__mobcode/public`, { headers, cache: "no-store" });
    if (res.ok) {
      const cfg = await res.json().catch(() => null);
      return { ok: true, kind: "companion", data: cfg || {} };
    }
  } catch {}
  // OpenCode engine speaking directly (advanced hosts)
  try {
    const res = await fetch(`${base}/api/config`, { headers, cache: "no-store" });
    if (res.ok) return { ok: true, kind: "opencode", data: {} };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: password ? "Authentication failed — check the server password." : "This server requires a password." };
    }
    return { ok: false, error: `Server answered ${res.status} on /api/config.` };
  } catch {
    return { ok: false, error: "Could not reach the server (check the URL and your network)." };
  }
}

/* ————————————————— native niceties ————————————————— */

export async function haptic(kind = "light") {
  const c = CAP();
  if (!c?.Plugins.Haptics) return;
  try {
    await c.Plugins.Haptics.impact({ style: kind });
  } catch {}
}

export async function copyText(text) {
  const c = CAP();
  if (c?.Plugins.Clipboard) {
    try { await c.Plugins.Clipboard.write({ string: text }); return true; } catch {}
  }
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  return false;
}

export async function shareText(title, text) {
  const c = CAP();
  if (c?.Plugins.Share) {
    try { await c.Plugins.Share.share({ title, text }); return true; } catch {}
      }
  if (navigator.share) {
    try { await navigator.share({ title, text }); return true; } catch {}
  }
  return false;
}

/* ————————————————— boot wiring ————————————————— */

let wired = false;

export async function initNative({ restartEvents, refreshAll } = {}) {
  const c = CAP();
  if (!c) {
    // non-native web: still refresh when the tab becomes visible again
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && store.state.connected) refreshAll?.(true);
    });
    return;
  }
  if (wired) return;
  wired = true;

  // status bar: solid dark, white glyphs (brand theme)
  try { await c.Plugins.StatusBar?.setStyle({ style: "Dark" }); } catch {}
  try { await c.Plugins.StatusBar?.setBackgroundColor({ color: "#0b0e14" }); } catch {}

  // hardware back button: sheet/modal first, then route stack, then minimize
  try {
    await c.Plugins.App.addListener?.("backButton", () => {
      if (typeof window.__sheetClose === "function") { window.__sheetClose(); return; }
      const backdrop = document.querySelector(".modal-backdrop");
      if (backdrop) { backdrop.click(); return; }
      if (window.__nav?.stack?.length > 1) { window.__nav.pop(); return; }
      c.Plugins.App.exitApp?.();
    });
  } catch {}

  // network recovery — Wi-Fi <-> mobile data, brief dropouts, server blips
  try {
    await c.Plugins.Network.addListener?.("networkStatusChange", (s) => {
      if (s.connected && store.state.connected) {
        restartEvents?.();
        refreshAll?.(true);
      } else if (!s.connected) {
        store.set({ sseStatus: "disconnected" });
        toast("Offline — the app reconnects automatically", "info", 3000);
      }
    });
  } catch {}

  // background -> foreground: Session restoration + stale data refresh
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && store.state.connected) {
      restartEvents?.();
      refreshAll?.(true);
    }
  });
}
