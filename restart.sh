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

# The stop logic lives in stop.sh so the two scripts can't drift apart.
source ./stop.sh

echo ""
echo "=== Restarting Heat Relief Network ==="
echo ""

hrn_stop_all

echo ""
echo "==> Starting fresh (backend/.env will be re-read now) ..."
echo ""

exec ./start.sh
