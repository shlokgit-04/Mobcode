# Release notes — v1.1.0 (Phase 4)

Focus of this release: **production-ready redesign of the UI**, production deployment
path (Render free tier), and shipping discipline (packaging gate + keep-alive).

## What's new

### Redesigned mobile UI (in-place, no rewrite of functionality)
- New **DeepSpace** design system (`public/app/css/app.css`): deep navy dark
  (default) + clean light theme, electric blue/cyan accents, generous spacing.
- New app chrome: slim top bar (brand · context title · connection pill ·
  profile menu), **3 tabs** — Home / Projects / Activity — replacing the old
  4-tab chrome. Secondary areas (Integrations, MCP, Workspace, Appearance,
  Advanced/Connection, About) moved into the profile menu sheet.
- All data layers preserved one-to-one (api.js, store.js, modelpicker.js,
  providers.js, views.js, native.js); new decorative modules: markdown.js,
  activitymap.js, home.js, chat.js, projects.js, activity.js, workpanel.js,
  menu.js, config.js.
- Service worker shell refreshed (v7) with the full module list; API/SSE still
  never cached.

### Production deployment (Render free tier)
- `Dockerfile` + `docker/start-prod.sh`: pinned OpenCode engine (2.2.5) and
  companion in a single container; engine on loopback with a dashboard-set
  `ENGINE_PASSWORD`; companion `server.js` publishes to the world.
- `render.yaml` blueprint: **free** plan, health check `/health/keepalive`.
- `GET /health` + `/health/keepalive` endpoints in server.js (no secrets, no
  engine calls, cache `no-store`).
- External monitor doc: `KEEPALIVE-SETUP.md` (single monitor; no self-ping).
- Workspace Git rehydration optional via `MOBCODE_WORKSPACE_GIT` (+token),
  cloned at container boot only; free-tier FS stays ephemeral by design.

### Build discipline
- `scripts/set-production-url.mjs` — stamps the verified Render URL into
  `public/app/js/config.js`; refuses placeholders/unreachable URLs.
- `scripts/verify-android-config.mjs` (packaging gate) — release builds fail
  unless the URL is stamped and dev override is off.
- Android `versionCode 2`, `versionName 1.1.0`.
- Docs: DEPLOYMENT.md, GITHUB-SETUP.md, ANDROID-TESTING.md, SECURITY.md,
  README.md, updated PRIVACY-POLICY.md.

## Regressions / known limitations
- Free Render tier: cold start (~50 s) without external monitor; ephemeral FS.
- Debian package manager installs only Java 25 today; local Gradle builds
  need Java 21+ toolchain handling (see ANDROID-TESTING.md).
- Purple legacy PNG icons (192/512/maskable + apple-touch 180) still match the
  old palette — refresh them next cycle.
