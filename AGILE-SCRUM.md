# Agile / Scrum with Jira — Heat Relief Network

A practical guide for this project: what Scrum actually is, how Jira
implements it, and a ready-to-use first sprint backlog so your team can
start today instead of spending a week figuring out the tool.

## 1. What Scrum is, in plain terms

Scrum is a way of breaking a big project into small, regularly-shipped
chunks instead of trying to build the whole thing at once and finding out
at the end whether it works. The whole point: get feedback early and
often, and always have *something* working, even if incomplete.

**The three roles:**
- **Product Owner** — decides *what* gets built and in what order (for a
  class project, this might be whoever is closest to "the customer,"
  or the person who best understands the assignment requirements).
- **Scrum Master** — keeps the process running smoothly (schedules
  meetings, removes blockers, makes sure the board stays up to date). Not
  a boss — more like a facilitator.
- **Development Team** — everyone actually building the thing (in your
  case, that's the whole team, including whoever is "PO" or "SM" too).

On a 3-5 person student team, these roles are often shared or rotate —
that's normal and fine.

**The three artifacts:**
- **Product Backlog** — the full wish list of everything the software
  could ever have, roughly ordered by priority. Never "done," just
  reprioritized constantly.
- **Sprint Backlog** — the slice of the Product Backlog your team
  committed to finishing in the *current* sprint.
- **Increment** — the actual working software you have at the end of a
  sprint. Even sprint 1 should end with something that runs, even if
  small.

**The events (the recurring meetings):**
- **Sprint Planning** — at the start of a sprint, pick what you'll work on
  from the backlog and break it into tasks.
- **Daily Standup** — a short (5-10 min) check-in: what I did yesterday,
  what I'm doing today, what's blocking me. Not a status report to a
  manager — it's the team syncing with itself.
- **Sprint Review** — at the end of a sprint, demo what you built to
  whoever cares (your professor, teammates, "stakeholders").
- **Sprint Retrospective** — right after the review: what went well, what
  didn't, what to change next sprint. This is the step students skip and
  professors specifically look for.

A **sprint** is just a fixed time box — commonly 1-2 weeks — during which
you do all of the above once.

## 2. How Jira maps onto this

Jira is just software that gives Scrum a shape you can click through:

| Scrum concept | Where it lives in Jira |
|---|---|
| Product Backlog | The **Backlog** view — a flat list of all issues, not yet assigned to a sprint |
| Sprint Backlog | Drag backlog items into an active **Sprint** |
| A single backlog item | An **Issue** — usually typed as a "Story," "Task," or "Bug" |
| A big chunk of related work | An **Epic** — a container that groups related Stories (e.g. "AI Priority Matching") |
| Sprint Planning | The act of dragging issues from Backlog into a Sprint before starting it |
| Daily Standup | Looking at the **Board** (To Do / In Progress / Done columns) together |
| Sprint Review | Whatever you demo — Jira doesn't do this part for you |
| Sprint Retrospective | Jira has a Retrospective template, but a shared doc works too |
| Progress tracking | The **Burndown Chart** — auto-generated, shows remaining work vs. time left in the sprint |
| Effort estimate | **Story Points** — a relative-size number (not hours) put on each Story |

### Setting it up (one-time)

1. Go to **jira.atlassian.com** (or **id.atlassian.com** → Jira) and create a
   free Cloud site — free tier covers up to 10 users, which fits a class team.
2. **Create Project → Scrum template** (not Kanban — Scrum is what gives you
   sprints and the burndown chart your professor wants to see).
3. **Connect it to GitHub**: Project settings → Apps → find "GitHub for
   Jira" → connect your `jwhawkins68/heat-relief-network` repo. Once linked,
   any commit or PR whose message includes an issue key (e.g. `HRN-12`)
   automatically shows up inside that Jira issue — this is the single best
   way to make your Jira board *prove* real development happened, not just
   look like a to-do list.
4. **Create Epics** matching your existing feature-branch structure:
   `Auth`, `Dashboard`, `AI Priority Matching`, `Checks/QA` (these map
   directly to the `feature/*` branches already discussed for this repo).
5. Set your **sprint length** — 1-2 weeks is standard; pick whatever
   divides evenly into the time you have left in the semester.

## 3. Ready-to-use backlog: AI Priority Matching (the feature just built)

Copy these straight into Jira as your first Epic + Stories. Story points
use the common Fibonacci-ish scale (1, 2, 3, 5, 8 — bigger gaps as size
grows, because estimating precisely on large work is an illusion anyway).

**Epic: AI Priority Matching**
*"Match high-heat areas to the residents/communities who need resources most."*

| Story | Points | Acceptance criteria |
|---|---|---|
| As a developer, I want an `areas` database table storing heat + demographic inputs per zip/area, so scores can be computed and stored. | 3 | Table exists with heat_index_f, pct_elderly, pct_low_income, pct_no_ac, risk_score columns; migrated via schema.sql |
| As a developer, I want a scoring function combining heat index and vulnerability % into one 0-100 score, so areas can be ranked consistently. | 3 | `riskScore.js` returns a score + breakdown for a given area's inputs; unit-testable, no DB dependency |
| As an org admin, I want areas ranked by priority, adjusted for how far the nearest open site is, so I know where an under-resourced high-need area is. | 5 | `GET /api/risk-areas` returns areas sorted by priority_score descending, each with its nearest open site and distance |
| As an org admin, I want a "Priority areas" table in the admin portal, so I can act on this ranking without reading raw JSON. | 5 | `admin.html` shows a ranked table with priority band, heat index, nearest site; "Recompute" button updates a row live |
| As a resident, I want to see priority areas shaded on the map, so I understand where help is most needed in my area. | 3 | `index.html` has a toggle that overlays colored circles on the Leaflet map, sized/colored by priority score |
| As a team, we want our scoring methodology documented, so it can be graded/reviewed and later swapped for a trained model. | 2 | README section explains the approach, why it was chosen over an ML model now, and the upgrade path |

**Total: 21 points** — a reasonable single sprint for a 3-5 person team
that also has other epics (auth, etc.) in flight.

Everything above is already implemented in the codebase as of this
message — you can literally create these Stories, mark them Done, and
attach today's commit/PR to each one for your professor's Jira evidence.

## 4. Ready-to-use backlog: Live Weather Integration + Demographic Integration

*Not yet built* — these are the next two Epics, feeding real data into the
scoring function from Epic 1 instead of manually-seeded numbers. Both
depend on that Epic already being merged (they read/write the same
`areas` table). Split into two Epics (matching what's actually set up in
Jira as of this update) so two teammates can own each independently.

**Epic: Live Weather Integration** — *8 points*
*"Replace manually-seeded heat_index_f with live data from a free weather API."*

| Story | Points | Acceptance criteria |
|---|---|---|
| As a developer, I want a weather service module that fetches current heat index from the National Weather Service API (with an Open-Meteo fallback), so `heat_index_f` reflects real conditions instead of hand-typed estimates. | 5 | `weatherService.js` exports a function returning heat index for a given lat/lon; tries NWS's two-step lookup first, falls back to Open-Meteo on failure/timeout |
| As a developer, I want weather responses cached (~30-60 min TTL), so we don't exceed NWS/Open-Meteo rate limits or slow things down. | 2 | Repeated calls for the same area within the TTL window reuse the cached value instead of re-fetching |
| As a developer, I want a fallback to an area's last-known-good `heat_index_f` when the weather API is down, so one flaky external service doesn't break scoring entirely. | 1 | On fetch failure, the area keeps its previous `heat_index_f` and logs the failure rather than erroring out |

**Epic: Demographic Integration** — *12 points*
*"Replace manually-seeded demographic inputs with live data from the Census Bureau."*

| Story | Points | Acceptance criteria |
|---|---|---|
| As a developer, I want a Census Geocoder integration that resolves an area's lat/lon to its census tract, so demographic lookups can be automated instead of manually matched. | 3 | Given an area's centroid, the correct census tract ID is returned and stored on the area record |
| As a developer, I want ACS API calls that pull `pct_elderly` and `pct_low_income` for a resolved census tract, so those fields come from real Census data instead of hand-entered guesses. | 5 | `demographicsService.js` returns both percentages for a given tract ID, sourced from ACS tables B01001 (age) and S1701 (poverty) |
| As a developer, I want tract/demographic lookups cached with a long TTL, so we don't re-hit the Census APIs for data that barely changes year to year. | 1 | A tract's resolved ID and its ACS figures are reused from cache across recompute runs within the TTL window |
| As a developer, I want a fallback to an area's last-known-good demographic values when the Census APIs are down, so one flaky external service doesn't break scoring entirely. | 1 | On fetch failure, the area keeps its previous `pct_elderly`/`pct_low_income` and logs the failure rather than erroring out |
| As a team, we want an honest, documented plan for `pct_no_ac` (air conditioning access), since no free live API provides it at the tract level, so this gap doesn't quietly become fabricated data. | 2 | Doc explains the chosen approach (e.g. ingesting CDC's Heat & Health Index dataset, or a manually-maintained field) and its refresh cadence |

**Cross-cutting story (not under either Epic alone) — 3 points:**
*As a developer, I want the batch recompute job to pull live weather + demographic data before scoring each area, so risk scores stay current without manual re-seeding.* (Acceptance: `recomputeAllRiskScores.js` calls both services per area, updates the row, then scores it; one area's failure doesn't abort the whole batch run.) This one depends on both Epics, so put it in whichever finishes second — it's a good "glue" task for whoever's free first.

**Total: 8 + 12 + 3 = 23 points** — same overall scope as before, now split
so two teammates can work Live Weather Integration and Demographic
Integration in parallel without touching each other's code.

## 5. A realistic cadence for the rest of the semester

- **Sprint 1:** AI Priority Matching (Epic in §3) + whatever's in-flight
  on `feature/auth`.
- **Sprint 2:** Live Weather Integration + Demographic Integration (Epics
  in §4) + `feature/dashboard` polish.
- **Sprint 3:** NWS alert polling job, notification dispatch (Twilio/FCM),
  basic auth on admin routes, volunteer matching.
- **Final sprint:** bug bash, "Checks/QA," demo polish — this is your
  "tested release" milestone from the branching diagram.

Each sprint ends with: **Review** (5-min demo to the team/professor of what
actually runs) and **Retro** (10 min: what slowed us down, what to do
differently). Writing these two things down each sprint — even briefly —
is usually exactly what professors are checking for when they say
"show the Agile/Scrum process," more than the tool itself.
