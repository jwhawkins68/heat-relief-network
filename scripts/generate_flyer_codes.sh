#!/usr/bin/env bash
# Issues a batch of single-use registration codes for every seeded cooling
# center (default 25 each = 200 codes) and saves them to a CSV in
# "Claude outputs/flyer-codes/". Run from your own Mac terminal - it needs the
# backend running on localhost:4000 and ADMIN_TOKEN in backend/.env.
# The token is read from the file and never printed.
#
# Usage:
#   cd ~/heat-relief-network
#   ./scripts/generate_flyer_codes.sh            # 25 per site, 30-day expiry
#   PER_SITE=10 EXPIRES_IN_DAYS=14 ./scripts/generate_flyer_codes.sh
#   REGISTER_BASE_URL=http://10.80.182.162:3000 ./scripts/generate_flyer_codes.sh
#
# REGISTER_BASE_URL defaults to this Mac's current Wi-Fi address on port 3000.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f backend/.env ]; then
  echo "backend/.env not found - run this from the heat-relief-network project." >&2
  exit 1
fi

# Keep any values passed on the command line; fill the rest from backend/.env
_keep_base="${REGISTER_BASE_URL:-}"; _keep_per="${PER_SITE:-}"; _keep_days="${EXPIRES_IN_DAYS:-}"
set -a
source backend/.env
set +a
[ -n "$_keep_base" ] && export REGISTER_BASE_URL="$_keep_base" || unset REGISTER_BASE_URL
[ -n "$_keep_per" ] && export PER_SITE="$_keep_per"
[ -n "$_keep_days" ] && export EXPIRES_IN_DAYS="$_keep_days"

if ! curl -sS -o /dev/null --max-time 5 "${API_BASE:-http://localhost:4000}/api/health" 2>/dev/null \
   && ! curl -sS -o /dev/null --max-time 5 "${API_BASE:-http://localhost:4000}/" 2>/dev/null; then
  echo "Backend is not answering on ${API_BASE:-http://localhost:4000} - start it with ./start.sh first." >&2
  exit 1
fi

node scripts/generate_flyer_codes.js
