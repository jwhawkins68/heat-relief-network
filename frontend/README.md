# HeatSafe — Frontend

Plain HTML/CSS/JS, no build step, wired to the real backend API.

> The product is **HeatSafe**; file and folder names still say
> `heat-relief-network` for continuity. See the root `README.md`.

## Pages

- **`index.html`** — resident view. Search relief sites by **ZIP code** or
  current location, pick a **radius in miles** (5 / 10 / 25 / 50), filter by
  type and open-only. Leaflet map with pins, synced list, per-site detail
  (inventory) on click, a regional heat-alert banner, and a toggleable
  priority-area overlay.
- **`register.html`** — invite-gated priority registration: code check →
  intake form → matched services and priority tier. Every sensitive field
  carries "why we ask" microcopy, and a consent checkbox gates the submit
  button.
- **`admin.html`** — org portal. Site status updates, the priority-area
  table, the Priority Access panel (issue/revoke invites, work the resident
  queue), and the **Agents panel**.

## Scripts

- `js/config.js` — the one thing you'll likely need to edit: `API_BASE`.
- `js/api.js` — all `fetch()` calls to the backend, one function per endpoint.
- `js/app.js` — resident map/list logic, deep links, statewide fallback.
- `js/admin.js` — org portal logic, including the agent runs.
- `js/register.js` — invite gate + intake validation.

## Running it

1. Start the backend first (see the root README) — it must be reachable at
   the URL in `js/config.js` (defaults to `http://localhost:4000`) and
   already has CORS enabled.
2. Serve this folder as static files:

   ```bash
   npx serve .
   # or
   python3 -m http.server 5173
   ```

3. Open `index.html` (resident), `register.html` (priority signup), or
   `admin.html` (org portal).

Or just run `./start.sh` from the repo root, which starts both halves.

There's no bundler or `npm install` here on purpose, to keep the scaffold
easy to run and inspect. The team discussed moving to React/JSX; the
decision and its cost are recorded in `PROJECT_STATUS.md`. If this grows
past a few pages, a small bundler (Vite, esbuild) is the reasonable step.

## The Agents panel

`admin.html` has an **Agents** panel that drives all three agents from the
browser, so a non-technical coordinator never needs a terminal:

| Button | Calls | Effect |
|---|---|---|
| Preview heat watch | `POST /api/agents/heat-watch/run?dry_run=true` | assesses and reports, **writes nothing** |
| Run heat watch | `POST /api/agents/heat-watch/run` | opens alerts, builds the contact list |
| Build outreach plan | `GET /api/agents/dispatch/plan?hours=N` | read-only plan + coverage gaps |
| Check site status freshness | `POST /api/agents/site-freshness/run` | report only |
| Retire expired claims | `POST /api/agents/site-freshness/run?expire=true` | **acts** — retires stale claims to `unknown` |

The destructive option is deliberately a separate button from the reporting
one. See `docs/AGENTS.md`.

## Admin access

The admin portal takes a **shared organization token** (`ADMIN_TOKEN`), sent
as the `x-admin-token` header and held in `sessionStorage` for that tab only
— it is never written to `localStorage` and never appears in a URL. This is a
stopgap, not per-user auth; per-organization logins are SCRUM-53.

If the portal returns **`503 Admin access is not configured on this
server`**, the backend has no `ADMIN_TOKEN` — add it to `backend/.env` and
**restart the backend**, because `.env` is read only at startup. A `401` is a
different problem: the token is configured but what you pasted doesn't match.

## What's wired up vs. still stubbed

**Real** — site search and filters, ZIP geocoding, radius in miles, map pins
(`GET /api/sites` returns `ST_X(location::geometry) AS lon,
ST_Y(location::geometry) AS lat`), site detail with inventory, alerts banner,
priority-area overlay, invite registration flow, resident queue, all three
agent panels.

**Stubbed / TODO**

- The alert banner requires typing a region name matching `alerts.region`
  (an NWS zone or county name); there's no lat/lon → region geocoding yet.
  **SCRUM-54** moves this selector into the header and loads alerts as soon
  as a county is picked, instead of waiting on a site search.
- `updated_by` is still sent as `null` from `js/admin.js`. Once SCRUM-53
  lands, pass the logged-in user's real id and replace the org-id field with
  the session's org.
- No offline/SMS-first experience for the phone-only users the schema
  anticipates (`users.phone`, `notify_sms`) — this is a web view only.

### A defect worth not repeating

The radius field used to be `<input type="number" min="500" step="1000"
value="40000">`. HTML5 step validation only accepts values on the
`min + n × step` sequence, so `40000` was **silently invalid** — the browser
refused to submit the form and showed nothing explaining why. It is now a
`<select>` with four fixed mile values. Filed as **SCRUM-49**.
