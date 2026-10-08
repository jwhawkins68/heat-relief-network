# Sprint & iteration log

Append-only. Newest entry at the top. Never rewrite a past entry — correct it with a new one.

---

## 2026-09-15 — Demo-to-production pass: county regions, admin gate, demo data removed

**Team decision — `region` is a COUNTY, never a city.** `region=Houston` returned nothing
while `region=Harris County` worked; rather than loosen the match, the team fixed the
meaning. `areas.region`, `alerts.region`, and `users.notify_region` all hold county names.
Both the resident and admin filters are now labelled "County" and back onto a
`<datalist>` populated at page load from the counties actually present in the data — so
the county list is never hardcoded in the frontend and stays correct as the service region
grows. Exact match is now correct behaviour, not a bug. Closed as resolved in
`docs/VERIFICATION.md`.

**Demo attributes removed** (the template scaffolding, now that this is a real program):

- Deleted `backend/src/db/seed_invites.sql` and its three shared codes (`HEAT2026`,
  `COOLTX24`, `RELIEF99`). Hardcoded invite codes committed to a repo would have granted
  registration access to anyone who read it. Codes are now issued only through the admin
  portal, which generates them with `crypto.randomInt`.
- Removed the live example code from the registration form's placeholder.
- The operating org's fabricated contact email was set to NULL rather than replaced with
  another invented address.
- Stripped "demo/example/prototype/mock" framing from the seed files and frontend
  comments. `seed_areas.sql` now carries a real provenance block instead.

**Admin gate added** (`backend/src/middleware/requireAdmin.js`). The resident queue holds
real people's age, income band, employment and insurance status, and was readable by
anyone who knew an org UUID. A shared `ADMIN_TOKEN` (env, timing-safe compare) now gates:
org site list, site status PATCH, risk-area recompute, invite issue/list/revoke, resident
queue, resident match. Deliberately still public: site search and detail, geocode, alerts,
risk-area GET (the resident map overlay), invite `/validate`, and resident `/register` —
gated by the invite code itself. **Fails closed:** with `ADMIN_TOKEN` unset those routes
return 503 rather than falling open.

This is a shared secret, not per-user auth — an explicit stopgap, not the destination.
Logged for planning: real org user accounts.

**Verified** against a clean PostgreSQL + PostGIS database (schema → migration → seeds →
recompute → full API sweep):

- Public routes 200; all seven admin routes 401 without a token, 200 with it, 401 with a
  wrong one, 503 with `ADMIN_TOKEN` unset.
- County filter: `Harris County` → 1, `Houston` → 0 (by design), five counties discovered.
- Invite issued through the admin route → validates publicly → registers a resident →
  scored Tier 1 Urgent with correct plain-language reasons.
- `npm test` — 10/10 `needScore.test.js` pass.
- Seed counts unchanged: 1 org, 11 sites, 5 areas, **0 invites** (was 3).

**Roadblocks:**

1. **Census ACS pull did not happen.** The team chose to replace the invented
   `pct_elderly` / `pct_low_income` with real ACS data, but `api.census.gov` is outside
   the network allowlist of the environment this was done from — every request returned
   302. The exact curl commands and ZCTAs are written up in `docs/DATA-SOURCES.md`; they
   run fine from a normal terminal or from Claude Code's local shell. **The numbers in
   `seed_areas.sql` are still the hand-seeded originals.**
2. **Real operating organization details still needed** — name, type, contact email and
   phone. The seed org's contact fields are NULL until then.
3. Test residents registered against the old demo invite codes are still in the local
   database and must be truncated before real registrations begin.
4. Frontend UI still unverified in a browser (county picker, admin sign-in, map overlay).

---

## 2026-09-15 — Local DB seeded, PR #2 opened, Priority Access verified, Jira synced, SCRUM-23 branch started

**Context:** Continuation of the Site Directory pivot session. Executed the three
outstanding action items from the 2026-09-14 log, then moved on to Sprint 1
(Live Weather Integration).

**Git:**
- Removed two stray empty `.git/refs/heads/feature/*.lock.stale` files that were
  breaking `git fetch` ("bad object" / "did not send all necessary objects"). Also
  hit and cleared one stale `.git/HEAD.lock` (0 bytes, no git process actually
  running) that blocked a commit mid-session.
- Pushed `feature/site-directory-seed` to `origin`; opened **PR #2** into `develop`
  (referencing SCRUM-27/28/29).
- Two follow-up commits on the same branch, then pushed:
  - `137f643` — removed remaining Los Angeles placeholder references from
    `schema.sql`, `seed_areas.sql`, and `PROJECT_STATUS.md` (the DB itself, the
    running app, and now the source files are all Texas-only).
  - `cb0f13a` — added a county autocomplete `<datalist>` (`fetchCounties()` /
    `populateCountyList()` in `api.js`) to the resident search and admin
    priority-areas "Region" fields, renamed to "County", sourced from live
    `/api/risk-areas` data rather than hardcoded.
- Branched `feature/SCRUM-23-live-weather-integration` off
  `feature/site-directory-seed` HEAD, **not** off `develop` — confirmed
  `origin/develop` is still just the initial scaffold commit (`c3d9070`), so
  branching from it now would have dropped every feature built since. (User's
  first command named `SCRUM-12`, already a completed, unrelated Sprint 0 story —
  corrected to `SCRUM-23`, the actual "weather service module" story, before
  creating the branch.)

**DB seeding (local):** Ran the full sequence — `migration_priority_access.sql`,
`seed_areas.sql`, `seed_sites.sql`, `seed_invites.sql`, then
`npm run recompute-risk --prefix backend`. Found and truncated 10 stale, duplicated
Los Angeles-era rows in `areas` first (no FKs referenced them — safe). Resulting
state: 5 Texas areas risk-scored (Sunnyside/Houston + South Dallas tie highest at
30.6, East Austin lowest at 24.8), 11 sites (`status = unknown` throughout, by
design), 3 unused invite codes.

**Verified working (Priority Access / SCRUM-29, not just reviewed as a diff):**
- `POST /api/residents/register` with invite `HEAT2026` (68yo, unemployed, no
  insurance, income at the poverty line) → scored 89, Tier 1 Urgent, with correct
  plain-language reasons.
- Invite flipped `unused` → `redeemed`; confirmed a second redemption would be
  rejected (status check, not re-tested against the same code to avoid burning
  another demo code).
- `GET /api/residents?tier=&city=` returned `income_band: "Below poverty line"`
  with no `annual_income` field present — redaction confirmed server-side.
- `npm test --prefix backend` — 10/10 `needScore.test.js` tests pass.
- Recommended sites came back empty with an explicit fallback message, because
  all seeded sites are `status = unknown` (not `open`) — expected behavior per the
  app's own design, not a bug.

**Not verified:** the Priority Access admin UI (issue-invite panel, resident
queue) in an actual browser — only exercised via curl/API so far.

**Jira (via Atlassian MCP connector, `pvamu-heatsafe.atlassian.net`, project
`SCRUM`):** Read the full board (37 issues) before changing anything.
- SCRUM-29 and child stories SCRUM-30–37 (all "To Do", despite being fully
  implemented and verified above) → **In Review**, with a verification comment
  on the epic.
- SCRUM-27, SCRUM-28 (already "In Review") → added comments confirming DB
  seeding and linking PR #2.
- SCRUM-23 → **In Progress**, comment noting the new branch and why it was based
  off `feature/site-directory-seed` instead of `develop`.
- **Found:** SCRUM-23 is Jira-assigned to Ryan Tucker; the new branch was created
  under James's local checkout. Not changed — flagged for the team to decide at
  standup (pairing vs. reassignment vs. mistake).

**Presentation decks refreshed (python-pptx, throwaway venv — see TOOLS.md):**
- Captured 7 live screenshots via Claude in Chrome against the seeded local
  stack: resident map (statewide + ZIP-search zoomed with the priority overlay
  visible), admin priority-areas table, admin Priority Access resident queue,
  an invite issued through the admin UI, and the resident-facing results panel
  after a real registration.
- `Team5_Sprint0_Presentation.pptx`: swapped the two Los Angeles-era screenshots
  on the Evidence slide for the new Texas ones; closed the "pending seed run"
  note on the Site Directory pivot slide.
- `HeatReliefNetwork_Checkpoint.pptx`: fixed "Prepared by James Hawkins" →
  "Prepared by Team 5" on the title slide and the Thank You footer (violated
  CLAUDE.md's deliverables rule — drifted at some point after this deck was
  first built); added 4 new slides before Conclusion (Site Directory Pivot,
  Team Assignments — Sprint 1, Priority Access & Resident Matching,
  Verification/Jira Sync/Sprint 1 Kickoff); renumbered the Conclusion page
  footer. Both decks' originals backed up to the scratchpad before editing.
- Verified geometrically (shape bounds + overlap checks in python-pptx) since
  no PowerPoint/LibreOffice renderer was available in this environment to
  visually preview the result — caught and fixed two real bullet-list/caption
  overlaps this way before finalizing. Not visually eyeballed in an actual
  slide viewer; worth a quick look before presenting.

**Still outstanding:**
- Merge PR #2 into `develop` (or get review feedback).
- Start actual `weatherService.js` implementation on
  `feature/SCRUM-23-live-weather-integration` — branch exists, no code yet.
- Open the two decks in PowerPoint/Keynote at least once to confirm the new
  slides render as intended (geometry was checked programmatically, not
  eyeballed).

---

## 2026-09-14 — Backend verification pass + PM/Scrum agent added

**Context:** Development moved into Claude Code. Added `CLAUDE.md` (project context, loaded
automatically), a `scrum-master` agent, this log, and `docs/VERIFICATION.md`.

**Verified working** — full backend run against a clean PostgreSQL + PostGIS database
(schema → seeds → recompute → all endpoints):

- `schema.sql`, `seed_areas.sql`, `seed_sites.sql` all load clean. Counts: 1 org, 11 sites,
  5 areas.
- `GET /api/sites` — all, proximity (PostGIS `ST_DWithin`, nearest-first: Sunnyside
  Community Center 1.5 km → Park Place Library 8.8 km), `type` filter, `open_only` filter.
- `GET /api/sites/:id` — detail + inventory join.
- `PATCH /api/sites/:id/status` — updates and flips the site into `open_only` results;
  invalid status correctly rejected 400.
- `GET /api/geocode/zip/:zip` (SCRUM-28) — local pilot-ZIP table and the Zippopotam.us
  fallback both resolve; bad input rejected 400.
- `GET /api/risk-areas` (SCRUM-12→17) — ranks correctly after recompute; region filter works.
- `POST /api/risk-areas/:id/recompute` — returns score + component breakdown.
- `GET /api/orgs/:id/sites` — 11. `npm run recompute-risk` — recomputes all 5.

**Not verified:** the frontend UI (map render, priority overlay, admin table). Needs a
browser against a running local stack — API contract checked, rendering not.

**Roadblocks / findings:**

1. **Seeding without recomputing breaks the Sprint 0 demo.** A fresh seed leaves
   `risk_score` null and the priority ranking returns a flat tie. `npm run recompute-risk`
   is a mandatory third step. Documented in `docs/VERIFICATION.md`.
2. Malformed UUID returns HTTP 500 instead of 400/404. Open, low severity, ~3-line fix.
3. `?region=` is exact-match — `Houston` returns nothing, `Harris County` works. Needs a
   team decision.
4. `alerts` table has no seed data — the heat-alerts panel is empty in any demo.

**Still outstanding (unchanged, only the user can do these):**

- Run the three-step DB sequence against the real local database.
- `git push -u origin feature/site-directory-seed` and open the PR into `develop`.
- Refresh both decks' screenshots with real Texas data once the above are done.
