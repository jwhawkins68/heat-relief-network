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

Those thresholds are NWS's, not ours — we did not invent a scale. On top of the
band, two local conditions can escalate severity: a **risk score at or above 28**
(`HIGH_RISK_SCORE`), and **no open relief site within 8 km / ~5 miles**
(`NO_RELIEF_RADIUS_M`). An area that is hot, vulnerable, and has nowhere to go
is treated more urgently than an area that is merely hot.

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

Greedy is the right algorithm here and not a shortcut. An optimal assignment
would take longer to compute and be harder to explain, and the marginal gain is
noise against the real-world variance in how long a check-in takes.

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

## 7. What would have to change to use a trained model

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

## 8. Running all three

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
