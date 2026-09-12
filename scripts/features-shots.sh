#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
data="$(mktemp -d /tmp/mnote-features-XXXX)"
port="${MNOTE_FEATURES_PORT:-3010}"
url="http://127.0.0.1:${port}"
api_pid=""

cleanup() {
  if [ -n "${api_pid}" ]; then kill "${api_pid}" 2>/dev/null || true; fi
  rm -rf "${data}"
}
trap cleanup EXIT INT TERM

cd "${root}"

if [ ! -d web/node_modules/@playwright/test ]; then
  npm --prefix web ci
fi
if [ ! -d web/node_modules/@playwright/test ]; then
  echo "Playwright is not installed" >&2
  exit 1
fi

npm --prefix web exec playwright install chromium

if [ ! -f web/dist/index.html ]; then
  (cd web && npx vite build)
fi

cargo run --quiet -- --data "${data}" user add visual --password password1
MNOTE_WEB_DIST="${root}/web/dist" cargo run --quiet -- --data "${data}" serve --bind "127.0.0.1:${port}" &
api_pid=$!

for _ in $(seq 1 150); do
  if curl --fail --silent "${url}/api/health" >/dev/null; then
    break
  fi
  sleep 0.2
done
curl --fail --silent "${url}/api/health" >/dev/null

MNOTE_FEATURES_URL="${url}" node web/scripts/features-shots.mjs
