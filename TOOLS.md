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

- **PostgreSQL 17+** — stores sites, orgs, alerts, volunteers, inventory,
  etc. Can run locally or on a managed host (e.g. Supabase, RDS, Railway).
  **Must be 17 or newer**: Homebrew's `postgis` package (as of this
  writing) only ships extension files for Postgres 17/18, so a Postgres 16
  install will fail with `extension "postgis" is not available` even
  though the `postgis` formula itself is installed. If you're on Homebrew
  Postgres 16, switch with:
  ```bash
  brew install postgresql@17
  brew services stop postgresql@16
  brew services start postgresql@17
  echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zprofile
  source ~/.zprofile
  ```
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

- **macOS Terminal + Homebrew** — `brew install node`, `brew install
  postgresql@16 postgis`, `brew services start postgresql@16`. Xcode
  Command Line Tools provide `git`.
- **Git + GitHub** — version control. Repo:
  `github.com/jwhawkins68/heat-relief-network`, using a
  main/develop/feature-branch/PR workflow.

## AI / priority-area matching feature

- **Custom rule-based scoring function** (`backend/src/services/riskScore.js`)
  — a lightweight, transparent "heat vulnerability index" (weighted
  composite of heat index + demographic factors), not a trained model.
  No new runtime dependency — plain JS.
- **Not yet used, but the planned upgrade path once real outcome data
  exists:** a small trained model (scikit-learn or LightGBM/XGBoost
  gradient-boosted tree trained in Python) exported to **ONNX** and run in
  Node via `onnxruntime-node` — or its logic translated directly into the
  same scoring function if it stays simple enough (e.g. logistic
  regression coefficients).

## Planned but not yet wired in (stubbed in the code)

- **Twilio** — SMS alert notifications (Phase 1+, see `.env.example`).
- **Firebase Cloud Messaging (FCM)** — push notifications (Phase 1+).
- **National Weather Service API** (`api.weather.gov`) — source for real
  heat alerts; no API key required, just a contact email in the request
  header.
- **Auth provider** — nothing chosen yet; needed before the org/admin
  portal can have real logins.

---
*Last updated: 2026-09-11*
