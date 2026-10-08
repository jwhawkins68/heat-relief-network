# Tools & Environments — HeatSafe

A running list of everything this project uses, so it's easy to remember what
needs to be installed/running and why. Updated as the project grows.

> The product is **HeatSafe**. The repo, package, and database are still named
> `heat-relief-network` — the original project name, kept for continuity.

## Runtime / language

- **Node.js 18+** (+ **npm**, bundled with it) — runs the backend server and
  manages its packages. Needed on your machine to run `npm install` /
  `npm run dev`. Get it from [nodejs.org](https://nodejs.org) (LTS version).
  We use ESM (`"type": "module"`) and top-level `await` in the agent scripts,
  so an older Node will not run them.

## Backend (in `backend/`)

- **Express** — the web framework that defines the API routes.
- **pg** (`node-postgres`) — lets the backend talk to the Postgres database.
- **cors** — allows the frontend (running on a different port) to call the
  API without the browser blocking it.
- **dotenv** — loads settings (like the database URL and `ADMIN_TOKEN`) from a
  `.env` file. **Read once, at startup** — see the gotcha below.
- **`node:test`** — the test runner, built into Node. No Jest, no Mocha, no new
  dependency. `npm test --prefix backend`.
- **`node:crypto`** — timing-safe token comparison in `requireAdmin.js`. Also
  built in.

That is the entire dependency list: four runtime packages, zero dev
dependencies. It has stayed that way on purpose.

### The `.env` gotcha that cost us an afternoon

`dotenv` reads `.env` exactly once, when the process boots. `node --watch`
(what `npm run dev` uses) watches **imported JS modules**, not `.env`. So
adding `ADMIN_TOKEN` to a running server does nothing, and the admin portal
keeps returning `503 Admin access is not configured`. **Restart the backend
after any `.env` change.** `./restart.sh` exists for this.

## Database

- **PostgreSQL 17+** — stores sites, orgs, alerts, areas, invites, residents,
  volunteers, shifts. Can run locally or on a managed host (Supabase, RDS,
  Railway).
  **Must be 17 or newer**: Homebrew's `postgis` package only ships extension
  files for Postgres 17/18, so a Postgres 16 install fails with
  `extension "postgis" is not available` even though the `postgis` formula
  itself is installed. If you're on Homebrew Postgres 16:
  ```bash
  brew install postgresql@17
  brew services stop postgresql@16
  brew services start postgresql@17
  echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zprofile
  source ~/.zprofile
  ```
- **PostGIS** (a Postgres extension) — location/distance features. We use
  `ST_DWithin` for radius search, `ST_Distance` on `geography` for real-world
  metres, and the `<->` KNN operator with a GIST index for nearest-site
  lookups.

## Frontend (in `frontend/`)

- **Plain HTML/CSS/JavaScript** — no framework and no build step, by design.
  The team discussed React/JSX; the decision and its cost are recorded in
  `PROJECT_STATUS.md`.
- **Leaflet.js** — draws the interactive map and pins. Loaded from a CDN
  (`unpkg.com`) in `index.html`.
- **OpenStreetMap** — the free map tiles Leaflet displays (no API key needed).
- A static file server for local preview — `./start.sh` handles this; `npx
  serve` or `python3 -m http.server` also work. Not a permanent dependency.

### Search radius — a defect worth not repeating

The radius field was a `<input type="number" min="500" step="1000">` with a
default of `40000`. HTML5 step validation accepts only values on the
`min + n × step` sequence — 40000 is not one of them, so the input was
*silently invalid* and blocked form submission with no visible error. It is now
a `<select>` with four fixed options in **miles** (5 / 10 / 25 / 50), which is
both correct and a better question to ask a resident than "how many metres?"

## Local run scripts

- **`start.sh`** — starts backend and frontend.
- **`stop.sh`** — owns `hrn_stop_port()` / `hrn_stop_all()`, guarded by
  `if [ "${BASH_SOURCE[0]}" = "${0}" ]` so it can be either run or sourced.
- **`restart.sh`** — `source ./stop.sh` then `exec ./start.sh`. It does not
  duplicate the stop logic; there is one definition of "stop" in the repo.

All three have Desktop shortcuts on the dev machine.

## Local dev environment

- **macOS Terminal + Homebrew** — `brew install node`,
  `brew install postgresql@17 postgis`, `brew services start postgresql@17`.
  Xcode Command Line Tools provide `git`.
  - **zsh gotcha:** `INTERACTIVE_COMMENTS` is **off** by default in
    interactive zsh, so `#` is *not* a comment at the prompt, and an apostrophe
    in pasted prose opens a quote continuation (`dquote>`). Paste bare commands
    only — never commands with trailing explanatory comments.
- **Git + GitHub** — version control. Repo:
  `github.com/jwhawkins68/heat-relief-network`, main/develop/feature-branch/PR
  workflow.
- **Jira (Atlassian) MCP connector** — as of 2026-09-15, Claude Code sessions
  have a live, authenticated connector to `pvamu-heatsafe.atlassian.net`
  (project `SCRUM`) and can read the board and update issue status/comments
  directly, instead of only reporting "board not checked." Still governed by
  the `scrum-master` agent's rule: never invent Jira state, and never mark
  something Done without independent verification.
  - Valid issue types are **Epic / Story / Task / Subtask** only. There is no
    Bug type; defects are filed as Tasks prefixed `DEFECT —`.
  - Transition IDs: 11 = To Do, 21 = In Progress, 31 = In Review, 41 = Done.

## Access control

- **Shared organization token (`ADMIN_TOKEN`)** — an env-only secret checked by
  `backend/src/middleware/requireAdmin.js` with a timing-safe compare, sent by
  the frontend as the `x-admin-token` header and held in `sessionStorage` for
  the tab only. Gates site management, invite issuing, the resident priority
  queue, and **all three agent endpoints**. Added 2026-09-15 as a deliberate
  stopgap so resident PII isn't world-readable; **not** per-user auth —
  that's SCRUM-53. No new dependency: `node:crypto` only.
  Generate a token with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- The working token and organization UUID for this dev machine live in
  `ADMIN-ACCESS.local.md`, which is **gitignored and must stay that way**.

## Data sources

- **U.S. Census Bureau ACS 5-year API** (`api.census.gov`) — source of record
  for area population, elderly percentage, and poverty rate. No API key needed
  at this volume. Provenance and the exact queries live in
  `docs/DATA-SOURCES.md`.
- **HHS Federal Poverty Guidelines (2025)** — the income bands in
  `needScore.js` (`basePerson: 15650`, `perAdditionalPerson: 5500`).
- **NWS heat-index bands** — caution 80°F / extreme caution 90 / danger 103 /
  extreme danger 125, used unmodified in `heatWatchAgent.js`.

## Scoring functions (no new dependencies — all plain JS)

- **`riskScore.js`** — heat-vulnerability index for *areas*.
- **`needScore.js`** (SCRUM-29) — need score for *people*. Same transparent,
  rule-based philosophy applied to residents instead of places.
- **`serviceMatch.js`** — ordered rule chain matching a resident to the best
  service type. Full methodology, weights, and data-handling rules:
  `docs/NEED-SCORING.md`.

## Agents (no new dependencies — all plain JS)

Three scheduled, non-chatbot agents. Full detail in **`docs/AGENTS.md`**.

- **`heatWatchAgent.js`** — `npm run heat-watch --prefix backend`
  (`-- --dry-run` to preview). Cron every 30 min.
- **`dispatchAgent.js`** — no CLI; read-only at
  `GET /api/agents/dispatch/plan`.
- **`siteFreshnessAgent.js`** — `npm run site-freshness --prefix backend`
  (`-- --expire` to act). Cron daily.

All three are also driven from the **Agents panel** in `frontend/admin.html`.

**`cron`** is the only scheduler assumed. No queue, no worker framework, no new
infrastructure — the agents are idempotent and suppress duplicate work, so a
crontab is genuinely sufficient for the pilot.

### The planned upgrade path (not used yet)

A small trained model (scikit-learn or LightGBM/XGBoost gradient-boosted tree
trained in Python) exported to **ONNX** and run in Node via
`onnxruntime-node` — or its logic translated directly into the same scoring
function if it stays simple enough (e.g. logistic regression coefficients).
`docs/AGENTS.md` §7 lists the five things that would have to exist first.

## Planned but not yet wired in (stubbed in the code)

- **Twilio** — SMS alert notifications (see `.env.example`).
- **Firebase Cloud Messaging (FCM)** — push notifications.
- **National Weather Service API** (`api.weather.gov`) — live heat alerts; no
  API key required, just a contact email in the request header. In progress as
  SCRUM-23 on `feature/SCRUM-23-live-weather-integration`. The Heat Watch agent
  reads `areas.heat_index_f` from our own database rather than calling NWS
  directly, so it needs **no change** when this lands.
- **Auth provider** — nothing chosen yet; needed for SCRUM-53 (per-organization
  logins with change tracking). Password hashing must be **argon2id** (or
  bcrypt as a fallback), never a bare hash.

## Presentation tooling (not part of the app)

- **pptxgenjs** — builds the decks in `Claude outputs/` from scratch
  (`LAYOUT_WIDE`, 13.3 × 7.5 in). Speaker notes via
  `pres.slides[i].addNotes(text)`.
- **docx-js** — builds the presentation script document. US Letter is
  `{width: 12240, height: 15840}` DXA; tables need `columnWidths` *and*
  per-cell `width` in `WidthType.DXA`; use `ShadingType.CLEAR`, never `SOLID`;
  no `\n` in runs — use separate `Paragraph`s.
- **python-pptx** — used to edit existing `.pptx` files in place. Installed
  into a throwaway venv per session (`python3 -m venv`), never into the repo or
  system Python.
- **Visual QA pipeline** — `soffice --headless --convert-to pdf` →
  `pdftoppm -jpeg` → read the images. Every deck is checked this way before
  delivery rather than assumed correct.

> **SharePoint / OneDrive:** the decks are also hosted in the team's PVAMU
> OneDrive. There is no write-capable connector for it, so files are edited
> locally in `Claude outputs/` and uploaded manually. Confirm which copy is
> authoritative before editing — the SharePoint copies carry `_1` suffixes.

---
*Last updated: 2026-09-16*
