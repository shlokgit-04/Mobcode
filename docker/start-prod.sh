#!/bin/sh
# Mobcode production startup: OpenCode engine (loopback) + companion (public).
#   $OPENCODE_SERVER_PASSWORD  -> also handed to server.js as --password below
#   Provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...) come from the
#   Render dashboard env; the engine reads them directly, **never hardcode**.
set -eu

PORT="${PORT:-8090}"
ENGINE_PORT="${ENGINE_PORT:-46000}"
ENGINE_HOST="${ENGINE_HOST:-127.0.0.1}"
WORKSPACE="${MOBCODE_WORKSPACE:-/app/workspace}"

if [ -z "${ENGINE_PASSWORD:-}" ]; then
  echo "FATAL: ENGINE_PASSWORD is not set. Add it in the Render dashboard (Secret Files or env)."
  echo "       The same value lets Mobcode authenticate to its own engine over loopback."
  exit 1
fi

[ -d "$WORKSPACE" ] || mkdir -p "$WORKSPACE"

# Optional boot-time workspace rehydration (DEPLOYMENT.md §5). The repo URL and
# token always come from the dashboard — never bake them into the image.
if [ -n "${MOBCODE_WORKSPACE_GIT:-}" ] && [ -z "$(ls -A "$WORKSPACE" 2>/dev/null)" ]; then
  git_config_args=""
  if [ -n "${MOBCODE_WORKSPACE_GIT_TOKEN:-}" ]; then
    echo "[start-prod] workspace: cloning (authenticated)"
    git_config_args="x-access-token:${MOBCODE_WORKSPACE_GIT_TOKEN}"
  else
    echo "[start-prod] workspace: cloning (public repo)"
  fi
  clone_url=$(echo "${MOBCODE_WORKSPACE_GIT}" | sed "s#https://#${git_config_args:+https://${git_config_args}@}#")
  git clone "$clone_url" "$WORKSPACE" \
    || echo "[start-prod] WARN: workspace clone failed — starting with an empty workspace"
  unset clone_url
fi
unset -v git_config_args 2>/dev/null || true

if ! command -v opencode >/dev/null 2>&1; then
  echo "FATAL: opencode engine not on PATH (image build must pin OPENCODE_VERSION)."
  exit 1
fi

echo "[start-prod] starting engine on ${ENGINE_HOST}:${ENGINE_PORT}"
export OPENCODE_SERVER_PASSWORD="$ENGINE_PASSWORD"
export OPENCODE_DISABLE_AUTOUPDATE=1
# engine may spawn heavy tool children; keep core dumps off
ulimit -c 0 2>/dev/null || true

opencode serve \
  --hostname "$ENGINE_HOST" \
  --port "$ENGINE_PORT" &
ENGINE_PID=$!

# engine readiness: TCP probe (engine has no /health of its own at this layer)
i=0
until node -e 'const n=require("net");const s=n.connect(Number(process.argv[2]),process.argv[1]);s.on("connect",()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),900)' "$ENGINE_HOST" "$ENGINE_PORT" 2>/dev/null; do
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    echo "FATAL: engine exited during startup (check logs above: bad provider env?)"
    exit 1
  fi
  i=$((i+1))
  if [ "$i" -ge 120 ]; then
    echo "FATAL: engine did not open $ENGINE_HOST:$ENGINE_PORT in 60s"
    exit 1
  fi
  sleep 0.5
done
echo "[start-prod] engine ready (pid $ENGINE_PID)"

echo "[start-prod] starting companion on 0.0.0.0:${PORT}"
node server.js \
  --port "$PORT" \
  --open "http://127.0.0.1:$ENGINE_PORT" \
  --password "$ENGINE_PASSWORD" \
  --directory "$WORKSPACE" --quiet &
COMPANION_PID=$!

term() {
  echo "[start-prod] shutting down"
  kill -TERM "$COMPANION_PID" "$ENGINE_PID" 2>/dev/null || true
  exit 0
}
trap term INT TERM

while kill -0 "$ENGINE_PID" 2>/dev/null && kill -0 "$COMPANION_PID" 2>/dev/null; do
  sleep 5
done
echo "FATAL: a process exited; see logs above (Render will restart the service)."
term
