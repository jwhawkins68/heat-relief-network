# Feature verification runbook

Run this before calling a story Done, before taking demo screenshots, and before any
checkpoint presentation. Every command below has been executed against a clean
PostgreSQL + PostGIS database and the expected results are real, not guesses.

## 0. Bring the stack up

```bash
cd ~/heat-relief-network
./start.sh          # backend :4000, frontend :3000
```

## 1. Database — the three-step rule

Seeding alone is NOT enough. All three steps, in order:

```bash
psql $DATABASE_URL -f backend/src/db/schema.sql      # if starting clean
psql $DATABASE_URL -f backend/src/db/seed_areas.sql  # -> INSERT 0 5
psql $DATABASE_URL -f backend/src/db/seed_sites.sql  # -> INSERT 0 1, INSERT 0 11
npm run recompute-risk --prefix backend              # -> "Recomputed 5 area(s)."
```

Expected row counts: `orgs` 1, `sites` 11, `areas` 5.

**Skipping the recompute silently breaks the flagship feature.** Before it runs, every
area's `risk_score` is null and `/api/risk-areas` returns a flat tie
(priority 15/15/15/15/0) — the ranking looks broken and the demo is wrong. After it runs:

| Area | priority_score |
|---|---|
| 77051 — Sunnyside (Houston) | 45.6 |
| 75215 — South Dallas / Fair Park | 45.6 |
| 76104 — Near Southeast (Fort Worth) | 44.3 |
| 78724 — East Austin | 39.8 |
| 78207 — West Side (San Antonio) | 29.7 |

## 2. API smoke test

The admin routes are gated by a shared token. Set `ADMIN_TOKEN` in `backend/.env`
first — without it those routes return **503**, by design (they fail closed).

```bash
BASE=http://localhost:4000
ADMIN="-H x-admin-token:$ADMIN_TOKEN"

curl -s "$BASE/api/sites" | jq length                                  # 11
curl -s "$BASE/api/sites?lat=29.66&lon=-95.36&radius_m=25000" | jq length  # 4, nearest first
curl -s "$BASE/api/sites?type=water_station" | jq length               # 1
curl -s "$BASE/api/sites?open_only=true" | jq length                   # 0 until an admin sets a status
curl -s "$BASE/api/geocode/zip/77051" | jq .source                     # "local"
curl -s "$BASE/api/geocode/zip/10001" | jq .source                     # "zippopotam" (needs internet)
curl -s "$BASE/api/geocode/zip/abcde"                                  # 400 "Enter a 5-digit ZIP code"
curl -s "$BASE/api/risk-areas" | jq length                             # 5
curl -s "$BASE/api/risk-areas?region=Harris%20County" | jq length       # 1  (county name, exact)
curl -s "$BASE/api/risk-areas?region=Houston" | jq length               # 0  — cities are not regions, by design
curl -s "$BASE/api/alerts" | jq length                                 # 0 — no alerts seeded
```

Status update (as the admin portal calls it — `updated_by` null):

```bash
SID=$(psql $DATABASE_URL -tAc "select id from sites order by name limit 1")
curl -s -X PATCH "$BASE/api/sites/$SID/status" $ADMIN \
  -H 'Content-Type: application/json' -d '{"status":"open"}'
# -> {"id":"...","status":"open","status_updated_at":"..."}
curl -s "$BASE/api/sites?open_only=true" | jq length   # now 1
```

Note: `sites.status_updated_by` is a **uuid** column. Passing a username string returns
500. The frontend correctly sends null until org-user auth exists — don't "fix" it by
sending a name.

## 2b. Admin gate

Every org-facing route must refuse an unauthenticated caller:

```bash
for r in "/api/orgs/$OID/sites" "/api/invites" "/api/residents"; do
  printf "%-28s " "$r"; curl -s -o /dev/null -w "%{http_code}\n" "$BASE$r"   # expect 401
done
```

Guarded: org site list, site status PATCH, risk-area recompute, invite
issue/list/revoke, resident queue, resident match.
Deliberately public: site search, site detail, geocode, alerts, risk-area GET
(the resident map overlay), invite `/validate`, and resident `/register` — which is
gated by the invite code itself, not the admin token.

## 3. UI check (needs a browser)

- `http://localhost:3000` — map renders, 11 Texas pins, ZIP search re-centers the map,
  priority overlay draws.
- `http://localhost:3000/admin.html` — sign-in takes the org access token plus the org
  UUID; a wrong token is rejected and cleared. Then: priority-areas table ranks in the order above,
  status dropdown saves and the "updated" timestamp changes, recompute button works.

## Known issues (open, not blockers)

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | Malformed UUID returns **HTTP 500**, not 400/404 — `GET /api/sites/abc`, `POST /api/risk-areas/abc/recompute`. A valid-but-missing UUID correctly returns 404. | Ugly failure if anyone hand-edits a URL during a demo | Validate the UUID format, or catch Postgres error code `22P02` and return 400. ~3 lines in `routes/sites.js` and `routes/risk-areas.js`. Good first issue. |
| 2 | ~~`?region=` is exact-match~~ | **Resolved 2026-09-15** | Team decision: `region` is always a **county** name, never a city. Both UIs now offer a county picker populated from the data, so exact match is correct behaviour rather than a bug. See `docs/DATA-SOURCES.md`. |
| 3 | `alerts` table has no seed data, so the resident view's heat-alerts panel is always empty. | Any slide claiming live heat alerts has nothing behind it | Either seed demo alerts or drop the claim from the deck until SCRUM-23/24/25 land live weather. |

## Verification environment note

The results above were produced on PostgreSQL 16.13 + PostGIS 3.4. The team's machine runs
Postgres 17 + PostGIS. `schema.sql` loaded clean on both — no version-specific SQL — but
re-run the smoke test locally before a graded demo rather than trusting this file.
