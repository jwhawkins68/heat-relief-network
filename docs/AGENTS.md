# HeatSafe — The Agents

*Last updated: 2026-09-16 · Covers `backend/src/services/heatWatchAgent.js`,
`dispatchAgent.js`, `siteFreshnessAgent.js`*

---

## 1. What we mean by "agent"

The word gets used loosely, so it is worth being precise about what we built,
because it is not what most people picture when a class project says "we added
AI."

**We did not build a chatbot.** A chatbot is reactive: it sits still until a
human types a question, and its output is text for that human to read. Nothing
happens if nobody asks.

**An agent is proactive.** It watches a data source on a schedule, applies a
decision rule to what it sees, and takes an action — writing a record,
producing a plan, flagging something for a human — without anyone prompting it.
The test we used: *if every human walks away from the keyboard for twelve
hours, does this thing still do useful work?* All three of ours pass that test.
A chatbot does not.

Concretely, each agent has four parts:

| Part | Question it answers |
|---|---|
| **Trigger** | What wakes it up? (a cron schedule, or an operator pressing Run) |
| **Perception** | What does it read to understand the current state? |
| **Decision** | What rule turns that state into a judgment? |
| **Action** | What does it change or produce in the world? |

---

## 2. Why rules and not a language model

Every one of these agents makes decisions about who gets contacted first during
a heat emergency. That is a life-safety ranking, and it carries two hard
constraints that pointed us away from an LLM:

1. **It has to be explainable to the person it ranks.** If a resident asks why
   the system put someone else ahead of them, "the model said so" is not an
   answer we are willing to give. Every agent output includes a `reasons` array
   in plain English — the literal conditions that fired.
2. **It has to be deterministic.** The same inputs must produce the same
   priority order every time. A coordinator cannot plan a shift against a
   system that reshuffles its answer on re-run.

There is also a third, more mundane reason: **we have no labeled outcome data.**
Training a model to predict heat-related harm would require records of who
actually came to harm, which we do not have and, as a student project, should
not have. Rules encode published public-health guidance instead; see
`docs/NEED-SCORING.md` for where each weight comes from.

The upgrade path is written down rather than hand-waved — see §7.

---

## 3. Agent 1 — Heat Emergency Watch

**File:** `backend/src/services/heatWatchAgent.js`
**Run it:** `npm run heat-watch --prefix backend` (add `-- --dry-run` to preview)
**API:** `POST /api/agents/heat-watch/run?dry_run=true` (admin-gated)
**Suggested cadence:** every 30 minutes

### What it does

Watches the heat index and risk score of every pilot area. When an area crosses
into dangerous territory, it opens an alert for that region *and* assembles the
list of registered residents in that area who should be contacted first, ordered
by their need score.

This is the agent that most clearly is not a chatbot: nobody asks it anything.
At 2am on a Saturday it notices that Harris County crossed 103°F and writes the
alert and the call list.

### The decision rule

Severity comes from the National Weather Service heat-index bands, unmodified:

| Band | Heat index (°F) |
|---|---|
| Caution | 80 |
| Extreme caution | 90 |
| Danger | 103 |
| Extreme danger | 125 |

Those thresholds are NWS's, not ours — we did not invent a scale.

On top of the band, severity can escalate **one step**, and only when *both*
local conditions hold:

```js
const vulnerable = Number.isFinite(risk) && risk >= HIGH_RISK_SCORE;   // >= 28
const uncovered  = area.nearest_open_site_m == null;                   // none within 8 km
if (vulnerable && uncovered && rank < 3) { rank += 1; }
```

**Why both and not either.** Each condition alone describes a situation the
system already handles. A vulnerable neighborhood that has an open cooling
center within five miles has somewhere to send people — the ordinary alert is
the right response. A neighborhood with no nearby open site but a low
vulnerability score is mostly households who can cope at home. It is the
*intersection* that is dangerous: people least able to withstand the heat, with
nowhere to go. Escalating on either condition alone would fire on most of the
map during a heat event, and an alert level that is always elevated stops
carrying information.

**Why it is capped.** The escalation adds exactly one rank and only when
`rank < 3`, so it can lift advisory to warning or warning to emergency, but it
can never invent a severity above emergency and it can never jump two levels.
An escalation is a modifier on a measured reading, not a replacement for one —
the NWS band is evidence, our local adjustment is judgment, and judgment should
not be able to outrun the evidence by more than a step.

**Overnight is a reason, not an escalation.** If conditions haven't broken
between 9pm and 6am, the agent records that residents are getting no recovery
window — a real risk signal — but it does **not** bump the rank. It goes in the
`reasons` array so a human sees it and can weigh it.

### The bug worth remembering

The first version of this agent had a silent failure that a unit test caught:

```js
// Number(null) is 0, not NaN — so a missing reading must be caught BEFORE
// coercion, or an area we have no data for reports as "below caution", i.e.
// safe. Absence of a reading is not evidence of safety.
const hasHeat = area.heat_index_f !== null && area.heat_index_f !== undefined && area.heat_index_f !== '';
const heat = hasHeat ? Number(area.heat_index_f) : NaN;
```

An area with no temperature reading was coming back as 0°F, which is below
every band, which reported as *safe*. For a heat-safety system, "we have no
data" and "conditions are fine" have to be different answers. They now are: an
area with no reading is reported as unknown, not safe.

### Safety rails

- **Duplicate suppression.** It will not re-open an alert that is already open
  at the same or higher severity, so running it every 30 minutes does not
  produce 48 alerts a day.
- **Dry run.** `--dry-run` / `?dry_run=true` performs the full assessment and
  returns exactly what it *would* write, changing nothing. Use this before
  trusting a threshold change.
- **It reads `areas.heat_index_f` from our own database rather than calling the
  NWS API directly.** That was deliberate: live weather ingestion is SCRUM-23,
  a separate story. When that lands and starts populating the column, this agent
  needs no change at all.

---

## 4. Agent 2 — Outreach Dispatch Planner

**File:** `backend/src/services/dispatchAgent.js`
**API:** `GET /api/agents/dispatch/plan?hours=12` (admin-gated, read-only)

### What it does

Takes the volunteer shifts scheduled in the next N hours and produces an
assignment plan: which volunteer visits which residents, in what order, with
the highest-need people first. It also reports **coverage gaps** — high-risk
areas with nobody scheduled — which is often the more valuable half of the
output.

### The decision rule

A greedy assignment with round-robin balancing:

1. For each shift, find the area it serves (nearest area centroid within
   `AREA_MATCH_RADIUS_M = 12000` m, ~7.5 miles).
2. Pull registered residents within `RESIDENT_RADIUS_M = 8000` m (~5 miles) of
   that centroid, ordered by need score descending.
3. Assign up to `MAX_RESIDENTS_PER_SHIFT = 8` — a realistic number of check-ins
   for one shift, not an arbitrary cap.
4. Never double-book: a resident assigned to one shift is removed from the pool.
5. Any area scoring at or above `HIGH_PRIORITY_SCORE = 28` with no shift
   covering it is reported as a gap.

### Greedy versus optimal — stated honestly

Greedy is not the optimal assignment. A solver minimizing total travel while
maximizing need covered would do measurably better on paper, and we are not
claiming otherwise.

We chose greedy for three reasons that hold **at current scale**: at five areas
and a handful of shifts the gap between greedy and optimal is smaller than the
real-world variance in how long a single check-in takes; a greedy plan can be
explained to a coordinator in one sentence per assignment, and a coordinator who
cannot follow the plan will not trust it at 6am; and greedy is stable — adding
one volunteer perturbs one part of the plan, where a solver can reshuffle the
whole thing and destroy a coordinator's mental model overnight.

**We would move to a real solver (OR-Tools, or a min-cost-flow formulation) when
any of these becomes true:**

1. **Scale.** More than ~50 shifts or ~500 residents in a planning window. The
   greedy gap grows with the number of near-ties, and near-ties grow with size.
2. **Hard constraints appear.** Volunteer skills or languages, vehicle capacity,
   accessibility requirements, time windows on individual visits. Greedy has
   nowhere to put a constraint it must satisfy rather than prefer; a solver does.
3. **Travel time stops being proportional to distance.** We currently rank by
   straight-line distance from an area centroid. The moment real routing matters
   — traffic, one-way systems, a river with three bridges — distance ordering
   stops approximating the thing we actually care about.
4. **Someone measures the gap and it is material.** The honest version of this
   trigger: instrument a season of real plans, compute what an optimal assignment
   would have covered, and switch if the difference is more than a few percent of
   residents reached. We have not measured it. Until we do, "greedy is good
   enough here" is a reasoned judgment, not a demonstrated fact.

### Safety rails

- **It proposes; a coordinator disposes.** This endpoint is `GET` and writes
  nothing to the database. A human reads the plan and decides.
- Coverage gaps are reported rather than silently absorbed, so an area with no
  volunteers is visible instead of just absent from the plan.

---

## 5. Agent 3 — Site Status Freshness

**File:** `backend/src/services/siteFreshnessAgent.js`
**Run it:** `npm run site-freshness --prefix backend` (add `-- --expire` to act)
**API:** `POST /api/agents/site-freshness/run?expire=true` (admin-gated)
**Suggested cadence:** daily at 6am

### What it does

Answers a question the rest of the system quietly assumes: *how far can we still
trust what this site told us?* A cooling center that reported "open" nine days
ago is not meaningfully open. Sending a resident there on the strength of a
stale claim is the specific failure this agent exists to prevent.

It assigns every site a confidence band and ranks what an organization should
re-confirm first.

### The decision rule

Staleness thresholds are **conditional on the weather**, which is the idea that
makes this agent more than a timestamp check:

| Condition | Aging after | Stale after |
|---|---|---|
| Normal | 72 hours | 7 days |
| Under heat pressure (area ≥ 103°F) | 12 hours | 48 hours |

The same three-day-old status is fine in April and dangerous in August. During a
heat event, sites open and close and hit capacity on a timescale of hours, so
the window in which a claim stays believable collapses.

Confidence bands: `fresh` · `aging` · `expired` · `unconfirmed` (never reported)
· `unverifiable` (no timestamp at all).

### Safety rails

- **Retirement is opt-in.** By default the agent reports and stops. Retiring a
  claim destroys something a partner organization entered by hand, so it takes
  an explicit `--expire` / `?expire=true`. Report-only is the default for a
  reason and should stay that way.
- Retirement sets status to `unknown`, not `closed`. We do not know that the
  site is closed — we know we stopped knowing. Those are different claims and
  the data should not conflate them.

---

## 6. Calibration — and the mistake we caught

The first versions of Heat Watch and Dispatch both used `HIGH_RISK_SCORE = 40`.
That number was a guess, and it was wrong.

When we ran the agents against the real seeded Texas pilot areas, the actual
risk scores came out between **24.8 and 30.6** — nowhere near 40. Every agent
would have run on schedule, found nothing above threshold, and reported "all
clear" forever. The agents would have looked like they were working while doing
nothing at all, which is worse than being visibly broken.

The cause is a genuine property of the data, not a bug. Our risk score weights
`pct_no_ac` heavily, and in Texas air conditioning is close to universal —
**6–10%** of households lack it, versus the much higher rates that made the
original Los Angeles scaffolding score high. A weight tuned against placeholder
data did not survive contact with real data.

We lowered the threshold to **28**, which sits just below the top of the observed
range, so the highest-need areas fire and the rest do not. The number is recorded
in both agents as a named constant with this reasoning in a comment, and the
Jira acceptance criteria were updated to match.

The general lesson, and the one worth saying out loud in the presentation: **a
threshold is not a decision until you have seen the distribution it sits in.**
We only found this because we ran the agent against real data before declaring
it done.

---

## 7. The boundary: no agent contacts a resident

**None of these agents talks to a resident. Ever. Not by SMS, not by push, not
by email, not by automated call.** Every one of them produces a *list for a
human to act on*:

| Agent | Produces | Acted on by |
|---|---|---|
| Heat Emergency Watch | an alert record + a ranked contact list | an outreach coordinator |
| Outreach Dispatch Planner | a proposed shift assignment | a coordinator, who can override any line |
| Site Status Freshness | a ranked confirm-first list | an org admin |

This is a deliberate design boundary, not a gap we ran out of time to fill, and
**it should survive future changes.** Three reasons:

1. **A wrong automated message during an emergency is worse than no message.**
   If the agent mis-scores someone and an automated system tells a resident to
   go to a site that has closed, we have actively made their situation more
   dangerous. A human in the loop catches the case where the data is stale.
2. **Contact is a relationship, not a notification.** These are partner
   organizations reaching people who are often already known to them. An
   automated blast from an unfamiliar number does not land the same way as a
   call from the clinic they visit.
3. **Accountability needs a person.** If a resident asks why they were contacted
   or why they weren't, someone has to be able to answer. An agent that acts
   directly diffuses that responsibility to nobody.

The system schema anticipates SMS and push (`users.phone`, `notify_sms`, and the
stubbed Twilio/FCM config). **If those are ever wired up, this boundary is the
decision to revisit explicitly and on the record — not something to let slide in
as an implementation detail of a notification story.**

---

## 8. What the agents cannot see

An agent that acts on people should be honest about the edges of its own
perception. These are real limitations, not hedging:

- **Resident data is self-reported and never re-verified.** Age, income,
  employment, insurance, and household composition come from what someone typed
  into the registration form. Nobody checks it, and nothing expires it. A
  resident whose circumstances changed six months ago is still scored on the old
  answers. The agents treat a need score as fact; it is a claim.
- **Site status is only as fresh as the last organization update.** The system
  knows what a partner org last told it, not what is true right now. This is
  exactly why the Site Freshness agent exists — but note what that means: it
  measures *our confidence in a claim*, and cannot measure the claim's accuracy.
  A site that reported "open" two hours ago is `fresh` even if it closed one hour
  ago.
- **Heat index is only as live as the recompute job.** `areas.heat_index_f` is
  currently hand-seeded and will be refreshed on whatever cadence the live NWS
  integration (SCRUM-23) ends up running. The Heat Watch agent inherits that lag
  exactly. It cannot detect a fast-moving change between refreshes, and it has no
  way to know its own reading is stale.
- **Coverage means "a site whose status says open," not "a site a person can
  actually use."** The 8 km no-relief check asks the database, not reality. It
  cannot see that the site has no parking, isn't on a bus route, closed early,
  or is full.
- **Nothing here models transportation.** Distance from an area centroid is a
  proxy for reachability and a poor one for exactly the population we most care
  about — people without a car, in heat, possibly elderly.
- **Areas are coarse.** An area is a ZIP-level unit with one centroid. Everyone
  in it gets the same heat index and the same distance-to-relief, which is wrong
  at the edges of every area and most wrong in the largest ones.
- **`pct_no_ac` has no authoritative free source at this geography** and is
  seeded by judgment. It is weighted heavily in the risk score, so it is the
  single input most capable of being confidently wrong. See §6 for what that
  already cost us once.

The common thread: **every one of these is a reason the output is a
recommendation for a human, not an action.** See §7.

---

## 9. What would have to change to use a trained model

Not "we ran out of time" — a specific list:

1. **Outcome labels.** Heat-related ER visits or 911 calls joined to area and
   date. Without a target variable there is nothing to train.
2. **Enough history.** Multiple heat seasons. One summer of a pilot is not a
   training set.
3. **An explainability layer.** SHAP values or equivalent, because the
   requirement that a resident can be told why they were ranked does not go away
   when the model gets fancier.
4. **A fairness audit.** Any model trained on service-utilization data inherits
   who historically had access to services. That has to be measured before the
   model is allowed to rank people.
5. **A deployment path.** Train in Python (scikit-learn / LightGBM), export to
   ONNX, run in Node via `onnxruntime-node` — or, if the model stays simple
   enough, translate the coefficients straight into the existing scoring
   function and keep the whole thing dependency-free.

Until all five exist, rules are the more defensible engineering choice, not the
lesser one.

---

## 10. Running all three

```bash
# From the repo root
export DATABASE_URL=postgres://<your-user>@localhost:5432/heat_relief

npm run heat-watch     --prefix backend -- --dry-run   # preview, writes nothing
npm run heat-watch     --prefix backend                # act
npm run site-freshness --prefix backend                # report only
npm run site-freshness --prefix backend -- --expire    # act
```

Dispatch has no CLI entry point — it is read-only and lives at
`GET /api/agents/dispatch/plan`, surfaced in the org portal.

All three are also driven from the **Agents panel** in `frontend/admin.html`,
which is the path a non-technical coordinator would use.

Suggested cron for the pilot:

```cron
*/30 * * * *  cd /path/to/heat-relief-network/backend && npm run heat-watch
0 6 * * *     cd /path/to/heat-relief-network/backend && npm run site-freshness
```

### Access

Every agent endpoint sits behind `requireAdmin` — their output names registered
residents and their priority tiers, so it is gated exactly like the resident
queue. See the access-control section of `TOOLS.md`.
