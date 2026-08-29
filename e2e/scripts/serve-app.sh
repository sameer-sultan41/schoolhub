#!/usr/bin/env bash
#
# Build one Next app and serve it the way production does.
#
# Both apps set `output: "standalone"` for the Docker image, and `next start` does not
# serve that output — it prints "Ready" and then answers nothing, which shows up as a
# Playwright `webServer` timeout rather than an obvious error. So run the standalone
# server directly, exactly as the Dockerfile's CMD does.
#
# Usage: serve-app.sh <dashboard|website> <port>
set -euo pipefail

app="${1:?usage: serve-app.sh <app> <port>}"
port="${2:?usage: serve-app.sh <app> <port>}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

pnpm turbo run build --filter="@schoolhub/${app}"

# `outputFileTracingRoot` is the workspace root, so standalone preserves the apps/<name>
# path inside itself — same reason the Dockerfile runs `node apps/<name>/server.js`.
standalone="apps/${app}/.next/standalone/apps/${app}"

# standalone contains the server and its traced dependencies only; static assets and
# public files are copied alongside it (nextjs.org/docs/app/api-reference/config/next-config-js/output).
rm -rf "${standalone}/.next/static" "${standalone}/public"
cp -R "apps/${app}/.next/static" "${standalone}/.next/static"
if [ -d "apps/${app}/public" ]; then
  cp -R "apps/${app}/public" "${standalone}/public"
fi

# Bind IPv4-any. Two other bindings were tried and both left the probe refused:
#   HOSTNAME=127.0.0.1  → loopback only; a probe that resolved to ::1 could not connect
#   HOSTNAME=::         → bound IPv6 ("Local: http://[::1]:3000"), leaving IPv4 refused
# 0.0.0.0 is reachable at 127.0.0.1 on every Linux runner, and the readiness probe in
# playwright.config.ts dials that address literally rather than resolving a name.
exec env PORT="$port" HOSTNAME=0.0.0.0 node "${standalone}/server.js"
