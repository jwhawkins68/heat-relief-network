// Heat Relief Network — area risk scoring.
//
// WHY THIS APPROACH (not a neural net / LLM):
// This is a lightweight, transparent, rule-based composite score (0-100)
// estimating how urgently an area needs heat-relief resources. It's the
// same approach public-health "heat vulnerability index" tools use.
// It was chosen over a trained ML model for now because:
//   1. It requires zero training data — we don't yet have labeled ground
//      truth (e.g. historical heat-related ER visits per area) to train
//      or validate a model against.
//   2. It's fully explainable — an org partner or reviewer can see
//      exactly why an area scored the way it did (see `breakdown` below).
//   3. It's genuinely "lightweight": no ML runtime, sub-millisecond to
//      compute, trivial to unit test.
//
// UPGRADE PATH: once real outcome data exists, replace this function's
// internals with a small trained model (e.g. scikit-learn/XGBoost
// gradient-boosted tree, exported to ONNX and run via `onnxruntime-node`,
// or a logistic regression whose coefficients get hand-translated into
// this same function shape). The function signature and callers below
// would not need to change — only what happens inside computeVulnerabilityScore.

// Weights sum to 1.0. Tune these as real data becomes available.
const WEIGHTS = {
  heatIndex: 0.35,
  pctNoAc: 0.3,
  pctElderly: 0.2,
  pctLowIncome: 0.15,
};

// NWS heat index bands: <80 = safe/caution, 130+ = extreme danger.
const HEAT_INDEX_MIN = 80;
const HEAT_INDEX_MAX = 130;

function clampPct(value) {
  if (value === null || value === undefined) return 0;
  return Math.min(Math.max(Number(value), 0), 100);
}

/** Map a Fahrenheit heat index to a 0-100 severity score. */
function normalizeHeatIndex(heatIndexF) {
  if (heatIndexF === null || heatIndexF === undefined) return 0;
  const clamped = Math.min(Math.max(Number(heatIndexF), HEAT_INDEX_MIN), HEAT_INDEX_MAX);
  return ((clamped - HEAT_INDEX_MIN) / (HEAT_INDEX_MAX - HEAT_INDEX_MIN)) * 100;
}

/**
 * Compute a 0-100 base vulnerability score for an area, plus a breakdown
 * showing how much each factor contributed (for transparency/debugging).
 *
 * @param {{ heat_index_f?: number, pct_elderly?: number, pct_low_income?: number, pct_no_ac?: number }} area
 */
function computeVulnerabilityScore(area) {
  const heatComponent = normalizeHeatIndex(area.heat_index_f) * WEIGHTS.heatIndex;
  const noAcComponent = clampPct(area.pct_no_ac) * WEIGHTS.pctNoAc;
  const elderlyComponent = clampPct(area.pct_elderly) * WEIGHTS.pctElderly;
  const lowIncomeComponent = clampPct(area.pct_low_income) * WEIGHTS.pctLowIncome;

  const total = heatComponent + noAcComponent + elderlyComponent + lowIncomeComponent;

  return {
    score: Math.round(total * 10) / 10,
    breakdown: {
      heatIndex: Math.round(heatComponent * 10) / 10,
      pctNoAc: Math.round(noAcComponent * 10) / 10,
      pctElderly: Math.round(elderlyComponent * 10) / 10,
      pctLowIncome: Math.round(lowIncomeComponent * 10) / 10,
    },
  };
}

/**
 * Turn a base vulnerability score + distance to the nearest open site into
 * a final priority score. An area with no open site nearby ranks above an
 * equally-vulnerable area with a cooling center three blocks away.
 *
 * @param {number} vulnerabilityScore 0-100
 * @param {number|null} nearestOpenSiteDistanceM meters, or null if none open at all
 */
function applyResourceGap(vulnerabilityScore, nearestOpenSiteDistanceM) {
  const MAX_GAP_BONUS = 15;
  const NEAR_M = 500;   // within 500m: no bonus, well-covered
  const FAR_M = 2000;   // beyond 2km: full bonus, effectively uncovered

  let gapBonus;
  if (nearestOpenSiteDistanceM === null || nearestOpenSiteDistanceM === undefined) {
    gapBonus = MAX_GAP_BONUS; // no open site at all
  } else {
    const ratio = (nearestOpenSiteDistanceM - NEAR_M) / (FAR_M - NEAR_M);
    gapBonus = Math.max(0, Math.min(1, ratio)) * MAX_GAP_BONUS;
  }

  return Math.round((vulnerabilityScore + gapBonus) * 10) / 10;
}

export { computeVulnerabilityScore, applyResourceGap, normalizeHeatIndex, WEIGHTS };
