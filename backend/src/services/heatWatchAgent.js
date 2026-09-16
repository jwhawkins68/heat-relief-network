// HeatSafe — Heat Emergency Watch agent.
//
// WHAT MAKES THIS AN AGENT RATHER THAN A CHATBOT:
// Nobody asks it anything. It runs on a schedule, reads the current state of
// every pilot area, decides whether conditions have crossed into an advisory,
// warning or emergency, and acts — writing an alert row and building a
// prioritized list of registered residents who should be contacted first.
//
// WHY IT READS areas.heat_index_f RATHER THAN CALLING NWS DIRECTLY:
// The weather integration (SCRUM-23) owns fetching live conditions, and the
// batch recompute job (SCRUM-26) owns writing them onto each area. This agent
// deliberately sits downstream of both. That keeps one owner per concern, and
// it means the agent needs no change at all when live weather lands — the same
// column simply starts carrying real readings instead of seeded ones.
//
// Like riskScore.js and needScore.js, every decision carries its reasons. An
// agent that escalates a neighborhood to "emergency" without being able to say
// why is not something an org should act on.

import pool from '../db/pool.js';

// National Weather Service heat index bands (°F).
const NWS = {
  CAUTION: 80,          // fatigue possible with prolonged exposure
  EXTREME_CAUTION: 90,  // heat cramps / exhaustion possible
  DANGER: 103,          // heat exhaustion likely, heat stroke possible
  EXTREME_DANGER: 125,  // heat stroke highly likely
};

// A vulnerable area with no open relief nearby is materially worse off than an
// equally hot area with a staffed cooling center down the street.
// CALIBRATION: the pilot's five areas currently score 24.8-30.6. Texas housing
// is almost universally air-conditioned, so pct_no_ac -- 30% of the weight in
// riskScore.js -- sits at 6-10% and pulls every score down. A threshold of 40
// would therefore never fire against real data. 28 puts roughly the top half of
// the observed distribution above the line. REVISIT once SCRUM-19 lands live
// Census figures, because pct_elderly and pct_low_income will shift the spread.
const HIGH_RISK_SCORE = 28;        // risk_score at/above this counts as high
const NO_RELIEF_RADIUS_M = 8000;   // ~5 miles

const SEVERITY_RANK = { advisory: 1, warning: 2, emergency: 3 };
const RANK_SEVERITY = { 1: 'advisory', 2: 'warning', 3: 'emergency' };

/** Overnight is 21:00–06:00 local. Heat that does not break overnight denies
 *  the body its recovery window, which is its own risk signal — not a reason
 *  to relax the threshold. */
function isOvernight(now = new Date()) {
  const h = now.getHours();
  return h >= 21 || h < 6;
}

/**
 * Decide the alert level for one area, with the reasons that produced it.
 * Pure function — no database access — so it is straightforward to unit test.
 */
function assessArea(area, { now = new Date() } = {}) {
  // Number(null) is 0, not NaN — so a missing reading must be caught BEFORE
  // coercion, or an area we have no data for reports as "below caution", i.e.
  // safe. Absence of a reading is not evidence of safety.
  const hasHeat = area.heat_index_f !== null && area.heat_index_f !== undefined && area.heat_index_f !== '';
  const hasRisk = area.risk_score !== null && area.risk_score !== undefined && area.risk_score !== '';
  const heat = hasHeat ? Number(area.heat_index_f) : NaN;
  const risk = hasRisk ? Number(area.risk_score) : NaN;
  const reasons = [];

  if (!Number.isFinite(heat)) {
    return {
      severity: null,
      reasons: ['No heat index on record for this area — it cannot be assessed, which is not the same as being safe.'],
      escalated: false,
    };
  }

  let rank = 0;
  if (heat >= NWS.EXTREME_DANGER) {
    rank = 3;
    reasons.push(`Heat index ${heat}°F is in the NWS extreme danger band (125°F+).`);
  } else if (heat >= NWS.DANGER) {
    rank = 2;
    reasons.push(`Heat index ${heat}°F is in the NWS danger band (103–124°F).`);
  } else if (heat >= NWS.EXTREME_CAUTION) {
    rank = 1;
    reasons.push(`Heat index ${heat}°F is in the NWS extreme caution band (90–102°F).`);
  } else if (heat >= NWS.CAUTION) {
    reasons.push(`Heat index ${heat}°F is elevated but below the advisory threshold.`);
    return { severity: null, reasons, escalated: false };
  } else {
    return { severity: null, reasons: [`Heat index ${heat}°F is below caution levels.`], escalated: false };
  }

  // Escalation: conditions are dangerous AND this neighborhood is both
  // vulnerable and uncovered. Capped at emergency.
  let escalated = false;
  const vulnerable = Number.isFinite(risk) && risk >= HIGH_RISK_SCORE;
  const uncovered = area.nearest_open_site_m === null || area.nearest_open_site_m === undefined;

  if (vulnerable && uncovered && rank < 3) {
    rank += 1;
    escalated = true;
    reasons.push(
      `Escalated: vulnerability score ${risk} is high and no open relief site was found within ` +
      `${Math.round(NO_RELIEF_RADIUS_M / 1609.34)} miles.`
    );
  } else if (vulnerable) {
    reasons.push(`Vulnerability score ${risk} is high for this area.`);
  }

  if (isOvernight(now) && rank >= 2) {
    reasons.push('Conditions have not broken overnight, so residents get no recovery window.');
  }

  return { severity: RANK_SEVERITY[rank] ?? null, reasons, escalated };
}

/** Areas with their current conditions and whether any OPEN site is nearby. */
async function loadAreaState() {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.region, a.population, a.heat_index_f, a.risk_score,
            ST_X(a.centroid::geometry) AS lon, ST_Y(a.centroid::geometry) AS lat,
            (SELECT MIN(ST_Distance(s.location, a.centroid))
               FROM sites s
              WHERE s.status = 'open'
                AND ST_DWithin(s.location, a.centroid, $1)) AS nearest_open_site_m
       FROM areas a
      ORDER BY a.risk_score DESC NULLS LAST`,
    [NO_RELIEF_RADIUS_M]
  );
  return rows;
}

/** An alert already covering this region at this severity or higher. */
async function hasActiveAlert(region, severity) {
  const { rows } = await pool.query(
    `SELECT severity FROM alerts
      WHERE region = $1
        AND starts_at <= now()
        AND (ends_at IS NULL OR ends_at > now())`,
    [region]
  );
  const wanted = SEVERITY_RANK[severity] ?? 0;
  return rows.some((r) => (SEVERITY_RANK[r.severity] ?? 0) >= wanted);
}

/**
 * Residents near an affected area who should be contacted first.
 * Tier 1 before Tier 2, highest need score first within each.
 * Returns [] (not an error) if the priority-access migration has not been run.
 */
async function contactListForArea(area, limit = 25) {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, city, zip, priority_tier, need_score,
              ROUND((ST_Distance(location, ST_MakePoint($1, $2)::geography) / 1609.34)::numeric, 1) AS distance_mi
         FROM residents
        WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
          AND priority_tier <= 2
        ORDER BY priority_tier ASC, need_score DESC
        LIMIT $4`,
      [area.lon, area.lat, NO_RELIEF_RADIUS_M, limit]
    );
    return rows;
  } catch (err) {
    if (err.code === '42P01') return null; // residents table does not exist yet
    throw err;
  }
}

function buildMessage(area, assessment) {
  const label = assessment.severity.toUpperCase();
  return (
    `${label}: ${area.name} — heat index ${area.heat_index_f}°F. ` +
    assessment.reasons.join(' ')
  );
}

/**
 * Run one watch cycle.
 *
 * @param {{ dryRun?: boolean, now?: Date }} opts
 *   dryRun: assess and report, but write no alert rows. Use it to preview.
 */
async function runHeatWatch({ dryRun = false, now = new Date() } = {}) {
  const areas = await loadAreaState();
  const assessments = [];
  let alertsCreated = 0;
  let suppressed = 0;
  let residentsTableMissing = false;

  for (const area of areas) {
    const assessment = assessArea(area, { now });

    const entry = {
      area: area.name,
      region: area.region,
      heat_index_f: area.heat_index_f === null ? null : Number(area.heat_index_f),
      risk_score: area.risk_score === null ? null : Number(area.risk_score),
      open_site_nearby: area.nearest_open_site_m !== null,
      severity: assessment.severity,
      escalated: assessment.escalated,
      reasons: assessment.reasons,
      alert_created: false,
      contacts: [],
    };

    if (assessment.severity) {
      const already = await hasActiveAlert(area.region, assessment.severity);
      if (already) {
        suppressed += 1;
        entry.reasons.push('An active alert of equal or greater severity already covers this county — not duplicating it.');
      } else if (!dryRun) {
        await pool.query(
          `INSERT INTO alerts (region, severity, message, source, starts_at, ends_at)
           VALUES ($1, $2, $3, 'heat-watch-agent', now(), now() + interval '6 hours')`,
          [area.region, assessment.severity, buildMessage(area, assessment)]
        );
        alertsCreated += 1;
        entry.alert_created = true;
      }

      const contacts = await contactListForArea(area);
      if (contacts === null) residentsTableMissing = true;
      else entry.contacts = contacts;
    }

    assessments.push(entry);
  }

  const acting = assessments.filter((a) => a.severity);

  return {
    ran_at: now.toISOString(),
    dry_run: dryRun,
    areas_assessed: areas.length,
    areas_alerting: acting.length,
    alerts_created: alertsCreated,
    alerts_suppressed_as_duplicate: suppressed,
    residents_contacted: acting.reduce((n, a) => n + a.contacts.length, 0),
    note: residentsTableMissing
      ? 'The residents table does not exist yet, so no contact lists were built. Run migration_priority_access.sql to enable them.'
      : null,
    assessments,
  };
}

export { runHeatWatch, assessArea, NWS, HIGH_RISK_SCORE, NO_RELIEF_RADIUS_M };
