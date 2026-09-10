#!/usr/bin/env bash
set -euo pipefail

run_e2e() {
  local output
  output="$(mktemp)"
  if ! "$@" 2>&1 | tee "$output"; then
    rm -f "$output"
    return 1
  fi
  if grep -Eq '[0-9]+ skipped' "$output"; then
    rm -f "$output"
    echo "E2E tests must not be skipped in the container" >&2
    return 1
  fi
  rm -f "$output"
}

wait_for() {
  local url="$1"
  for _ in $(seq 1 150); do
    if curl --fail --silent "$url" >/dev/null; then
      return
    fi
    sleep 0.2
  done
  echo "Timed out waiting for ${url}" >&2
  return 1
}

cleanup_visual() {
  if [ -n "${vite_pid:-}" ]; then kill "$vite_pid" 2>/dev/null || true; fi
  if [ -n "${api_pid:-}" ]; then kill "$api_pid" 2>/dev/null || true; fi
  if [ -n "${visual_data:-}" ]; then rm -rf "$visual_data"; fi
}

restore_artifact_ownership() {
  if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
    if [ -d /workspace/web/artifacts ]; then
      chown -R "${HOST_UID}:${HOST_GID}" /workspace/web/artifacts || true
    fi
    if [ -d /workspace/desktop/artifacts ]; then
      chown -R "${HOST_UID}:${HOST_GID}" /workspace/desktop/artifacts || true
    fi
  fi
}

cleanup() {
  cleanup_visual
  restore_artifact_ownership
}

trap cleanup EXIT INT TERM

npm --prefix web ci
npm --prefix desktop ci

cargo test
cargo clippy --all-targets -- -D warnings
npm --prefix web test
npm --prefix web run test:coverage
npm --prefix web run typecheck
run_e2e npm --prefix web run test:e2e

cargo build --release
npm --prefix web run build
npm --prefix desktop run build
npm --prefix desktop run dist:linux
run_e2e xvfb-run -a npm --prefix desktop test -- e2e/full.spec.ts e2e/remote.spec.ts
run_e2e env MNOTE_PACKAGED=1 xvfb-run -a npm --prefix desktop test -- e2e/packaged.spec.ts
xvfb-run -a npm --prefix desktop run visual:review

visual_data="$(mktemp -d)"
cargo run -- --data "$visual_data" user add visual --password password1
MNOTE_WEB_DIST=/workspace/web/dist cargo run -- --data "$visual_data" serve --bind 127.0.0.1:3000 &
api_pid=$!
npm --prefix web run dev -- --host 127.0.0.1 &
vite_pid=$!
wait_for http://127.0.0.1:3000/api/health
wait_for http://127.0.0.1:5173
npm --prefix web run visual:review
