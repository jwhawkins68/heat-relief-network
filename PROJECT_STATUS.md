# Heat Relief Network — Project Status & Handoff

**Course:** CINS 5338/5388 — Software Project Management, Prairie View A&M University
**Team 5:** D'Andre League (Scrum Master), James Hawkins (engineer), Teyana Williams, Ryan Tucker
**Repo:** `github.com/jwhawkins68/heat-relief-network`
**Jira:** `pvamu-heatsafe.atlassian.net`, project **HeatSafe** (key `SCRUM`)
**Local path:** `/Users/jwhawkins/heat-relief-network`

This file is a snapshot of everything built and decided so far, written so a fresh
Claude Code session (or teammate) can pick the project up with full context.

---

## 1. What the project is

A community platform for extreme-heat relief with two sides:

- **Resident-facing**: a map + list of cooling centers, water stations, shade, and
  splash pads with live open/closed status, plus active heat alerts.
- **Org-facing**: an admin portal with an AI-assisted "priority matching" engine that
  ranks neighborhoods by heat-vulnerability score (heat index + demographics),
  adjusted for how far the nearest *open* site already is — so limited outreach goes
  where it's needed most.

The scoring engine is a transparent, rule-based function today (not a trained model),
with a documented upgrade path.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Plain HTML/CSS/vanilla JS, no build step. Leaflet.js + OpenStreetMap tiles. |
| Backend | Node.js + Express. REST routes only. |
| Database | PostgreSQL 17 + PostGIS (spatial/proximity queries). |
| Core libs | `pg` (node-postgres), `cors`, `dotenv` |
| Scoring | Custom rule-based JS (`riskScore.js`) — no ML runtime dependency yet |
| Planned integrations | National Weather Service API, U.S. Census Bureau ACS API, Twilio (SMS), Firebase Cloud Messaging (push) |
| Dev tools | VS Code, `npx serve` (frontend), curl/Postman, Git/GitHub, Jira |

Run locally with `./start.sh` from the repo root (starts backend `npm run dev` on
`:4000` and frontend `npx serve` on `:3000` together, Ctrl+C stops both). A
double-clickable `~/Desktop/Start Heat Relief Network.command` launcher also exists.

## 3. Repository state

- **Branches:** `main` (stable) ← `develop` ← `feature/*`, merged via PR.
  `develop` has **not** been updated since the initial scaffold — it's stuck behind
  `feature/ai-priority-matching`. Don't branch new work from `develop`; branch from
  the latest feature branch's HEAD instead until `develop` catches up.
- **Current working branch:** `feature/site-directory-seed`, 3 commits ahead of
  `origin/develop`, **not yet pushed** (push it yourself — see §7).
  ```
  88f8a50 Add ZIP code search for cooling/relief sites
  749bfb3 Seed real Texas relief sites and swap pilot areas from LA to Texas
  ab1cc16 Document Postgres 16 -> 17 switch required for PostGIS
  6e4b308 Add AI priority-area matching feature and Scrum backlog docs
  c3d9070 Initial commit: backend + frontend scaffold
  ```
- **File layout:**
  ```
  backend/src/
    server.js                       — Express app, mounts all routes
    db/schema.sql                   — full DB schema (see §4)
    db/seed_areas.sql               — Texas pilot areas (5 zip-level areas)
    db/seed_sites.sql               — 11 real Texas relief sites + demo org
    db/pool.js                      — pg Pool, reads DATABASE_URL
    routes/sites.js                 — GET/PATCH site search + status updates
    routes/geocode.js               — NEW: ZIP → lat/lon resolution
    routes/risk-areas.js            — priority-area ranking
    routes/orgs.js, alerts.js
    services/riskScore.js           — vulnerability scoring function
    scripts/recomputeAllRiskScores.js
  frontend/
    index.html, admin.html
    js/app.js                       — resident map/list logic
    js/admin.js                     — admin portal logic
    js/api.js                       — thin fetch wrapper for all endpoints
    js/config.js                    — API_BASE constant
  AGILE-SCRUM.md, README.md, TOOLS.md — project docs
  ```

## 4. Database schema (`backend/src/db/schema.sql`)

Tables: `orgs`, `sites` (+ GIST spatial index), `inventory_items`, `volunteers`,
`volunteer_shifts`, `alerts`, `users`, `areas` (+ GIST spatial index).

- `sites.type` CHECK constraint only allows: `cooling_center`, `water_station`,
  `shade`, `splash_pad` — **no `community_center` type**. Team decision: community
  and recreation centers are seeded as `cooling_center` since most double as
  designated cooling centers in practice.
- `sites.status` CHECK allows `open | closed | full | unknown`. Seeded sites are
  deliberately `unknown` — the app's own design has an org admin set real status via
  the existing "Update Site Open/Closed Status" flow rather than guessing it.
- `orgs.type` CHECK allows `nonprofit | government | volunteer_group`.

## 5. API routes

| Route | Notes |
|---|---|
| `GET /api/sites?lat=&lon=&radius_m=&type=&open_only=` | Core site search (PostGIS `ST_DWithin`, nearest-first) |
| `GET /api/sites/:id` | Full detail incl. inventory |
| `PATCH /api/sites/:id/status` | Org portal status updates |
| `GET /api/geocode/zip/:zip` | **NEW** — resolves a 5-digit US ZIP to lat/lon (local table for the 10 pilot ZIPs, falls back to the free Zippopotam.us API for any other US ZIP) |
| `GET /api/risk-areas?region=` | Areas ranked by priority = base vulnerability score adjusted for distance to nearest open site |
| `POST /api/risk-areas/:id/recompute` | Recompute one area's base score |
| `GET /api/alerts?region=` | Heat advisories |
| `GET /api/orgs/:id/sites` | Sites managed by an org (admin portal) |
| `POST /api/invites` | **NEW** — issue a single-use invite code for an org |
| `GET /api/invites/:code/validate` | **NEW** — check a code without consuming it |
| `PATCH /api/invites/:code/revoke` | **NEW** — kill a code issued by mistake |
| `POST /api/residents/register` | **NEW** — redeem an invite, score the resident, return matched sites |
| `GET /api/residents?tier=&city=` | **NEW** — priority-ranked queue (income redacted to a band) |
| `GET /api/residents/:id/match` | **NEW** — re-run matching for an existing resident |

## 6. Feature/epic status

### Sprint 0 — AI Priority Matching (Done, 6 stories / 21 pts)
SCRUM-12 → SCRUM-17. Areas DB table, vulnerability scoring function, priority
ranking + nearest-open-site, admin priority-areas table, priority overlay on the
resident map, documented scoring methodology. All shipped and demoed.

### Sprint 1 — planned/in progress (9 stories / 23 pts)
Two independent epics, deliberately kept separate so two people can each own one
without touching the other's code:

- **Live Weather Integration** (SCRUM-10 epic; SCRUM-23/24/25) — replace hand-seeded
  `heat_index_f` with live NWS API (Open-Meteo fallback), cached, fault-tolerant.
- **Demographic Integration** (SCRUM-11 epic; SCRUM-18/19/20/21/22) — replace
  hand-seeded `pct_elderly`/`pct_low_income` with live Census ACS data via geocoded
  tracts; `pct_no_ac` has no free live source, so the plan is to document that gap
  rather than fabricate data.
- **SCRUM-26** (cross-cutting, 3 pts) — the batch recompute job that pulls both
  before scoring each area. Ties the two epics together; may get reassigned at
  standup to whoever finishes their epic first.

No new epics/features were added after a class discussion — the team deliberately
kept the backlog to these 3 epics + cross-cutting story rather than growing scope.

### Sprint 1 team assignments (balanced by story points & Scrum role)

| Assignee | Role | Points | Stories |
|---|---|---|---|
| James Hawkins | Engineer | 12 | SCRUM-18–22 — Demographic Integration (full epic, owned solo for continuity) |
| Ryan Tucker | Developer | 5 | SCRUM-23 — Weather API module |
| Teyana Williams | Developer | 4 | SCRUM-25, SCRUM-26 — Weather fallback + cross-cutting recompute |
| D'Andre League (`dleague`) | Scrum Master | 2 | SCRUM-24 — Weather response caching |

Rationale: Scrum Master intentionally carries the lightest coding load (his Sprint 1
work is facilitation/unblocking, not story points); the engineer owns the biggest
epic solo; the other two developers are balanced within 1 point of each other.
Already applied as the live assignee field in Jira.

### Site Directory / Texas pilot pivot (SCRUM-27, In Review)

The project's pilot/demo region is **statewide Texas** (Houston, Dallas, Fort
Worth, Austin, San Antonio), matching the team's real-world location:

- `seed_areas.sql` replaced — 5 Texas areas (Houston/Sunnyside, Dallas/South
  Dallas-Fair Park, Fort Worth/Near Southeast, Austin/East Austin, San
  Antonio/West Side), `pct_no_ac` seeded low across the board since central AC is
  near-universal in TX housing (poverty/elderly matter more there than AC access).
- `seed_sites.sql` added — 11 real, publicly documented sites (library branches
  serving as cooling centers, rec centers, parks) across those same 5 cities,
  verified against each city's library/parks dept. site + the Census Bureau
  geocoder. Demo org: "Texas Heat Relief Network".
- **This retroactively closes a Sprint 0 retro gap**: no cooling/water site records
  had ever been seeded before this, so the resident site-search view returned empty.

### ZIP code search (SCRUM-28, In Review)

Resident search previously required typing raw lat/lon with no way to search by
ZIP. Added:
- `GET /api/geocode/zip/:zip` — local lookup for the 10 pilot ZIPs, Zippopotam.us
  fallback for any other US ZIP.
- A "ZIP code" field on the resident search form (raw lat/lon fields kept, now
  labeled "advanced"). Map re-centers on the ZIP even with zero results nearby.
- Region field placeholder is "Harris County", matching the Texas pilot.

### Priority Access and Resident Matching (SCRUM-29, Sprint 2 — code written, not yet run)

A second scoring engine, this one for *people* rather than *places*. Residents register
through a single-use invite code issued by a partner org, answer an intake form, and get
a priority tier plus matched nearby sites in one round trip.

- **Scoring** (`services/needScore.js`): transparent 0-100 weighted sum — age (35),
  income vs Federal Poverty Level (30), employment (20), insurance (15), +10 if a child
  under 5 is in the household. Tiers: 1 Urgent >= 70, 2 Elevated >= 45, 3 Standard.
  Every branch emits a plain-language reason string. 10 unit tests, all passing
  (`npm test --prefix backend`).
- **Matching** (`services/serviceMatch.js`): ordered rule chain mapping situation to site
  type — toddlers to splash pads, 65+ to cooling centers, outdoor workers to water
  stations and shade — then resolved to real open sites via the existing PostGIS query,
  with an explicit fallback when nothing recommended is open nearby.
- **Invites** (`routes/invites.js`): 8-character codes from an alphabet excluding 0/O/1/I
  so they can be read aloud. Single-use, 30-day expiry, revocable, redeemed inside the
  registration transaction with `SELECT ... FOR UPDATE` so two simultaneous submissions
  can't both claim one.
- **Frontend**: `register.html` (invite gate -> intake form -> results, with "why we ask"
  microcopy on every sensitive field and a consent box that gates the submit button) and a
  Priority Access section in `admin.html` for issuing invites and working the queue.
- **Privacy**: raw `annual_income` never leaves the server. The admin queue shows an
  income *band* only, redaction applied server-side in `GET /api/residents`. Registration
  failures log the error message, never the request body. Full rationale, the weights and
  their public-health basis, the known fairness limitations, and the data-handling rules
  are in `docs/NEED-SCORING.md`.

Backlog: SCRUM-30 through SCRUM-37, 39 points total. Scoped for Sprint 2 — Sprint 1 is
already committed at 23 points.

## 7. ⚠️ Outstanding action items (things only you can do)

1. ~~Run the Texas seed data against your actual local database~~ **Done
   (2026-09-15).** The DB's `areas` table still had stale, duplicated Los Angeles
   placeholder rows from earlier testing (no foreign keys pointed at them), so
   those were truncated before reseeding. Local DB now has: 5 Texas areas
   (risk-scored — Sunnyside/Houston and South Dallas tie highest at 30.6, East
   Austin lowest at 24.8), 11 real Texas sites (all `status = unknown`, as
   designed), and 3 demo invite codes (`HEAT2026`, `COOLTX24`, `RELIEF99`). No
   Los Angeles data remains anywhere in the running app or database.
2. ~~Push the branch and open a PR into `develop`~~ **Done (2026-09-15).**
   `feature/site-directory-seed` pushed; PR #2 open into `develop`, covering
   SCRUM-27/28/29.
3. Screenshots in both decks (map overlay, admin priority table, admin
   recompute, Jira backlog board) still show the old Los Angeles data — now
   unblocked to refresh against the live Texas data above. Ask for that
   whenever it's convenient.

## 8. Presentations delivered

Both live in `/Users/jwhawkins/heat-relief-network/Claude outputs/` and were kept
in sync with everything above:

- **`Team5_Sprint0_Presentation.pptx`** (14 slides) — Sprint 0 review deck: use case
  diagram, backlog by epic, Sprint 0 stories/AC/dev tasks, screenshots, demo script,
  retro, carryover, Site Directory pivot slide, Team Assignments slide, Sprint 1
  planning (both epics with assignee badges per story).
- **`HeatReliefNetwork_Checkpoint.pptx`** (24 slides) — the broader project
  checkpoint: problem/vision/features, stack, architecture, dev environments,
  version control, use case diagram, Jira backlog (27 items), Site Directory pivot
  slide, Team Assignments slide, per-story description slides for Sprint 0, conclusion.
- Both open/close crediting **"Team 5"** (not an individual) per explicit request.
- Both still show the **old Los Angeles** map/admin screenshots — the live app
  and database are now fully Texas-based (see §7), so these are ready to
  refresh whenever requested.

## 9. Notes for whoever continues this

- `develop` is stale — don't trust it as a merge base until someone updates it.
- The `sites` schema has no `community_center` type; keep mapping those to
  `cooling_center` for consistency with what's already seeded.
- Site `status` should stay `unknown` for anything seeded programmatically — it's
  meant to be set by a real admin, not guessed.
- `AGILE-SCRUM.md` in the repo root has the team's fuller Scrum process notes
  (sprint structure, why the two Sprint 1 epics were split the way they were).
