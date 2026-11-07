# Mobcode

**Your code. Your agent. Anywhere.**
A zero-dependency web/Android client that speaks *only* to your own OpenCode
installation — dynamic model catalogue, chats, workspace files, MCP, providers,
all rendered from real server data.

- **No analytics, no ads, no third-party tracking SDKs**
- **No API keys in the app** — provider credentials live on *your* server
- Vanilla-JS PWA (no bundler) + native shell (Capacitor 8)

---

## Architecture

```
MOBCODE APP (PWA / Android APK)
        │  HTTPS · SSE for live events
        ▼
MOBCODE COMPANION  (server.js — deployable on Render)
        │  loopback, Basic auth injected server-side
        ▼
OPENCODE ENGINE  (opencode serve, pinned version)
        │  server-side credentials only
        ▼
AI PROVIDERS
```

The companion (`server.js`) serves the static PWA and proxies every API path
(`/api/*`, `/event` SSE, `/fs/*`, `/vcs/*`, `/mcp`, …) to the configured
OpenCode engine, adding the workspace `directory` and the engine password so
clients never hold secrets.

## Quick start (local)

```bash
node server.js                 # PWA + companion proxy on :8090
# in a second shell, point it at the engine:
opencode serve --port 46000
# then configure the companion (or set flags):
node server.js --port 8090 --open http://127.0.0.1:46000 [...]
```

Or reuse the same flow the production image uses:
`docker/start-prod.sh` (engine + companion in one process tree).

## Runtime endpoints

| Endpoint | Purpose |
|---|---|
| `/` | Mobcode PWA |
| `/api/*`, `/event`, `/fs/*`, … | proxied to the OpenCode engine |
| `/__mobcode/public` | companion metadata (no secrets) |
| `/__mobcode/target` | configure engine target (local ACL) |
| `/health` | availability + version + uptime + engineConnected |
| `/health/keepalive` | ultra-cheap liveness ping for external monitors |

## Repository layout

```
server.js                companion + proxy + health
public/                  PWA (vanilla JS modules, no build step)
  app/js/ config.js      ← stamped with the production URL for release builds
android/                 Capacitor 8 native shell
scripts/                 packaging, URL stamping, checks
docker/                  docker/start-prod.sh (engine + companion)
Dockerfile, render.yaml  Render free-tier deployment
```

## Docs

| Doc | Contents |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Render free-tier deployment from scratch |
| [KEEPALIVE-SETUP.md](KEEPALIVE-SETUP.md) | keeping the free instance awake via external monitor |
| [GITHUB-SETUP.md](GITHUB-SETUP.md) | pushing this repo with a personal access token |
| [ANDROID-TESTING.md](ANDROID-TESTING.md) | installing/debug/regression on a phone |
| [RELEASE-NOTES.md](RELEASE-NOTES.md) | what's new in v1.1.0 |
| [SECURITY.md](SECURITY.md) | secrets inventory + threat model |
| [PRIVACY-POLICY.md](PRIVACY-POLICY.md) | the honest data policy |
| [scripts/package-android.sh](scripts/package-android.sh) | signed APK/AAB pipeline |
