// HeatSafe — Site Status Freshness agent.
//
// THE PROBLEM IT EXISTS TO SOLVE:
// riskScore.js ranks a neighbourhood partly on how far the nearest OPEN site
// is. That half of the engine only works if site status is current. Nothing in
// the system ever asked anyone to keep it current, so every site sat at
// 'unknown' and the distance adjustment silently contributed nothing. The
// scoring engine was fine; it was being starved.
//
// WHAT MAKES THIS AN AGENT RATHER THAN A CHATBOT:
// It runs on a schedule, judges how much each site's status can still be
// trusted given how long ago it was confirmed AND what the weather is doing
// there now, and acts — ranking what an org should re-confirm first, and
// optionally retiring claims that have gone past believable.
//
// WHY STALENESS IS WEIGHED AGAINST CONDITIONS:
// "Open, confirmed four days ago" means something different in mild weather
// than during a 109°F week, when hours get cut, capacity fills and buildings
// close unexpectedly. The same age of claim is more dangerous when it matters
// more, so the thresholds tighten as the heat index climbs.

import pool from '../db/pool.js';

const HOUR = 60 * 60 * 1000;

// Normal conditions.
const NORMAL = { aging: 72 * HOUR, stale: 7 * 24 * HOUR };
// Active heat — an unconfirmed claim decays much faster.
const UNDER_HEAT = { aging: 12 * HOUR, stale: 48 * HOUR };
// The heat index at/above which the tighter thresholds apply (NWS danger band).
const HEAT_PRESSURE_F = 103;

// Only these claims are worth re-confirming or retiring. 'unknown' is already
// honest — it needs a first confirmation, not an expiry.
const ASSERTED = ['open', 'closed', 'full'];

/**
 * Judge one site's status confidence. Pure — no database access — so the rule
 * is directly unit-testable.
 *
 * @param {{status:string, status_updated_at:string|Date|null}} site
 * @param {{now?:Date, areaHeatF?:number|null, areaRisk?:number|null}} ctx
 */
function assessSite(site, { now = new Date(), areaHeatF = null, areaRisk = null } = {}) {
  const underHeat = areaHeatF !== null && areaHeatF !== undefined && Number(areaHeatF) >= HEAT_PRESSURE_F;
  const limits = underHeat ? UNDER_HEAT : NORMAL;
  const reasons = [];

  if (!ASSERTED.includes(site.status)) {
    reasons.push('Status has never been confirmed by an organization, so the priority ranking cannot count this site as relief.');
    return { confidence: 'unconfirmed', action: 'needs_first_confirmation', age_hours: null, under_heat: underHeat, reasons };
  }

  if (!site.status_updated_at) {
    reasons.push(`Status reads "${site.status}" but carries no confirmation timestamp, so its age cannot be established.`);
    return { confidence: 'unverifiable', action: 'needs_confirmation', age_hours: null, under_heat: underHeat, reasons };
  }

  const ageMs = now - new Date(site.status_updated_at);
  const ageHours = Math.round(ageMs / HOUR);

  if (underHeat) {
    reasons.push(`This area is at ${areaHeatF}°F, so status claims are held to a tighter window than usual.`);
  }

  if (ageMs >= limits.stale) {
    reasons.push(`"${site.status}" was last confirmed ${ageHours}h ago, past the ${Math.round(limits.stale / HOUR)}h limit — it should no longer be relied on.`);
    if (site.status === 'open') {
      reasons.push('An expired "open" is worse than "unknown": it actively sends someone to a door that may be locked.');
    }
    return { confidence: 'expired', action: 'retire_to_unknown', age_hours: ageHours, under_heat: underHeat, reasons };
  }

  if (ageMs >= limits.aging) {
    reasons.push(`"${site.status}" was confirmed ${ageHours}h ago and is getting old (limit ${Math.round(limits.stale / HOUR)}h).`);
    return { confidence: 'aging', action: 'needs_confirmation', age_hours: ageHours, under_heat: underHeat, reasons };
  }

  reasons.push(`Confirmed ${ageHours}h ago — still current.`);
  return { confidence: 'fresh', action: 'none', age_hours: ageHours, under_heat: underHeat, reasons };
}

/**
 * How urgently should this site be re-confirmed? Higher sorts first.
 * Staleness sets the floor; the vulnerability and heat of the area it serves
 * decide the order within a band, so scarce staff time goes where a wrong
 * status does the most harm.
 */
function confirmationPriority(assessment, { areaRisk = null, areaHeatF = null } = {}) {
  const base = { expired: 100, unverifiable: 70, unconfirmed: 60, aging: 40, fresh: 0 }[assessment.confidence] ?? 0;
  if (base === 0) return 0;
  const risk = Number.isFinite(Number(areaRisk)) ? Number(areaRisk) : 0;
  const heatBonus = assessment.under_heat ? 15 : 0;
  return Math.round(base + risk * 0.5 + heatBonus);
}

/** Sites with the conditions of the nearest pilot area they serve. */
async function loadSiteState() {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.type, s.address, s.status, s.status_updated_at, s.org_id,
            a.name AS area_name, a.region, a.heat_index_f AS area_heat_f, a.risk_score AS area_risk,
            ROUND((ST_Distance(s.location, a.centroid) / 1609.34)::numeric, 1) AS area_distance_mi
       FROM sites s
       LEFT JOIN LATERAL (
         SELECT ar.name, ar.region, ar.heat_index_f, ar.risk_score, ar.centroid
           FROM areas ar
          ORDER BY ar.centroid <-> s.location
          LIMIT 1
       ) a ON TRUE
      ORDER BY s.name ASC`
  );
  return rows;
}

/**
 * Run one freshness cycle.
 *
 * @param {{ expire?: boolean, now?: Date }} opts
 *   expire: actually retire expired claims to 'unknown'. Defaults to FALSE.
 *   Retiring a claim destroys information an org entered, so the agent reports
 *   what it would retire and waits to be told to do it.
 */
async function runSiteFreshness({ expire = false, now = new Date() } = {}) {
  const sites = await loadSiteState();
  const assessed = [];
  let retired = 0;

  for (const site of sites) {
    const ctx = { now, areaHeatF: site.area_heat_f, areaRisk: site.area_risk };
    const assessment = assessSite(site, ctx);
    const priority = confirmationPriority(assessment, ctx);

    let didRetire = false;
    if (expire && assessment.action === 'retire_to_unknown') {
      await pool.query(
        `UPDATE sites SET status = 'unknown', status_updated_at = now(),
                          status_updated_by = NULL
          WHERE id = $1`,
        [site.id]
      );
      retired += 1;
      didRetire = true;
    }

    assessed.push({
      site_id: site.id,
      name: site.name,
      type: site.type,
      address: site.address,
      status: site.status,
      status_updated_at: site.status_updated_at,
      area: site.area_name,
      region: site.region,
      area_heat_f: site.area_heat_f === null ? null : Number(site.area_heat_f),
      area_risk: site.area_risk === null ? null : Number(site.area_risk),
      confidence: assessment.confidence,
      action: assessment.action,
      age_hours: assessment.age_hours,
      under_heat: assessment.under_heat,
      confirmation_priority: priority,
      retired: didRetire,
      reasons: assessment.reasons,
    });
  }

  const needsWork = assessed
    .filter((s) => s.action !== 'none')
    .sort((a, b) => b.confirmation_priority - a.confirmation_priority);

  const counts = assessed.reduce((acc, s) => {
    acc[s.confidence] = (acc[s.confidence] || 0) + 1;
    return acc;
  }, {});

  return {
    ran_at: now.toISOString(),
    expire_enabled: expire,
    sites_assessed: assessed.length,
    by_confidence: counts,
    claims_retired: retired,
    would_retire: assessed.filter((s) => s.action === 'retire_to_unknown' && !s.retired).length,
    confirm_first: needsWork,
    all_current: assessed.filter((s) => s.action === 'none'),
  };
}

export {
  runSiteFreshness, assessSite, confirmationPriority,
  NORMAL, UNDER_HEAT, HEAT_PRESSURE_F,
};
