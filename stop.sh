#!/usr/bin/env bash
# Stops the Heat Relief Network backend + frontend.
# Usage: ./stop.sh   (from the project root)
#
# This file is also sourced by restart.sh, so the stop logic lives in exactly
# one place and the two scripts can't drift apart.

BACKEND_PORT=4000
FRONTEND_PORT=3000

# Stop whatever is listening on a port, naming each process first so you can
# see what's being stopped rather than trusting it blindly.
hrn_stop_port() {
  local port="$1" label="$2" pids pid cmd i
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)

  if [ -z "$pids" ]; then
    echo "==> Nothing listening on port $port ($label)"
    return 0
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
  return 0
}

hrn_stop_all() {
  hrn_stop_port "$BACKEND_PORT" "backend"
  hrn_stop_port "$FRONTEND_PORT" "frontend"
}

# Run only when executed directly — not when restart.sh sources this file.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -e
  cd "$(dirname "$0")"

  echo ""
  echo "=== Stopping Heat Relief Network ==="
  echo ""

  hrn_stop_all

  echo ""
  echo "Both servers stopped."
  echo "Use the Start or Restart shortcut when you want them back."
  echo ""
fi
