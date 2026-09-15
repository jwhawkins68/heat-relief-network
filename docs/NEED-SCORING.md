# Resident Need Scoring — Methodology

**Epic:** SCRUM-29 — Priority Access and Resident Matching
**Implementation:** `backend/src/services/needScore.js`, `backend/src/services/serviceMatch.js`
**Related:** area-level scoring is documented separately (`backend/src/services/riskScore.js`, SCRUM-17).

This system has two scoring engines and they answer different questions:

| | Question | Unit | File |
|---|---|---|---|
| Area risk score | Which *neighborhoods* need outreach? | A ZIP-level area | `riskScore.js` |
| Resident need score | Which *people* need help first, and what kind? | A registered household | `needScore.js` |

---

## 1. This is a rule-based function, not a trained model

The need score is a transparent weighted sum. That is a deliberate design decision,
not a placeholder for "real AI."

This function influences who gets prioritized access to a life-safety resource during
extreme heat. Three things follow:

1. **A caseworker must be able to explain a result to the resident's face.** Every
   scoring branch emits a plain-language sentence, and those sentences are what the
   resident actually sees — not the number.
2. **A reviewer must be able to audit the weights.** They are constants in one file,
   listed below, each traceable to a public-health source.
3. **A wrong answer must be correctable.** Weights can be changed in one line and the
   whole corpus re-scored. A trained model would require retraining and revalidation.

The same reasoning applied to `riskScore.js` and is applied consistently here.

## 2. Scoring rubric

Maximum 100 points. Four factors plus one household modifier.

### Age — up to 35 points

| Condition | Points |
|---|---|
| 75 or older | 35 |
| 65–74 | 28 |
| 55–64 | 12 |
| 18–54 | 5 |

*Basis:* CDC identifies adults 65+ as a primary heat-mortality risk group — the body's
ability to thermoregulate and to sense thirst both decline with age, and heat-related
death rates rise sharply above 75. This is the heaviest single factor because it is the
best-evidenced one.

### Income relative to the Federal Poverty Level — up to 30 points

| Condition | Points |
|---|---|
| At or below 100% FPL | 30 |
| 101–138% FPL | 24 |
| 139–200% FPL | 16 |
| 201–400% FPL | 6 |
| Above 400% FPL | 0 |

*Basis:* HHS poverty guidelines (48 contiguous states), currently the **2025**
guidelines: `$15,650` for a one-person household, `+$5,500` per additional person.
Both numbers are constants in `needScore.js` under `FPL` — the annual update is a
two-line change.

Income is scored *relative to household size*, not as a raw figure. A $40,000 income
means something very different for one person than for a family of five, and scoring
the raw number would systematically under-prioritize larger households.

The 138% band exists because it is the Medicaid expansion threshold. Texas has not
expanded Medicaid, so households in the 100–138% range frequently have no realistic
coverage path at all — a gap that matters specifically in the pilot region.

### Employment status — up to 20 points

| Status | Points |
|---|---|
| Outdoor worker | 20 |
| Unable to work | 18 |
| Unemployed | 16 |
| Retired | 10 |
| Part-time | 8 |
| Student | 6 |
| Full-time indoor | 2 |

*Basis:* Outdoor occupations (construction, landscaping, agriculture, delivery) carry
by far the highest occupational heat-fatality rate — the worker is exposed during the
hottest hours by definition and often cannot leave the site. The non-working categories
score highly for a different reason: more hours spent at home, and less financial slack
to run air conditioning through a Texas summer.

### Insurance status — up to 15 points

| Status | Points |
|---|---|
| None | 15 |
| Government assistance | 8 |
| Personal / employer | 0 |

*Basis:* Insurance status is a proxy for whether early heat illness gets treated or
becomes an emergency. Uninsured people delay care; heat exhaustion that would have been
a clinic visit becomes heat stroke.

### Household modifier — +10 points

Applied when a child under 5 lives in the household. Under-5s are the other CDC-identified
high-risk group, and the registrant's own age does not capture them. The total is clamped
to 100, so this modifier can push someone to the ceiling but not past it.

### Tiers

| Tier | Score | Label |
|---|---|---|
| 1 | 70–100 | Urgent |
| 2 | 45–69 | Elevated |
| 3 | 0–44 | Standard |

Both thresholds are inclusive at the lower bound, and both boundaries are covered by
unit tests in `backend/test/needScore.test.js`.

## 3. Service matching

The score decides *how urgently*. Matching decides *what kind of site*, and it is a
separate rule chain (`serviceMatch.js`) evaluated top to bottom, first match wins:

| If | Recommend, in order | Why |
|---|---|---|
| Child under 5 in household | Splash pad → cooling center | Water play is what families with toddlers actually use; a quiet adult cooling room goes unused |
| Age 65+ or unable to work | Cooling center → water station | Sustained AC, seating, and staff presence matter more than water access |
| Outdoor worker | Water station → shade → cooling center | Cannot leave a job site for hours; hydration and shaded breaks fit the real constraint |
| Uninsured and Tier 1 | Cooling center → water station | Staffed sites are the ones that notice someone in trouble early |
| Otherwise | Cooling center | General-purpose relief |

Recommended types are then resolved to **real open sites** within 15 miles using the
existing PostGIS proximity query. If nothing of the recommended type is open nearby,
the response says so explicitly and falls back to the nearest open site of any type —
it never returns a silent empty list.

## 4. Limitations and fairness

Stated plainly, because pretending these away would be the actual failure:

- **Income is self-reported and unverified.** There is no verification step and none is
  planned; adding one would deter exactly the people the system exists to reach.
- **The rubric cannot see housing quality.** Whether someone's AC works, whether they
  can afford to run it, and whether their building retains heat are all invisible to it.
  This is the same `pct_no_ac` data gap documented for the area-level score (SCRUM-22).
- **Disability is not captured.** "Unable to work" is a blunt and incomplete proxy.
- **Anyone without an invite is invisible.** The invite model is a deliberate trade-off:
  it keeps the queue meaningful and tied to real partner relationships, but it means the
  most isolated residents — no clinic, no case worker, no community org — are the least
  likely to be in it. The public map remains open to everyone without registration
  specifically so the unregistered are not left with nothing.
- **The weights are expert-judgment estimates, not fitted parameters.** They are
  defensible from public-health literature but they have not been validated against
  outcomes, because no outcome data exists yet.

## 5. What replacing this with a trained model would require

Not "more data" in the abstract — specifically:

1. **Labeled outcomes.** Heat-related ER visits, welfare-check outcomes, or verified
   site usage, linked to registrations. None of this exists today.
2. **Bias testing across protected groups.** A model fitted on historical outreach data
   would learn historical outreach patterns, including who was historically missed.
   Any candidate model needs measured error rates by race, age, disability, and
   neighborhood before it goes anywhere near a live queue.
3. **A human override step.** A caseworker must be able to raise or lower a tier and
   have that recorded, with the reason.
4. **Retained explainability.** If the replacement cannot state why it ranked someone
   where it did, it does not meet the requirement this feature was built around, no
   matter how accurate it is on average.

Until all four exist, the transparent function stays.

## 6. Data handling

| Field | Why it's collected | Exposure |
|---|---|---|
| Name | Outreach contact | Shown in admin queue |
| Street address | Helps outreach find the resident | Optional; stored, not shown in the queue |
| City / ZIP | Site proximity matching | Shown in admin queue |
| Age | Scoring | Shown in admin queue |
| Household size, child under 5 | Scoring (FPL + modifier) | Shown in admin queue |
| Employment status | Scoring + service matching | Shown in admin queue |
| Insurance status | Scoring | Shown in admin queue |
| **Annual income** | Scoring (converted to % FPL) | **Never leaves the server.** `GET /api/residents` returns a coarse band only |

Rules enforced in code:

- `GET /api/residents` strips `fpl_pct` and returns `income_band` — one of
  "Below poverty line", "Below 200% FPL", "Above 200% FPL". The raw figure is never
  serialized to the browser.
- Registration failures log the error message only, never the request body.
- Registration requires an explicit, unchecked-by-default consent box; the submit
  button stays disabled until it is ticked. The consent text states what is stored and
  who can see it.

**Retention:** intake records are kept for the duration of the pilot and deleted at its
conclusion. There is no production retention policy because there is no production
deployment. Before any real deployment this needs: encryption at rest, a defined
retention window, a resident-initiated deletion path, and a review of whether an
academic project should be holding this data at all.
