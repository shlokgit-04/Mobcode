# Mobcode Security notes

Companion to `PRIVACY-POLICY.md` (human-readable data handling) — this file is
an engineering inventory: what is sensitive, where it lives, how it moves.

## Secrets inventory

| Secret | Where it must live | Where it must never appear |
|---|---|---|
| `ENGINE_PASSWORD` (engine↔companion auth, loopback) | Render dashboard env; `docker/start-prod.sh` reads it | git, logs, client, `mobcode.server.json` |
| OpenCode engine password (same value) | same env, handed to `opencode serve` via `OPENCODE_SERVER_PASSWORD` | any client |
| Provider API keys (`ANTHROPIC_API_KEY`, …) | Render dashboard env → engine process | app, git, companion config |
| Android signing keystore (`mobcode-upload.keystore` + `android/keystore.properties`) | local disk, outside git | git, CI caches |
| Backend `mobcode.server.json` (may contain engine password) | server machine (chmod 600) | git (thanks `.gitignore`), client |

Enterprise hygiene: rotate `ENGINE_PASSWORD` by dashboard update + redeploy;
for the Play keystore keep `keystore.properties` out of any archive sent to CI.

## Dockerfile whitelists (`COPY`)

The image copies exactly: `server.js`, `package.json`, `public/`,
`docker/start-prod.sh`. Neither keystore material, `mobcode.server.json`,
`.env`, nor chats can enter the image through accident. `.dockerignore` backs
this up.

## Network boundaries

- The engine binds `127.0.0.1:$ENGINE_PORT` — unreachable from the internet.
- Public exposure is the companion `server.js` only, listening `$PORT`, which
  injects Basic auth + workspace `directory` into proxied requests.
- Native clients use HTTPS only (enforced in `native.js::urlIsAllowed`);
  `http://` is accepted only for local development hosts.
- Remote administration (`/__mobcode/target`, `/__mobcode/disconnect`) is
  localhost-only by default; `--allow-remote-admin` exists as a deliberate opt-in.

## Health endpoints, deliberately dumb

`/health` and `/health/keepalive`: static answers, no upstream calls, no
reception of input beyond method check; they expose version/uptime/memory
only. They are safe for external monitors and Play/QA probes.

## Known risks (honesty over marketing)

- The production deploy is a **single-tenant workspace** backend: one directory,
  one engine password, no per-user isolation. Do not URL-share outside the
  owner's control.
- **Rate limiting / abuse protection is not implemented.** The public endpoint
  is soft; anyone who discovers the URL can engage the engine within provider
  limits and your quota. Mitigations available on demand (basic token gate).
- Server logs (Render console) are Go's plain Node stdout — do NOT log secrets
  (checked: companion prints only `(set)` for password presence).
- Free-tier **ephemeral FS** means the workspace Git tokens, if used for
  rehydration, must be readable credentials only (read-only PAT).
