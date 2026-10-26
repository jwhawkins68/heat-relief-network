# Running this repo (agent notes)

Everything runs from source with live reload through
`docker-compose.base44.yml`:

```bash
docker compose -f docker-compose.base44.yml up -d --build
# frontend (resident view + org portal): http://localhost:3000
# API:                                  http://localhost:3000/api/... (proxied)
```

Services: `web` (nginx serving `frontend/` on host port 3000 and proxying
`/api/*` and `/health` to `api:4000`), `api` (`node:22-slim`, `npm ci` then
`npm run dev` = `node --watch`), `db` (`postgis/postgis:17-3.4`), and
`schema` (one-shot psql job).

## Non-obvious things

- **One origin on purpose.** The frontend is plain static HTML/JS with no
  bundler, so `frontend/js/config.js` defaults `API_BASE` to same-origin and
  nginx (`docker/base44-nginx.conf`) forwards `/api/*` to the backend. This
  is what makes the app reachable through a preview/proxy host; the old
  hardcoded `http://localhost:4000` only worked when the backend ran on the
  visitor's own machine. For a separate API host, set
  `window.HRN_API_BASE` before `config.js` loads.
- **Postgres must be 17+ with PostGIS** (`TOOLS.md`): Postgres 16 has no
  `postgis` extension files in current packages.
- **Schema is applied once.** `schema.sql` uses plain `CREATE TABLE`, so the
  `schema` service only runs it when `public.sites` is missing (and seeds
  `seed_areas.sql` only when `areas` is empty). Editing `schema.sql` on an
  existing `db_data` volume requires applying it by hand:
  `docker compose -f docker-compose.base44.yml exec -T db psql -U heat_relief -d heat_relief -f - < backend/src/db/schema.sql`
  (or drop the volume if the data does not matter).
- **Area scores need computing after seeding.** `risk_score` is stored, so
  `GET /api/risk-areas` shows priorities based only on the resource gap until
  you run `docker compose -f docker-compose.base44.yml exec -T api npm run
  recompute-risk` (or `POST /api/risk-areas/:id/recompute`).
- **No test suite.** There is no test runner or test directory; verification
  is exercising the HTTP routes (`curl localhost:3000/api/sites`,
  `/api/risk-areas`, `/api/alerts`) and the two pages.
- The resident view needs Leaflet + OSM tiles from CDNs at runtime
  (`unpkg.com`, `tile.openstreetmap.org`); with no network the map is blank
  but the list and API still work.

## Secrets

Nothing external is required to boot. Twilio (`TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) and the NWS contact email are for
stubbed/planned features only; the platform delivers any real values to
`/run/base44/app.env` (outside the repo), which is not needed for the app to
start.
