#!/usr/bin/env bash
# Restarts the Heat Relief Network backend + frontend.
# Usage: ./restart.sh   (from the project root)
# Stop both with Ctrl+C, same as start.sh.
#
# WHY THIS EXISTS: `npm run dev` runs `node --watch`, which reloads when a JS
# file changes but NOT when backend/.env changes — and dotenv only reads .env
# once, at startup. So after editing ADMIN_TOKEN, DATABASE_URL or an API key,
# the running server keeps the old values and the change looks like it didn't
# work. This stops whatever is holding ports 4000/3000 and starts clean.

set -e
cd "$(dirname "$0")"

BACKEND_PORT=4000
FRONTEND_PORT=3000

stop_port() {
  local port="$1" label="$2" pids pid cmd i
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)

  if [ -z "$pids" ]; then
    echo "==> Nothing listening on port $port ($label)"
    return
  fi

  for pid in $pids; do
    cmd=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
    echo "==> Stopping $label — pid $pid ($cmd)"
    kill "$pid" 2>/dev/null || true
  done

  # Give them a moment to exit cleanly before escalating.
  for i in 1 2 3 4 5 6; do
    sleep 0.4
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    [ -z "$pids" ] && break
  done

  if [ -n "$pids" ]; then
    echo "    didn't exit cleanly — forcing"
    for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
    sleep 0.5
  fi
}

echo ""
echo "=== Restarting Heat Relief Network ==="
echo ""

stop_port "$BACKEND_PORT" "backend"
stop_port "$FRONTEND_PORT" "frontend"

echo ""
echo "==> Starting fresh (backend/.env will be re-read now) ..."
echo ""

exec ./start.sh
