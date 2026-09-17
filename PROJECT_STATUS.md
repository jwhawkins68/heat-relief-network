# HeatSafe — Project Status & Handoff

**Course:** CINS 5338/5388 — Software Project Management, Prairie View A&M University
**Team 5:** D'Andre League (Scrum Master), James Hawkins (engineer), Teyana Williams, Ryan Tucker
**Repo:** `github.com/jwhawkins68/heat-relief-network`
**Jira:** `pvamu-heatsafe.atlassian.net`, project **HeatSafe** (key `SCRUM`)
**Local path:** `/Users/jwhawkins/heat-relief-network`

This file is a snapshot of everything built and decided so far, written so a fresh
Claude Code session (or teammate) can pick the project up with full context.

> **Naming.** The product is **HeatSafe**. The repo, package, database, and file
> names still say `heat-relief-network` — the original name, kept deliberately so
> git history and the Jira board stay continuous. The rename was cosmetic and
> user-facing only.

> **Sprint numbering.** Sprints were renumbered to match the course rubric:
> old Sprint 0 → **Sprint 1**, old Sprint 1 → **Sprint 2**, old Sprint 2 →
> **Sprint 3**. This document uses the new numbering throughout. Older decks and
> commit messages may still use the old numbers.

*Last updated: 2026-09-16*

---

## 1. What the project is

A community platform for extreme-heat relief with three sides:

- **Resident-facing** — a map + list of cooling centers, water stations, shade, and
  splash pads with open/closed status, ZIP or geolocation search with a radius in
  miles, active heat alerts by county, and invite-based registration for priority
  access.
- **Org-facing** — an admin portal for site status updates, a priority-area ranking
  for outreach, invite issuing/revocation, the resident priority queue, and a panel
  that drives the agents.
- **Autonomous** — three agents that watch the data on a schedule and act without
  being prompted. Fully documented in **`docs/AGENTS.md`**.

Every scoring engine is a transparent, rule-based function today — not a trained
model and not an LLM — with a documented upgrade path and a documented reason.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Plain HTML/CSS/vanilla JS, no build step. Leaflet.js + OpenStreetMap tiles. |
| Backend | Node.js (ESM) + Express. REST routes only. |
| Database | PostgreSQL 17 + PostGIS (spatial/proximity queries). |
| Core libs | `pg`, `cors`, `dotenv` — three runtime deps, zero dev deps |
| Tests | `node:test` (built in). `npm test --prefix backend` |
| Auth | Shared org token via `node:crypto` timing-safe compare. Not per-user — that's SCRUM-53. |
| Scoring | Custom rule-based JS — `riskScore.js` (places), `needScore.js` (people), `serviceMatch.js` (fit) |
| Agents | Custom rule-based JS — `heatWatchAgent.js`, `dispatchAgent.js`, `siteFreshnessAgent.js`. Scheduled with plain `cron`. |
| Planned integrations | NWS API, Census ACS API, Twilio (SMS), Firebase Cloud Messaging |
| Dev tools | VS Code, Git/GitHub, Jira, curl |

Run locally with `./start.sh` (backend `:4000` + frontend `:3000`), `./restart.sh`
for a clean stop-and-start, `./stop.sh` to shut down. All three have Desktop
shortcuts. `restart.sh` sources `stop.sh` rather than duplicating its logic.

## 3. Repository state

- **Branches:** `main` (stable) ← `develop` ← `feature/*`, merged via PR.
- **`feature/site-directory-seed`** — pushed, open as **PR #2** into `develop`.
- **Current working branch:** `feature/SCRUM-23-live-weather-integration`, now
  **12 commits** ahead of the initial scaffold. Despite the branch name it carries
  all the agent work as well — SCRUM-23 itself (live NWS ingestion) still has no
  `weatherService.js` written.

  ```
  34a00b6 Add the Site Status Freshness agent; fix the broken radius input
  a815ef5 Calibrate the agent thresholds against real pilot scores
  d14be11 Add the Heat Watch and Dispatch Planner agents
  d42378d Rename the product to HeatSafe in user-facing text
  d26e92d Add stop.sh and have restart.sh share its logic
  71052da Add restart.sh for a clean stop-and-start
  a76928e Fall back to nearest sites when a location search finds none
  cb0f13a Add county autocomplete to region fields
  137f643 Remove remaining Los Angeles placeholder references
  8ea0728 Add priority access: invite registration and resident need matching
  88f8a50 Add ZIP code search for cooling/relief sites
  749bfb3 Seed real Texas relief sites and swap pilot areas from LA to Texas
  ```

- ⚠️ **`develop` is stale.** Don't branch new work from it until PR #2 merges and
  someone brings it forward. Branch from the latest feature branch HEAD instead.
- ⚠️ **The branch name no longer describes its contents.** Before the next PR,
  either rename it or split the agent commits onto their own branch, or the review
  will be confusing.

### File layout

```
backend/src/
  server.js                        — Express app, mounts all 8 routers
  db/schema.sql                    — full DB schema (see §4)
  db/migration_priority_access.sql — invites + residents tables
  db/seed_areas.sql                — 5 Texas pilot areas
  db/seed_sites.sql                — 11 real Texas relief sites + demo org
  db/seed_volunteers.sql           — demo volunteers + shifts (for dispatch)
  db/seed_invites.sql              — demo invite codes
  db/pool.js                       — pg Pool, reads DATABASE_URL
  middleware/requireAdmin.js       — shared-token gate, fails closed
  routes/sites.js alerts.js orgs.js geocode.js
  routes/risk-areas.js invites.js residents.js agents.js
  services/riskScore.js            — vulnerability scoring (places)
  services/needScore.js            — need scoring (people)
  services/serviceMatch.js         — situation → site-type rules
  services/zipLookup.js            — ZIP → lat/lon
  services/heatWatchAgent.js       — AGENT 1
  services/dispatchAgent.js        — AGENT 2
  services/siteFreshnessAgent.js   — AGENT 3
  scripts/recomputeAllRiskScores.js runHeatWatch.js runSiteFreshness.js
  test/                            — node:test unit tests
frontend/
  index.html admin.html register.html
  js/ app.js admin.js api.js register.js config.js
docs/
  AGENTS.md                        — the three agents, in full
  NEED-SCORING.md                  — rubric, fairness, data handling
  DATA-SOURCES.md  VERIFICATION.md  SPRINT-LOG.md
start.sh restart.sh stop.sh
AGILE-SCRUM.md README.md TOOLS.md PROJECT_STATUS.md
ADMIN-ACCESS.local.md              — GITIGNORED. Token + org UUID. Never commit.
```

## 4. Database schema (`backend/src/db/schema.sql`)

Tables: `orgs`, `sites` (+ GIST index), `inventory_items`, `volunteers`,
`volunteer_shifts`, `alerts`, `users`, `areas` (+ GIST index), plus `invites` and
`residents` from `migration_priority_access.sql`.

- `sites.type` CHECK allows only `cooling_center | water_station | shade |
  splash_pad` — **no `community_center`**. Team decision: community and recreation
  centers are seeded as `cooling_center`, since most double as designated cooling
  centers in practice.
- `sites.status` CHECK allows `open | closed | full | unknown`. Seeded sites are
  deliberately `unknown` — status is meant to be set by a real admin, not guessed.
  The Site Freshness agent also retires expired claims to `unknown`, never to
  `closed`: we don't know the site closed, we know we stopped knowing.
- `orgs.type` CHECK allows `nonprofit | government | volunteer_group`.
- **`users` has existed since the first commit and is still unused.** SCRUM-53 will
  finally populate it. Worth knowing before anyone adds a second user table.

## 5. API routes

Routes marked 🔒 require the `x-admin-token` header.

| Route | Notes |
|---|---|
| `GET /health` | liveness |
| `GET /api/sites?lat=&lon=&radius_m=&type=&open_only=` | PostGIS `ST_DWithin`, nearest-first. Falls back to a statewide radius when a local search finds nothing. |
| `GET /api/sites/:id` | full detail incl. inventory |
| 🔒 `PATCH /api/sites/:id/status` | org portal status updates |
| `GET /api/geocode/zip/:zip` | local table for the 10 pilot ZIPs, Zippopotam.us fallback for any other US ZIP |
| `GET /api/risk-areas?region=` | areas ranked by vulnerability adjusted for distance to nearest open site |
| 🔒 `POST /api/risk-areas/:id/recompute` | rescore one area |
| `GET /api/alerts?region=` | heat advisories |
| 🔒 `GET /api/orgs/:id/sites` | sites managed by an org |
| 🔒 `POST /api/invites` | issue a single-use invite code |
| `GET /api/invites/:code/validate` | check a code without consuming it (public — residents use it) |
| 🔒 `PATCH /api/invites/:code/revoke` | kill a code issued by mistake |
| 🔒 `GET /api/invites` | list |
| `POST /api/residents/register` | redeem an invite, score the resident, return matched sites |
| 🔒 `GET /api/residents?tier=&city=` | priority queue — income redacted to a band server-side |
| 🔒 `GET /api/residents/:id/match` | re-run matching for an existing resident |
| 🔒 `POST /api/agents/heat-watch/run?dry_run=` | AGENT 1 |
| 🔒 `GET /api/agents/dispatch/plan?hours=` | AGENT 2 — read-only |
| 🔒 `POST /api/agents/site-freshness/run?expire=` | AGENT 3 |

## 6. Feature/epic status

### Sprint 1 (formerly Sprint 0) — AI Priority Matching · **Done**, 6 stories / 21 pts
SCRUM-12 → SCRUM-17. Areas table, vulnerability scoring, priority ranking +
nearest-open-site, admin priority table, resident-map overlay, documented
methodology. Shipped and demoed.

### Sprint 2 (formerly Sprint 1) — Live data integration · 9 stories / 23 pts
- **Live Weather Integration** (epic SCRUM-10; SCRUM-23/24/25) — replace hand-seeded
  `heat_index_f` with live NWS (Open-Meteo fallback), cached, fault-tolerant.
  **SCRUM-23 is In Progress but no code is written yet.**
- **Demographic Integration** (epic SCRUM-11; SCRUM-18–22) — replace hand-seeded
  `pct_elderly` / `pct_low_income` with live Census ACS via geocoded tracts.
  `pct_no_ac` has no free live source; the plan is to **document that gap rather
  than fabricate data**.
- **SCRUM-26** (cross-cutting, 3 pts) — batch recompute that pulls both before
  scoring.

| Assignee | Role | Pts | Stories |
|---|---|---|---|
| James Hawkins | Engineer | 12 | SCRUM-18–22 — Demographic Integration (full epic, solo for continuity) |
| Ryan Tucker | Developer | 5 | SCRUM-23 — Weather API module |
| Teyana Williams | Developer | 4 | SCRUM-25, SCRUM-26 |
| D'Andre League | Scrum Master | 2 | SCRUM-24 — response caching |

The Scrum Master intentionally carries the lightest coding load; his sprint work is
facilitation and unblocking, not story points.

### Sprint 3 (formerly Sprint 2) — Priority Access & Resident Matching · **In Review**
SCRUM-29 epic, SCRUM-30–37 (39 pts) — delivered ahead of schedule.

A second scoring engine, for *people* rather than *places*. Residents register
through a single-use invite code issued by a partner org, answer an intake form,
and get a priority tier plus matched nearby sites in one round trip.

- **Scoring** (`needScore.js`) — transparent 0–100 weighted sum: age (35), income vs
  Federal Poverty Level (30), employment (20), insurance (15), +10 for a child under
  5. Tiers: 1 Urgent ≥ 70, 2 Elevated ≥ 45, 3 Standard. Every branch emits a
  plain-language reason. Unit-tested.
- **Matching** (`serviceMatch.js`) — ordered rule chain: toddlers → splash pads, 65+
  and unable-to-work → cooling centers, outdoor workers → water stations and shade,
  with an explicit fallback when nothing recommended is open nearby.
- **Invites** (`routes/invites.js`) — 8-character codes from an alphabet excluding
  0/O/1/I so they can be read aloud. Single-use, 30-day expiry, revocable, redeemed
  inside the registration transaction with `SELECT … FOR UPDATE` so two simultaneous
  submissions can't both claim one.
- **Privacy** — raw `annual_income` never leaves the server; the admin queue shows a
  band only, redacted server-side. Registration failures log the error message,
  never the request body. Full rationale, weights, public-health basis, and known
  fairness limitations in `docs/NEED-SCORING.md`.

### Agents — SCRUM-38 through SCRUM-52 · code complete, **In Review**

Three epics, twelve stories. Read **`docs/AGENTS.md`** before touching any of it.

| Epic | Agent | Stories |
|---|---|---|
| SCRUM-38 | Heat Emergency Watch | SCRUM-40 (Ryan), 41 (Ryan), 42 (Teyana), 43 (James) |
| SCRUM-39 | Outreach Dispatch Planner | SCRUM-44 (Teyana), 45 (Teyana), 46 (James) |
| SCRUM-48 | Site Status Freshness | SCRUM-50 (Ryan), 51 (Teyana), 52 (James) |

- **SCRUM-47** (D'Andre) — "document both agents' decision rules so an autonomous
  system acting on residents can be reviewed rather than trusted." **The document
  now exists at `docs/AGENTS.md`** and covers all three agents, not two. Moved to
  In Review for D'Andre's review rather than marked Done.
- **SCRUM-49** (James) — DEFECT, In Review. The search radius input was
  `min="500" step="1000" value="40000"`; HTML5 step validation only accepts
  `min + n × step`, so 40000 was *silently invalid* and blocked form submission with
  no visible error. Replaced with a `<select>` of four fixed values in **miles**
  (5 / 10 / 25 / 50) — correct, and a better question to ask a resident.

**The calibration catch worth presenting.** Both agents originally used
`HIGH_RISK_SCORE = 40`. Run against the real Texas pilot areas, actual scores came
out **24.8–30.6**, so every agent would have reported "all clear" forever while
appearing to work — worse than being visibly broken. The cause is real: our risk
score weights `pct_no_ac` heavily and Texas AC penetration is near-universal (6–10%
without, versus the LA-shaped placeholder data the weight was tuned against).
Lowered to **28**, recorded as a named constant with the reasoning in a comment, and
the Jira acceptance criteria updated to match. The general lesson: *a threshold is
not a decision until you've seen the distribution it sits in.*

### Filed, deliberately not built — "these can wait to maximize credits"

- **SCRUM-53** (Epic, To Do, ~26 pts) — **Organization User Accounts and Audit
  Trail.** Per-organization logins tied to the org's access token and ID, so changes
  can be attributed to a person and organization participation can be tracked.
  Constraint recorded on the issue: password hashing must be **argon2id** (bcrypt as
  fallback), never a bare hash. Note the unused `users` table above.
- **SCRUM-54** (Task, To Do, 5 pts, James) — move the "County (for alerts)" selector
  out of the search form and into the header under the HeatSafe name, keep alerts
  rendering where they are, and **load alerts as soon as a county is chosen** rather
  than waiting for a site search. Separates "where am I" from "what am I searching
  for", which currently read as the same control.

## 7. ⚠️ Outstanding action items (things only you can do)

1. **Stale git lock.** `.git/HEAD.lock` is present. Sandbox restrictions mean Claude
   sessions can't delete files, so this needs a human:
   ```
   rm -f .git/HEAD.lock
   ```
   If `git checkout` or `git commit` starts refusing, check for `.git/*.lock*` first.
2. **Run the newer seeds** if you haven't since the agents landed:
   ```
   psql $DATABASE_URL -f backend/src/db/seed_volunteers.sql
   psql $DATABASE_URL -f backend/src/db/seed_invites.sql
   ```
   The dispatch agent has nothing to plan without volunteers and shifts.
3. **Restart the backend after any `.env` change.** `dotenv` reads it once at
   startup and `node --watch` doesn't watch `.env`. This is the cause of the
   "Admin access is not configured on this server" 503.
4. **Commit and push the documentation pass** (this file, `README.md`, `TOOLS.md`,
   `docs/AGENTS.md`).
5. **Decide the branch story before the next PR** — see §3.
6. **Confirm which PowerPoint copy is authoritative.** The decks are also in the
   team's PVAMU OneDrive with `_1` suffixes
   (`Team5_Sprint0_Presentation_1.pptx`, `HeatSafe_Checkpoint_1.pptx`). There is no
   write-capable SharePoint connector, so local copies in `Claude outputs/` are
   edited and uploaded by hand — which means if a teammate has been editing the
   SharePoint copies, the local ones are stale. Settle this before the next deck
   edit.
7. **Standup flag (still open):** SCRUM-23 is Jira-assigned to Ryan Tucker, but the
   branch was created under James's checkout and now carries all the agent work.
   Confirm whether that's an intentional reassignment or pairing.

## 8. Presentations delivered

All in `/Users/jwhawkins/heat-relief-network/Claude outputs/`:

- **`Team5_Sprint0_Presentation.pptx`** — sprint review deck (14 slides): use case
  diagram, backlog by epic, stories/AC/dev tasks, live Texas screenshots, demo
  script, retro, carryover, Site Directory pivot, team assignments, next-sprint
  planning.
- **`HeatReliefNetwork_Checkpoint.pptx`** — project checkpoint deck (29 slides):
  problem/vision/features, stack, architecture, dev environments, version control,
  use case diagram, Jira backlog, the Texas pivot, team assignments, per-story
  slides, conclusion. Audited against the professor's rubric.
- **`HeatSafe_Progress_Update.pptx`** (16 slides) — *"From Prototype to Operating
  Pilot."* The current-state deck: what the agents do, what changed for residents,
  how much more capable the admin side is, and what's next.
- **`HeatReliefNetwork_Presentation_Script.docx`** — the full narrative plus
  slide-by-slide script. The same wording is loaded into the **speaker notes** of
  both original decks, so the script and the decks can't drift apart.

Speaking assignments (from the script document): D'Andre opens and closes, Teyana
takes slides 2–4, James takes 5 and 22–26, Ryan takes 6–10, D'Andre covers 1, 11–13
and 27–28. Each speaker's last line hands to the next person by name — if the
running order changes, update the handoff line, not just the assignment table.

All decks credit **"Team 5"**, never an individual.

## 9. Notes for whoever continues this

- `develop` is stale — don't trust it as a merge base until someone updates it.
- The `sites` schema has no `community_center` type; keep mapping those to
  `cooling_center`.
- Site `status` stays `unknown` for anything seeded programmatically.
- **Never commit `backend/.env` or `ADMIN-ACCESS.local.md`.** Both are gitignored;
  verify that's still true before any commit that touches `.gitignore`.
- Jira has **no Bug issue type** — only Epic / Story / Task / Subtask. File defects
  as Tasks prefixed `DEFECT —`. Transition IDs: 11 To Do, 21 In Progress, 31 In
  Review, 41 Done.
- **Never mark a Jira issue Done without independent verification.** The
  `scrum-master` agent definition in `.claude/agents/` enforces this, and it has
  already caught one premature Done.
- `AGILE-SCRUM.md` has the fuller Scrum process notes (sprint structure, why the
  Sprint 2 epics were split the way they were).
- Agents are documented in `docs/AGENTS.md`. If you change a threshold, change it
  there too — the numbers appear in the doc, the code comments, and the Jira
  acceptance criteria, and they are supposed to agree.
