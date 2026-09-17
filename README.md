# HeatSafe

Community platform and autonomous agents for finding cooling centers, water
stations, and support during extreme heat — and for reaching the people least
able to reach them.

Piloted against **real Texas relief sites and Census area data**. The repository,
package, and database names still say `heat-relief-network`; that is the original
project name, kept deliberately for continuity of history. **HeatSafe** is the
product name and appears everywhere a user can see it.

Built by **Team 5** for CINS 5338/5388 — Software Project Management,
Prairie View A&M University.

---

## What it does

**For residents** (`frontend/index.html`) — search relief sites by ZIP code or
current location, pick a radius in miles, see them on a map and in a list, read
active heat alerts for a county, and register for priority access with an invite
code.

**For partner organizations** (`frontend/admin.html`) — update site status,
see which areas need outreach most, issue and revoke invite codes, work the
resident priority queue, and run the three agents.

**On their own** — three agents that watch the data and act without being asked.
See **[`docs/AGENTS.md`](docs/AGENTS.md)**.

---

## Repo structure

```
heat-relief-network/
├── backend/
│   ├── src/
│   │   ├── server.js                 # Express app entry point
│   │   ├── db/
│   │   │   ├── schema.sql            # Postgres + PostGIS schema
│   │   │   ├── migration_priority_access.sql
│   │   │   ├── pool.js
│   │   │   └── seed_*.sql            # areas, sites, invites, volunteers
│   │   ├── middleware/
│   │   │   └── requireAdmin.js       # shared-token gate, fails closed
│   │   ├── services/
│   │   │   ├── riskScore.js          # heat-vulnerability score for AREAS
│   │   │   ├── needScore.js          # need score for PEOPLE
│   │   │   ├── serviceMatch.js       # resident → best service type
│   │   │   ├── zipLookup.js
│   │   │   ├── heatWatchAgent.js     # agent 1 — watches conditions, alerts
│   │   │   ├── dispatchAgent.js      # agent 2 — plans volunteer outreach
│   │   │   └── siteFreshnessAgent.js # agent 3 — judges status staleness
│   │   ├── scripts/
│   │   │   ├── recomputeAllRiskScores.js
│   │   │   ├── runHeatWatch.js
│   │   │   └── runSiteFreshness.js
│   │   └── routes/
│   │       ├── sites.js      alerts.js    orgs.js      geocode.js
│   │       ├── risk-areas.js invites.js   residents.js agents.js
│   ├── test/                         # node:test — run with `npm test`
│   └── .env.example
├── frontend/
│   ├── index.html                    # resident map + list + alerts
│   ├── register.html                 # invite-code priority registration
│   ├── admin.html                    # org portal, incl. the Agents panel
│   ├── css/styles.css
│   └── js/                           # config, api, app, admin, register
├── docs/
│   ├── AGENTS.md                     # the three agents, in full
│   ├── NEED-SCORING.md               # resident scoring methodology
│   ├── DATA-SOURCES.md               # Census/NWS provenance
│   ├── VERIFICATION.md               # what we checked and how
│   └── SPRINT-LOG.md
├── start.sh  restart.sh  stop.sh     # local run scripts (Desktop shortcuts)
├── AGILE-SCRUM.md  PROJECT_STATUS.md  TOOLS.md
└── README.md
```

---

## Getting started

Needs **PostgreSQL 17+** (see `TOOLS.md` — Homebrew's current `postgis` package
no longer ships extension files for Postgres 16, so 16 fails on
`CREATE EXTENSION postgis`).

```bash
cd backend
cp .env.example .env          # fill in your local Postgres URL and ADMIN_TOKEN
npm install

export DATABASE_URL=postgres://<your-user>@localhost:5432/heat_relief
createdb heat_relief
psql $DATABASE_URL -f src/db/schema.sql
psql $DATABASE_URL -f src/db/migration_priority_access.sql

# Seed the Texas pilot data
psql $DATABASE_URL -f src/db/seed_areas.sql
psql $DATABASE_URL -f src/db/seed_sites.sql
psql $DATABASE_URL -f src/db/seed_volunteers.sql
psql $DATABASE_URL -f src/db/seed_invites.sql

npm run recompute-risk        # compute initial area risk scores
npm run dev
```

> **`.env` is read once, at startup.** `dotenv` loads it when the process
> boots, and `node --watch` watches imported JS modules — not `.env`. If you
> add or change `ADMIN_TOKEN`, you must **restart the backend**; a running
> server will not pick it up. This is the cause of the
> "Admin access is not configured on this server" 503.

> **`$DATABASE_URL` in `.env` is not loaded into your shell.** `export` it
> yourself (as above) any time you want to run a raw `psql` command.

API is live at `http://localhost:4000`. Try:

```bash
curl "http://localhost:4000/api/sites?lat=29.76&lon=-95.37&radius_m=40234&open_only=true"
```

### Running the whole stack

```bash
./start.sh      # backend + frontend
./restart.sh    # clean stop, then start
./stop.sh       # stop everything on the project ports
```

These are also on the Desktop as shortcuts. `restart.sh` sources `stop.sh`
rather than duplicating the port-killing logic, so there is one definition of
"stop" in the repo.

---

## API

Routes marked **🔒** require the `x-admin-token` header.

| Method | Path | What |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/api/sites` | search by `lat`/`lon`/`radius_m`, `open_only`, `type` |
| GET | `/api/sites/:id` | one site |
| PATCH | 🔒 `/api/sites/:id/status` | update open/closed/full |
| GET | `/api/alerts` | active heat alerts by region |
| GET | `/api/geocode/zip/:zip` | ZIP → lat/lon |
| GET | `/api/risk-areas` | areas ranked by outreach need |
| POST | 🔒 `/api/risk-areas/:id/recompute` | rescore one area |
| GET | 🔒 `/api/orgs/:id/sites` | an org's sites |
| POST | 🔒 `/api/invites` | issue an invite code |
| GET | `/api/invites/:code/validate` | check a code (public — residents use it) |
| PATCH | 🔒 `/api/invites/:code/revoke` | revoke |
| GET | 🔒 `/api/invites` | list |
| POST | `/api/residents/register` | register with an invite code |
| GET | 🔒 `/api/residents` | priority queue, filter by tier/city |
| GET | 🔒 `/api/residents/:id/match` | matched services for one resident |
| POST | 🔒 `/api/agents/heat-watch/run` | `?dry_run=true` to preview |
| GET | 🔒 `/api/agents/dispatch/plan` | `?hours=12` — read-only |
| POST | 🔒 `/api/agents/site-freshness/run` | `?expire=true` to actually retire |

---

## The three scoring systems

Each is a **transparent, rule-based function** — no trained model, no LLM — and
each documents its own reasoning and upgrade path.

| File | Scores | Documented in |
|---|---|---|
| `riskScore.js` | **areas** — heat index, % elderly, % low-income, % without AC, distance to nearest open site | this README + `docs/DATA-SOURCES.md` |
| `needScore.js` | **people** — age, income vs. federal poverty level, employment, insurance | `docs/NEED-SCORING.md` |
| `serviceMatch.js` | **fit** — resident → cooling center / splash pad / water station + shade | `docs/NEED-SCORING.md` |

`GET /api/risk-areas` surfaces the area ranking in the org portal as a table and
on the resident map as a toggleable overlay.

---

## The agents

Three things that run on a schedule and act without being prompted:

1. **Heat Emergency Watch** — watches conditions, opens alerts, builds the
   contact list, highest need first. Every 30 minutes.
2. **Outreach Dispatch Planner** — turns volunteer shifts into an assignment
   plan and reports coverage gaps. Read-only; a coordinator decides.
3. **Site Status Freshness** — judges how far each site's status can still be
   trusted, with thresholds that tighten during a heat event. Reports by
   default; retiring a claim is opt-in.

Full detail, including the thresholds, the reasoning behind them, and the
calibration mistake we caught: **[`docs/AGENTS.md`](docs/AGENTS.md)**.

---

## Access control

Org-facing routes are gated by a **shared organization token** (`ADMIN_TOKEN`),
checked with a timing-safe compare and sent as `x-admin-token`. It is a
deliberate stopgap so resident PII is not world-readable — **not** per-user auth.
Per-organization logins with change tracking are filed as **SCRUM-53**.

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put it in `backend/.env` and **restart the backend**.

---

## What's real vs. stubbed

**Real and runnable** — Express API, PostGIS proximity search, full schema,
the resident and org frontends wired to the live API, invite-based priority
registration, all three scoring functions, all three agents, seeded Texas pilot
data, and a `node:test` suite (`npm test`).

**Stubbed (marked TODO)** — Twilio/FCM notification dispatch; live NWS polling
(SCRUM-23, in progress on `feature/SCRUM-23-live-weather-integration`).

**Not started** — offline/SMS-first flow for phone-only users; per-organization
logins (SCRUM-53); replacing any rule-based score with a trained model, which
needs outcome data we do not have.

---

## From concept to pilot

The project was scaffolded against **Los Angeles** placeholder data so spatial
search had something to query. Moving to **Texas** was not cosmetic — it is
where the team is, and demoing against placeholder data would have kept this an
academic exercise.

The pivot paid for itself immediately by exposing two real defects:

- No relief sites had ever been seeded, so resident search had been returning
  empty results for an entire sprint without anyone noticing.
- The agent risk threshold was tuned to LA-shaped data. Texas households have
  air conditioning at far higher rates (6–10% without, versus LA), so real
  scores landed at 24.8–30.6 against a threshold of 40 — the agents would have
  reported "all clear" forever. See §6 of `docs/AGENTS.md`.

Both are in `docs/VERIFICATION.md`.

---

## Team 5

D'Andre League (Scrum Master) · James Hawkins (Engineer) · Teyana Williams ·
Ryan Tucker

Board: Jira project `SCRUM` at `pvamu-heatsafe.atlassian.net`.
Process notes: `AGILE-SCRUM.md`. Current state: `PROJECT_STATUS.md`.
