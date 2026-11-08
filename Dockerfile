# Mobcode production image (Render Free compatible: single container, ~512 MB budget)
# Runs TWO processes in one container:
#   1. OpenCode engine (pinned version) on 127.0.0.1:$ENGINE_PORT
#   2. Mobcode companion (server.js) on 0.0.0.0:$PORT  <- what the internet reaches
#
# Build/run docs: see DEPLOYMENT.md
FROM node:22-alpine

# Pinned engine version — bump deliberately, never "latest"
ARG OPENCODE_VERSION=2.2.5

# Engine + tool deps. bash is required by the opencode installer.
RUN apk add --no-cache curl bash git ca-certificates tini

# OpenCode engine (official installer, pinned, PATH-adjusted).
# The installer is a Bash script (`set -euo pipefail`); Alpine's BusyBox `sh`
# chokes on it (line 397 taps $SHELL, unset in builds). Run it via bash and
# export SHELL explicitly: bash only emulates $SHELL on login shells.
RUN curl -fsSL https://opencode.ai/v2/install -o /tmp/oc-install \
    && SHELL=/bin/bash bash /tmp/oc-install --version "$OPENCODE_VERSION" --no-modify-path \
    && rm -f /tmp/oc-install
ENV PATH=/root/.opencode/bin:$PATH

WORKDIR /app

# Companion + app shell (public/ ships inside the container)
COPY server.js package.json ./
COPY public ./public
COPY docker/start-prod.sh ./start-prod.sh
RUN chmod +x start-prod.sh

# Engine refuses to phone home for updates in a frozen image
ENV OPENCODE_DISABLE_AUTOUPDATE=1

# Engine data (~/.local/share/opencode) stays inside the container FS:
# on Render Free this is EPHEMERAL (see DEPLOYMENT.md — Git-backed persistence).
ENV HOME=/data
ENV XDG_DATA_HOME=/data/opencode
ENV XDG_STATE_HOME=/data/opencode/state
ENV XDG_CACHE_HOME=/data/opencode/cache
RUN mkdir -p /data/opencode /app/workspace

# Render injects $PORT. ENGINE_* are ours. ENGINE_PASSWORD MUST be set in the
# dashboard (a fixed password lets server.js inject Basic auth for the engine).
ENV PORT=8090 \
    ENGINE_PORT=46000 \
    ENGINE_HOST=127.0.0.1 \
    MOBCODE_WORKSPACE=/app/workspace

EXPOSE 8090

HEALTHCHECK --interval=60s --timeout=8s --start-period=40s CMD wget -qO- http://127.0.0.1:${PORT}/health/keepalive || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./start-prod.sh"]
