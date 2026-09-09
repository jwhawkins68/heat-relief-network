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

1. Start the backend first (see the root README) — it needs to be
   reachable at the URL in `js/config.js` (defaults to
   `http://localhost:4000`) and already has CORS enabled.
2. Serve this folder as static files — any static server works, e.g.:

   ```bash
   npx serve .
   # or
   python3 -m http.server 5173
   ```

3. Open `index.html` (resident view) or `admin.html` (org portal) in the
   browser.

There's no bundler/npm install here on purpose, to keep the scaffold easy
to run and inspect. If this grows past a few pages, moving to a small
bundler (Vite, esbuild) is a reasonable next step.

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
