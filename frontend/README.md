# Heat Relief Network — Frontend

Plain HTML/CSS/JS (no build step) wired to the real backend API. Replaces
the earlier mock-data prototype.

- `index.html` — resident-facing view: filterable site search (type,
  radius, open-only), a Leaflet map with pins, a synced list, per-site
  detail (inventory) on click, and a regional heat-alert banner.
- `admin.html` — org portal: loads an org's sites by org ID and lets you
  update each site's status (open/closed/full/unknown).
- `js/config.js` — the one thing you'll likely need to edit: `API_BASE`.
- `js/api.js` — all `fetch()` calls to the backend, one function per
  endpoint.
- `js/app.js`, `js/admin.js` — page logic.

## Running it

From the repository root, run:

```bash
docker compose -f docker-compose.base44.yml up -d
```

Open `http://localhost:3000/` (resident view) or
`http://localhost:3000/admin.html` (org portal). Compose starts PostGIS,
initializes the schema and example priority areas on a fresh database,
then starts the API and frontend with live reload. No sites are seeded.

The frontend remains plain HTML/CSS/JS. Vite provides a development server
and proxies `/api` to the backend at `api:4000`, so `js/config.js` uses the
same origin instead of a browser-local backend URL. Production hosting
must likewise route `/api` to the backend, or configure `API_BASE` for its
API origin.

## What's wired up vs. still stubbed

- **Real / runnable:** site search + filters, map pins (uses `lat`/`lon`
  now returned by `GET /api/sites` and `GET /api/sites/:id` — see the
  small backend change below), site detail with inventory, regional
  alerts banner, org status updates.
- **Backend change made alongside this scaffold:** `GET /api/sites` and
  `GET /api/sites/:id` previously returned only a raw PostGIS `location`
  column with no plain `lat`/`lon`, so the map had nothing to plot. Both
  routes in `backend/src/routes/sites.js` now also select
  `ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat`.
- **Stubbed / TODO:**
  - No auth — the admin portal takes a raw org ID with no login. Once
    backend auth exists, replace the org-id field in `admin.html` with
    the logged-in org's session, and pass the real user id as
    `updated_by` in `js/admin.js` (currently sent as `null`).
  - The alert banner requires typing a region name that matches what's
    stored in the `alerts.region` column (e.g. an NWS zone or city name)
    — there's no geocoding from lat/lon to a region yet.
  - No offline/SMS-first experience for the "anonymous, phone-based"
    users the schema anticipates (`users.phone`, `notify_sms`) — this is
    a map/web view only.
