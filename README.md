# Heat Relief Network

Community platform + AI agent for finding cooling centers, water stations, and
support during extreme heat. See `heat-relief-network-plan.md` (project plan)
for full architecture and roadmap.

## Repo structure

```
heat-relief-network/
├── backend/
│   ├── src/
│   │   ├── server.js          # Express app entry point
│   │   ├── db/
│   │   │   ├── schema.sql     # Postgres + PostGIS schema
│   │   │   └── pool.js        # DB connection pool
│   │   └── routes/
│   │       ├── sites.js       # site search/detail/status-update — the AI agent's core tool
│   │       ├── alerts.js      # active heat alerts by region
│   │       └── orgs.js        # org/admin-portal endpoints
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── index.html             # resident-facing map + list, wired to the real API
│   ├── admin.html             # org portal — status updates
│   ├── css/styles.css
│   ├── js/                    # config.js, api.js, app.js, admin.js
│   └── README.md              # how to run it
└── README.md
```

## Getting started (backend)

```bash
cd backend
cp .env.example .env      # fill in your local Postgres URL
npm install
psql $DATABASE_URL -f src/db/schema.sql
npm run dev
```

API will be live at `http://localhost:4000`. Try:

```bash
curl "http://localhost:4000/api/sites?lat=34.05&lon=-118.24&open_only=true"
```

## What's stubbed vs. real here

- **Real / runnable:** Express routes, PostGIS proximity query, schema,
  and a plain HTML/CSS/JS frontend (`frontend/`) wired to the live API —
  resident map + list view and an org status-update portal. See
  `frontend/README.md` for how to run it.
- **Stubbed (marked with TODO):** NWS polling job, Twilio/FCM notification
  dispatch, auth on the admin routes (the org portal currently takes a raw
  org ID with no login), volunteer-matching logic.
- **Not yet started:** offline/SMS-first flow for anonymous phone-based
  users, geocoding a resident's location to an alert region.

## Next steps (maps to Phase 1 in the project plan)

1. Stand up Postgres locally or on a managed host (e.g. Supabase, RDS) and
   run the schema.
2. Seed 10–20 real sites for your pilot area (manually is fine for MVP).
3. ~~Wire the frontend prototype to `GET /api/sites` instead of mock
   data.~~ Done — see `frontend/`.
4. Add basic auth to the org routes so partners can log in and update status.
5. Add the NWS polling job (`api.weather.gov/alerts/active?area={state}`).
