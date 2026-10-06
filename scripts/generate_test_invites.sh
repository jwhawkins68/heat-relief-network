#!/usr/bin/env bash
# Generates one test "priority access" invite code per seeded cooling center.
# Run this from your own Mac terminal (not from Claude) — it needs your
# running backend on localhost:4000 and the ADMIN_TOKEN in backend/.env.
#
# Usage:
#   cd ~/heat-relief-network
#   ./scripts/generate_test_invites.sh
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
source backend/.env
set +a

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "ADMIN_TOKEN not found in backend/.env - is the backend set up?" >&2
  exit 1
fi

ORG_ID="c1335a41-dc02-4d0f-8a29-f1398bd955df"
API_BASE="http://localhost:4000"
EXPIRES_IN_DAYS=14

# label|city  (the 8 cooling_center sites from backend/src/db/seed_sites.sql)
SITES=(
  "Sunnyside Community Center & Park|Houston"
  "Park Place Regional Library|Houston"
  "Young Neighborhood Library|Houston"
  "Martin Luther King Jr. Branch Library|Dallas"
  "Ella Mae Shamblee Library|Fort Worth"
  "Southeast Branch Library|Austin"
  "Dottie Jordan Recreation Center|Austin"
  "BiblioTech West|San Antonio"
)

printf "%-42s %-14s %s\n" "COOLING CENTER" "CITY" "INVITE CODE"
printf '%s\n' "--------------------------------------------------------------------------"

for entry in "${SITES[@]}"; do
  label="${entry%%|*}"
  city="${entry##*|}"
  full_label="${label} (${city}) - priority access test"

  body=$(node -e "console.log(JSON.stringify({org_id: process.argv[1], issued_to_label: process.argv[2], expires_in_days: Number(process.argv[3])}))" \
    "${ORG_ID}" "${full_label}" "${EXPIRES_IN_DAYS}")

  response=$(curl -sS -X POST "${API_BASE}/api/invites" \
    -H "Content-Type: application/json" \
    -H "x-admin-token: ${ADMIN_TOKEN}" \
    -d "${body}")

  code=$(node -e "
    try {
      const r = JSON.parse(process.argv[1]);
      console.log(r.code || ('ERROR: ' + (r.error || 'unknown response')));
    } catch (e) {
      console.log('ERROR: could not parse response');
    }
  " "${response}")

  printf "%-42s %-14s %s\n" "${label}" "${city}" "${code}"
done

echo
echo "Each code is single-use, expires in ${EXPIRES_IN_DAYS} days, and can be entered"
echo "on the priority-access step of register.html to test that flow end to end."
