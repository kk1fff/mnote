#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

kill_port() {
  local pids
  pids="$(lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
  fi
}

kill_port 3000
kill_port 5173

for _ in 1 2 3 4 5; do
  if lsof -tiTCP:3000 -sTCP:LISTEN >/dev/null 2>&1 || lsof -tiTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
    sleep 0.2
  else
    break
  fi
done

cargo run -- --data data serve &
api=$!
npm --prefix web run dev &
web=$!

trap 'kill "$api" "$web" 2>/dev/null || true' EXIT INT TERM
wait
