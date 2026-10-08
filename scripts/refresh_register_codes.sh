#!/usr/bin/env bash
# Replaces dead (used/expired) registration codes in the register-page dropdown
# with fresh single-use codes, and updates frontend/js/register.js to match.
# Needs the backend running (./start.sh) and ADMIN_TOKEN in backend/.env
# (read from the file, never printed).
#
#   cd ~/heat-relief-network
#   DRY_RUN=1 ./scripts/refresh_register_codes.sh     # just show which codes are dead
#   ./scripts/refresh_register_codes.sh               # replace the dead ones
#   REFRESH_ALL=1 ./scripts/refresh_register_codes.sh # replace all 8
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f backend/.env ]; then
  echo "backend/.env not found - run this from the heat-relief-network project." >&2
  exit 1
fi

_keep_api="${API_BASE:-}"; _keep_days="${EXPIRES_IN_DAYS:-}"; _keep_dry="${DRY_RUN:-}"
_keep_all="${REFRESH_ALL:-}"; _keep_js="${REGISTER_JS:-}"; _keep_out="${OUT_DIR:-}"
set -a
source backend/.env
set +a
[ -n "$_keep_api" ] && export API_BASE="$_keep_api"
[ -n "$_keep_days" ] && export EXPIRES_IN_DAYS="$_keep_days"
[ -n "$_keep_dry" ] && export DRY_RUN="$_keep_dry" || unset DRY_RUN
[ -n "$_keep_all" ] && export REFRESH_ALL="$_keep_all" || unset REFRESH_ALL
[ -n "$_keep_js" ] && export REGISTER_JS="$_keep_js" || unset REGISTER_JS
[ -n "$_keep_out" ] && export OUT_DIR="$_keep_out" || unset OUT_DIR

node scripts/refresh_register_codes.js
