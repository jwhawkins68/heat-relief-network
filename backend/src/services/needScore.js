// Heat Relief Network — resident need scoring (the "priority access" agent).
//
// WHY THIS APPROACH (same reasoning as riskScore.js, different unit):
// riskScore.js scores PLACES — which neighborhoods need outreach.
// This file scores PEOPLE — which residents need help first, and why.
//
// This is a transparent, rule-based function, NOT a trained model. That is a
// deliberate choice, not a shortcut. This function helps decide who gets
// prioritized access to a life-safety resource during extreme heat. A model
// that cannot explain itself is indefensible for that job: a caseworker must
// be able to tell a resident exactly why they were ranked where they were,
// and a reviewer must be able to audit the weights.
//
// Every scoring branch contributes a plain-language sentence to `reasons`,
// so the output is self-documenting.
//
// UPGRADE PATH: see docs/NEED-SCORING.md. Replacing this with a trained model
// requires labeled outcome data, bias testing across protected groups, and a
// human override step — none of which exist yet.

// ─────────────────────────────────────────────
// Federal Poverty Level guidelines.
// Source: HHS poverty guidelines, 48 contiguous states + DC.
// Update these two numbers once a year; nothing else needs to change.
// ─────────────────────────────────────────────
const FPL = {
  year: 2025,
  basePerson: 15650,
  perAdditionalPerson: 5500,
};

// Max contribution of each factor. Sums to 100.
const MAX_POINTS = {
  age: 35,
  income: 30,
  employment: 20,
  insurance: 15,
};

// Extra weight when a household includes a child under 5. Under-5s are the
// other CDC-identified high-risk group alongside adults 65+, and the
// registrant's own age does not capture them.
const CHILD_UNDER_5_MODIFIER = 10;

const TIER_THRESHOLDS = { urgent: 70, elevated: 45 };

const EMPLOYMENT_POINTS = {
  outdoor_worker: 20,   // highest occupational heat-fatality rate
  unable_to_work: 18,
  unemployed: 16,
  retired: 10,
  part_time: 8,
  student: 6,
  full_time_indoor: 2,
};

const INSURANCE_POINTS = {
  none: 15,
  government_assistance: 8,
  personal: 0,
};

/** Federal poverty threshold in dollars for a given household size. */
function fplThreshold(householdSize) {
  const size = Math.max(1, Number(householdSize) || 1);
  return FPL.basePerson + (size - 1) * FPL.perAdditionalPerson;
}

/** Household income as a percentage of the federal poverty level. */
function fplPercent(annualIncome, householdSize) {
  const income = Math.max(0, Number(annualIncome) || 0);
  return Math.round((income / fplThreshold(householdSize)) * 100);
}

function scoreAge(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return { points: 0, reason: null };
  if (a >= 75) {
    return { points: 35, reason: 'Age 75 or older — the highest-risk group for heat-related death.' };
  }
  if (a >= 65) {
    return { points: 28, reason: 'Age 65 or older — the body regulates heat less effectively with age.' };
  }
  if (a >= 55) {
    return { points: 12, reason: 'Age 55 to 64 — heat tolerance begins to decline in this range.' };
  }
  return { points: 5, reason: null };
}

function scoreIncome(annualIncome, householdSize) {
  const pct = fplPercent(annualIncome, householdSize);
  if (pct <= 100) {
    return { points: 30, pct, reason: 'Household income is at or below the federal poverty line.' };
  }
  if (pct <= 138) {
    return { points: 24, pct, reason: 'Household income is near the poverty line, where cooling costs compete with rent and food.' };
  }
  if (pct <= 200) {
    return { points: 16, pct, reason: 'Household income is below 200% of the poverty line.' };
  }
  if (pct <= 400) {
    return { points: 6, pct, reason: null };
  }
  return { points: 0, pct, reason: null };
}

function scoreEmployment(employmentStatus) {
  const points = EMPLOYMENT_POINTS[employmentStatus] ?? 0;
  const reasons = {
    outdoor_worker: 'Works outdoors during peak heat hours, with limited ability to leave the job site.',
    unable_to_work: 'Unable to work, which often means longer hours spent at home without cooling.',
    unemployed: 'Currently unemployed, which limits ability to absorb higher summer utility bills.',
    retired: 'Retired, and likely to spend the hottest hours of the day at home.',
  };
  return { points, reason: reasons[employmentStatus] ?? null };
}

function scoreInsurance(insuranceStatus) {
  const points = INSURANCE_POINTS[insuranceStatus] ?? 0;
  const reasons = {
    none: 'No health insurance to fall back on if heat illness sets in.',
    government_assistance: 'Relies on government health assistance, which can mean delayed or limited care.',
  };
  return { points, reason: reasons[insuranceStatus] ?? null };
}

function tierFor(score) {
  if (score >= TIER_THRESHOLDS.urgent) return { tier: 1, label: 'Priority 1 — Urgent' };
  if (score >= TIER_THRESHOLDS.elevated) return { tier: 2, label: 'Priority 2 — Elevated' };
  return { tier: 3, label: 'Priority 3 — Standard' };
}

/**
 * Score a resident's intake answers into a 0-100 need score with a tier,
 * a per-factor breakdown, and plain-language reasons.
 *
 * @param {{ age:number, household_size:number, children_under_5:boolean,
 *           employment_status:string, insurance_status:string,
 *           annual_income:number }} intake
 */
function scoreResident(intake) {
  const age = scoreAge(intake.age);
  const income = scoreIncome(intake.annual_income, intake.household_size);
  const employment = scoreEmployment(intake.employment_status);
  const insurance = scoreInsurance(intake.insurance_status);

  const childModifier = intake.children_under_5 ? CHILD_UNDER_5_MODIFIER : 0;

  const raw =
    age.points + income.points + employment.points + insurance.points + childModifier;
  const score = Math.min(100, raw);

  const reasons = [
    age.reason,
    income.reason,
    employment.reason,
    insurance.reason,
    childModifier
      ? 'A child under 5 lives in the household — young children overheat faster than adults.'
      : null,
  ].filter(Boolean);

  // If nothing scored high enough to generate a sentence, say something true
  // rather than showing an empty list.
  if (reasons.length === 0) {
    reasons.push('No elevated heat-risk factors were reported, so standard access applies.');
  }

  const { tier, label } = tierFor(score);

  return {
    score,
    tier,
    tier_label: label,
    fpl_pct: income.pct,
    factors: {
      age: age.points,
      income: income.points,
      employment: employment.points,
      insurance: insurance.points,
      children_under_5: childModifier,
    },
    reasons,
  };
}

/**
 * Coarse income band for display. The admin queue shows THIS, never the raw
 * dollar figure the resident typed — see docs/NEED-SCORING.md.
 */
function incomeBand(fplPct) {
  if (fplPct === null || fplPct === undefined) return 'Not reported';
  if (fplPct <= 100) return 'Below poverty line';
  if (fplPct <= 200) return 'Below 200% FPL';
  return 'Above 200% FPL';
}

export {
  scoreResident,
  fplPercent,
  fplThreshold,
  incomeBand,
  tierFor,
  FPL,
  MAX_POINTS,
  EMPLOYMENT_POINTS,
  INSURANCE_POINTS,
  TIER_THRESHOLDS,
};
