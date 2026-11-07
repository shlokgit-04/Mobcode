# Keeping Render free tier awake — external keep-alive

## Why

Render's free plan spins the service down after ~15 minutes without inbound
HTTP. The next request then pays a ~50 s cold start. Mobcode stays awake with
**one cheap external monitor** hitting a purpose-built endpoint:

```
GET /health/keepalive   →   200 {"ok":true,"ts":<epoch-ms>}
```

Properties (all verified in `server.js`):

- **No secrets** — response contains only `ok` + a timestamp; safe to expose.
- **No engine calls** — the endpoint never touches the OpenCode engine, so it
  stays cheap and fast regardless of engine state.
- Cache headers `no-store` so monitors can't cache a failure.
- **The server never pings itself** — a self-ping loop inside the container
  does not keep Render awake and would burn cycles pointlessly.

## Setup with an external monitor

Any free uptime monitor that pings HTTPS every 5–14 minutes works.

### cron-job.org (free, no signup card)
1. Create an account → **Cronjobs → Create cronjob**.
2. Title: `Mobcode keepalive`.
3. URL: `https://<your-service>.onrender.com/health/keepalive`
4. Schedule: **every 5 minutes** (Render charges only while the service is up;
   5-min pings are the usual cadence people use for free tiers).
5. Save, run once, and confirm the execution log shows `HTTP 200`.

### UptimeRobot (free tier)
1. New monitor → type **HTTP(s)**.
2. URL: same endpoint as above.
3. Interval: 5 min (UptimeRobot free minimum).
4. Confirm status turns **Up** and the response body contains `"ok":true`.

> Use **only one** monitor service. Two monitors do not help and doubles pointless traffic.

## Verifying the endpoint manually

```bash
curl -i https://<your-service>.onrender.com/health/keepalive
# HTTP/1.1 200 OK
# {"ok":true,"ts":1712792160000}

curl -s https://<your-service>.onrender.com/health | python3 -m json.tool
# service: "mobcode"  memoryRssBytes ~ 62MB (companion only)
```

## Monitoring budget reality

| Thing | Free-tier usage |
|---|---|
| 1 web service, always awake | ≈ 744 instance-hours of 750 free/month — fits |
| The keepalive endpoint | negligible CPU (~50 µs); no engine I/O |
| Extra services (e.g. a second DB service) | would void the hour budget — do **not** create |

## If you do NOT want polls

Then the service sleeps; first tap on the phone app pays the ~50 s cold start.
Everything else works exactly the same.
