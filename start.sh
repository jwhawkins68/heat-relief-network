#!/usr/bin/env bash
# Starts the Heat Relief Network backend + frontend together.
# Usage: ./start.sh   (from the project root)
# Stop both with Ctrl+C.

set -e
cd "$(dirname "$0")"

echo "==> Starting backend (http://localhost:4000) ..."
(cd backend && npm run dev) &
BACKEND_PID=$!

echo "==> Starting frontend (http://localhost:3000) ..."
(cd frontend && npx serve -l 3000) &
FRONTEND_PID=$!

cleanup() {
  echo ""
  echo "==> Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo ""
echo "Both servers starting up. Give them a few seconds, then open:"
echo "  Resident view:  http://localhost:3000"
echo "  Admin portal:   http://localhost:3000/admin.html"
echo ""
echo "Press Ctrl+C to stop both."

wait
