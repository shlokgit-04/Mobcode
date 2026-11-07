/* Mobcode service worker — offline app shell only; never intercept API/event
   traffic (proxied OpenCode API must always hit the network). */
const SHELL = "mobcode-shell-v4";
const ASSETS = [
  "/", "/index.html", "/manifest.webmanifest", "/mobcode-build.json",
  "/app/css/app.css",
  "/app/js/main.js", "/app/js/api.js", "/app/js/store.js", "/app/js/ui.js",
  "/app/js/format.js", "/app/js/views.js", "/app/js/modelpicker.js", "/app/js/providers.js",
  "/app/js/native.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api") || p === "/event" || p.startsWith("/__mobcode")) return;

  // static assets: cache-first; navigations: network-first with shell fallback
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => res)
        .catch(() => caches.match("/index.html"))
    );
    return;
  }
  if (/^\/(app|icons|manifest\.webmanifest)/.test(p)) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, copy));
            return res;
          })
      )
    );
  }
});
