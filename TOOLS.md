# Tools & Environments — Heat Relief Network

A running list of everything this project uses, so it's easy to remember
what needs to be installed/running and why. Updated as the project grows.

## Runtime / language

- **Node.js** (+ **npm**, bundled with it) — runs the backend server and
  manages its packages. Needed on your machine to run `npm install` /
  `npm run dev`. Get it from [nodejs.org](https://nodejs.org) (LTS version).

## Backend (in `backend/`)

- **Express** — the web framework that defines the API routes
  (`/api/sites`, `/api/alerts`, `/api/orgs`).
- **pg** (`node-postgres`) — lets the backend talk to the Postgres database.
- **cors** — allows the frontend (running on a different port) to call the
  API without the browser blocking it.
- **dotenv** — loads settings (like the database URL) from a `.env` file.

## Database

- **PostgreSQL** — stores sites, orgs, alerts, volunteers, inventory, etc.
  Can run locally or on a managed host (e.g. Supabase, RDS, Railway).
- **PostGIS** (a Postgres extension) — adds location/distance features,
  used for "find sites near me" searches.

## Frontend (in `frontend/`)

- **Plain HTML/CSS/JavaScript** — no framework or build step by design.
- **Leaflet.js** — the JavaScript library that draws the interactive map
  and pins. Loaded from a CDN (`unpkg.com`) in `index.html`.
- **OpenStreetMap** — the free map tiles Leaflet displays (no API key
  needed).
- A static file server to preview the frontend locally — e.g. `npx serve`
  or Python's built-in `python3 -m http.server`. Not a permanent
  dependency, just a convenience for local testing.

## Local dev environment

- **Windows Command Prompt** — the terminal being used to run backend
  commands.

## Planned but not yet wired in (stubbed in the code)

- **Twilio** — SMS alert notifications (Phase 1+, see `.env.example`).
- **Firebase Cloud Messaging (FCM)** — push notifications (Phase 1+).
- **National Weather Service API** (`api.weather.gov`) — source for real
  heat alerts; no API key required, just a contact email in the request
  header.
- **Auth provider** — nothing chosen yet; needed before the org/admin
  portal can have real logins.

---
*Last updated: 2026-09-09*
