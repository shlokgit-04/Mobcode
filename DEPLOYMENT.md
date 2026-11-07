# Deploying Mobcode to Render (free tier)

Target: **one free web service** on Render (512 MB RAM / 0.1 CPU), running the
OpenCode engine and the Mobcode companion in a single container. Budget: **$0**.

---

## 1. What you need ready

1. The source pushed to your GitHub remote (see [GITHUB-SETUP.md](GITHUB-SETUP.md)).
2. A **provider API key** for at least one model provider (e.g. `ANTHROPIC_API_KEY`
   or `OPENAI_API_KEY`). This is a *server* secret — it never enters the app.
3. A random string for `ENGINE_PASSWORD`, e.g.
   `openssl rand -base64 24`.

## 2. Create the service

Option A — with the blueprint:
1. Render dashboard → **New → Blueprint** → pick your repo. `render.yaml` defines
   the service (name `mobcode`, `plan: free`, health check `/health/keepalive`).
2. Fill the `sync: false` env vars when prompted:
   - `ENGINE_PASSWORD` (your random string)
   - provider keys (only those you actually use)

Option B — manually:
1. **New → Web Service** → connect repo → runtime **Docker**.
2. **Plan: Free.** Health check path: `/health/keepalive`.
3. Env vars (dashboard): `ENGINE_PASSWORD`, provider keys. Build defaults from
   the Dockerfile are already sane (`ENGINE_PORT=46000`, `MOBCODE_WORKSPACE=/app/workspace`).

First deploy builds the container: Node 22 + pinned OpenCode engine (see
`ARG OPENCODE_VERSION`).

## 3. Verify

```bash
curl -s https://<your-service>.onrender.com/health | python3 -m json.tool
# expect: { "service":"mobcode", "ok":true, "version":"1.1.0", ... }
```

Then run the stamping script — it *probes* `/health` itself and stamps only a
real Mobcode URL:

```bash
node scripts/set-production-url.mjs https://<your-service>.onrender.com
```

## 4. Free-tier facts (honest)

| Constraint | Reality measured on this project |
|---|---|
| RAM | 512 MB total budget. Measured idle: engine ≈ **141 MB** + companion ≈ **59 MB** (≈ 200 MB). During a real chat with the catalogue loaded: ≈ **243 + 62 MB (≈ 306 MB)**. Comfortably inside the limit; heavy file scans in the workspace can push it — keep the workspace lean. |
| CPU | 0.1 CPU shared. Model streaming and tool calls tolerate this; parallel heavy builds will crawl. |
| CPU hours | 750 free instance-hours/month — a single always-on service uses ~744. Keep **exactly one** web service. |
| Cold start | The free service spins down after ~15 min idle; next request takes ~50 s. Avoid via an external monitor (below) — or accept the delay. |
| Ephemeral FS | Redeploy or cold start **wipes the workspace and OpenCode session DB**. See "Persistence" below. |

## 5. Persistence (free tier)

There is **no free persistent disk** on Render and we will not sign up for paid
services. Two supported options:

1. **Git-backed workspace (recommended).** The agent's workspace `/app/workspace`
   starts empty; the *user* clones their repo into it through the app (or the
   agent does `git clone` in-session), and pushes results back out. Nothing
   durable stays on the instance, so treat the remote as the store.
2. **Rehydrate on boot (optional).** Add `MOBCODE_WORKSPACE_GIT=<https url>` and
   (optionally) a `git` token in the dashboard; `docker/start-prod.sh` clones it
   at boot if the workspace is empty. Chat/session memory reset each deploy —
   by design, until a paid disk is approved.

> The OpenCode session store (`$XDG_DATA_HOME=/data/opencode`) is likewise
> ephemeral on free tier.

## 6. Maintenance

- **Bump the engine deliberately**: `ARG OPENCODE_VERSION` in the Dockerfile,
  e.g. `2.2.5` → `2.3.0`, then redeploy. Do not chase `latest`.
- Logs: Render dashboard → service → Logs. The companion logs engine
  connection errors explicitly.
- Secrets rotation: rotate `ENGINE_PASSWORD` in the dashboard; both the engine
  and companion read the same env, so a deploy applies it atomically.
