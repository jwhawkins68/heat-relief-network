# Heat Relief Network — working notes for Claude Code

Full project context, sprint status, and open action items live in
@PROJECT_STATUS.md — read that first in any new session.
Agile/Scrum process notes: @AGILE-SCRUM.md
Tool/environment inventory (keep this up to date): @TOOLS.md
Iteration/sprint history: `docs/SPRINT-LOG.md` · Feature verification runbook: `docs/VERIFICATION.md`

## Quick orientation

- Course project: CINS 5338/5388, Prairie View A&M. **Team 5** — D'Andre League
  (Scrum Master), James Hawkins (engineer), Teyana Williams, Ryan Tucker.
- Repo: `github.com/jwhawkins68/heat-relief-network` · Jira: project **HeatSafe**, key `SCRUM`.
- Run everything locally with `./start.sh` from the repo root.

## Stack rules

- Frontend is plain HTML/CSS/vanilla JS with **no build step** — do not introduce a
  bundler, framework, or npm-built frontend.
- Map is Leaflet.js + OpenStreetMap tiles.
- Backend is Node.js + Express, REST routes only. Database is PostgreSQL 17 + PostGIS.
- Priority matching (`riskScore.js`) is a transparent rule-based function, not a
  trained model. Keep it explainable.
- Service region is **statewide Texas** (Houston, Dallas, Fort Worth, Austin, San Antonio).
- **Region = county.** `areas.region`, `alerts.region`, and `users.notify_region` always
  hold a county name ("Harris County"), never a city. The filter is an exact match by
  design; the UIs offer a county picker populated from the data. Don't "fix" it with a
  fuzzy match.
- **No invented data.** This is a real program, not a template. If there's no real source
  for a field, document the gap in `docs/DATA-SOURCES.md` — never fill it with a
  plausible-looking number, name, email, or code.

## Git workflow

- `main` ← `develop` ← `feature/<name>`. Never commit straight to `main`.
- Changes go through a pull request into `develop`.
- Reference the Jira issue key (e.g. `SCRUM-27`) in branch names, commits, and PR titles.
- Never commit `.env` or real credentials.
- Admin routes are gated by `ADMIN_TOKEN` (see `backend/src/middleware/requireAdmin.js`)
  and fail closed. Anything exposing resident data goes behind that gate.

## Scope discipline

The website is feature-complete for the class. The backlog is fixed at three epics —
AI Priority Matching (Sprint 0, done), Live Weather Integration, Demographic
Integration (both Sprint 1) — plus one cross-cutting story. Do not propose new
epics or features; ask before expanding scope.

## Deliverables

Presentation title/opening slides are credited to **"Prepared by Team 5"**, never an
individual name.

## Verification

Never call a feature Done on the strength of a diff — run it. `docs/VERIFICATION.md` has
the runbook with real expected values. The one rule that bites: seeding the database is
three steps, not two — `schema` → `seeds` → `npm run recompute-risk --prefix backend`.
Skip the recompute and the priority ranking returns a meaningless flat tie.

## Housekeeping

When a session ends with meaningful progress, hand off to the `scrum-master` agent
("have the scrum-master agent update the docs"). It maintains `PROJECT_STATUS.md`,
`docs/SPRINT-LOG.md`, and `TOOLS.md` so the next session picks up cleanly.
