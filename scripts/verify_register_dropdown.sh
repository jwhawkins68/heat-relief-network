#!/usr/bin/env bash
# Read-only check of the register-page dropdown against the REAL backend and
# database. It never consumes a code (it only calls GET /api/invites/:code/validate).
# Run from your Mac terminal with ./start.sh already running:
#   cd ~/heat-relief-network && ./scripts/verify_register_dropdown.sh
# Writes the result to "Claude outputs/verify_register_dropdown.txt".
set -uo pipefail
cd "$(dirname "$0")/.."

API="${API_BASE:-http://localhost:4000}"
WEB="${WEB_BASE:-http://localhost:3000}"
OUT="Claude outputs/verify_register_dropdown.txt"
mkdir -p "Claude outputs"
pass=0; fail=0
{
  echo "HeatSafe register dropdown check - $(date)"
  echo "API=$API  WEB=$WEB"
  echo

  # 1. servers up
  for u in "$API/api/health" "$WEB/register.html"; do
    c=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$u" || true)
    echo "server  $u -> $c"
  done
  echo

  # 2. page serves the dropdown
  page=$(curl -sL -m 5 "$WEB/register.html" || true)
  if echo "$page" | grep -q '<select id="invite_code"'; then echo "PASS  register.html serves the <select id=invite_code> dropdown"; pass=$((pass+1)); else echo "FAIL  register.html does not contain the dropdown"; fail=$((fail+1)); fi
  echo

  # 3. each dropdown code against the real database (codes read from register.js)
  echo "code      http  result"
  grep -oE "code: '[A-Z0-9]{8}'" frontend/js/register.js | grep -oE "[A-Z0-9]{8}" | while read -r code; do
    body=$(curl -s -m 5 -w '\n%{http_code}' "$API/api/invites/$code/validate" || true)
    status=$(echo "$body" | tail -n1); json=$(echo "$body" | sed '$d')
    reason=$(echo "$json" | grep -oE '"reason":"[a-z_]+"' | cut -d'"' -f4)
    case "$status" in
      200) echo "PASS  $code  200  valid (usable)";;
      409) echo "NOTE  $code  409  ${reason:-already used/expired} (dropdown will grey this out - expected if already registered)";;
      404) echo "FAIL  $code  404  not in the real database - re-issue this code or fix the dropdown";;
      *)   echo "FAIL  $code  $status  backend not answering / error: $json";;
    esac
  done
  echo
  echo "Done. Send this file (or its contents) back to Claude."
} | tee "$OUT"
