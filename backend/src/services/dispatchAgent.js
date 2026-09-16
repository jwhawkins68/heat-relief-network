// HeatSafe — Outreach Dispatch Planner agent.
//
// WHAT MAKES THIS AN AGENT RATHER THAN A CHATBOT:
// It is given no instructions. It reads the volunteer shifts already on the
// books, the neighborhoods our scoring engine ranks as highest need, and the
// residents registered for priority access — and produces an actual plan:
// which volunteer checks on which residents, in what order, during which shift.
// It also reports what it could NOT cover, which is usually the more useful half.
//
// It is a constrained assignment, solved greedily and explained line by line.
// We are not optimising a delivery fleet; we are making sure the person with
// the highest need in the least-covered neighborhood is on somebody's list.
//
// DESIGN NOTE — why greedy and not something cleverer:
// Optimal assignment over volunteers, time windows and residents is a
// vehicle-routing problem, and solving it properly would need a solver and a
// lot of tuning. Highest-need-first is defensible, explainable, and produces a
// plan a coordinator can read and override. When the pilot outgrows it, the
// upgrade path is documented rather than assumed.

import pool from '../db/pool.js';

const AREA_MATCH_RADIUS_M = 12000;  // a site serves areas within ~7.5 miles
const RESIDENT_RADIUS_M = 8000;     // ~5 miles around an area centroid
const MAX_RESIDENTS_PER_SHIFT = 8;  // a realistic number of check-ins per shift
const HIGH_PRIORITY_SCORE = 40;     // an uncovered area at/above this is a gap worth reporting

/** Scheduled shifts inside the planning window, with volunteer and site detail. */
async function loadShifts(hoursAhead) {
  const { rows } = await pool.query(
    `SELECT vs.id AS shift_id, vs.start_time, vs.end_time,
            v.id AS volunteer_id, v.name AS volunteer_name, v.skills,
            s.id AS site_id, s.name AS site_name, s.type AS site_type,
            s.address AS site_address, s.status AS site_status,
            ST_X(s.location::geometry) AS site_lon,
            ST_Y(s.location::geometry) AS site_lat
       FROM volunteer_shifts vs
       JOIN volunteers v ON v.id = vs.volunteer_id
       JOIN sites s      ON s.id = vs.site_id
      WHERE vs.status = 'scheduled'
        AND vs.end_time   > now()
        AND vs.start_time < now() + ($1 || ' hours')::interval
      ORDER BY vs.start_time ASC`,
    [String(hoursAhead)]
  );
  return rows;
}

/** Areas ranked by need, with whether any open site is nearby. */
async function loadRankedAreas() {
  const { rows } = await pool.query(
    `SELECT a.id, a.name, a.region, a.risk_score, a.heat_index_f, a.population,
            ST_X(a.centroid::geometry) AS lon, ST_Y(a.centroid::geometry) AS lat,
            (SELECT MIN(ST_Distance(s.location, a.centroid))
               FROM sites s
              WHERE s.status = 'open'
                AND ST_DWithin(s.location, a.centroid, $1)) AS nearest_open_site_m
       FROM areas a
      ORDER BY a.risk_score DESC NULLS LAST`,
    [RESIDENT_RADIUS_M]
  );
  return rows;
}

/** Highest-need registered residents near an area, excluding anyone already planned for. */
async function residentsNear(area, excludeIds, limit) {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, city, zip, priority_tier, need_score,
              ROUND((ST_Distance(location, ST_MakePoint($1, $2)::geography) / 1609.34)::numeric, 1) AS distance_mi
         FROM residents
        WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
          AND NOT (id = ANY($4::uuid[]))
        ORDER BY priority_tier ASC, need_score DESC
        LIMIT $5`,
      [area.lon, area.lat, RESIDENT_RADIUS_M, excludeIds, limit]
    );
    return rows;
  } catch (err) {
    if (err.code === '42P01') return null; // residents table not migrated yet
    throw err;
  }
}

/** Which ranked area does this shift's site actually serve? Nearest within range. */
function areaForShift(shift, areas) {
  let best = null;
  let bestM = Infinity;
  for (const a of areas) {
    // Equirectangular approximation is plenty at this scale and avoids a round trip.
    const dx = (Number(a.lon) - Number(shift.site_lon)) * 111320 * Math.cos((Number(a.lat) * Math.PI) / 180);
    const dy = (Number(a.lat) - Number(shift.site_lat)) * 110540;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m < bestM) { bestM = m; best = a; }
  }
  return bestM <= AREA_MATCH_RADIUS_M ? { area: best, distance_m: Math.round(bestM) } : null;
}

/**
 * Build an outreach plan.
 *
 * @param {{ hoursAhead?: number }} opts
 */
async function planDispatch({ hoursAhead = 12 } = {}) {
  const [shifts, areas] = await Promise.all([loadShifts(hoursAhead), loadRankedAreas()]);

  // Group the shifts by the area their site serves.
  const byArea = new Map();
  const unmatchedShifts = [];
  for (const shift of shifts) {
    const match = areaForShift(shift, areas);
    if (!match) {
      unmatchedShifts.push({
        volunteer: shift.volunteer_name,
        site: shift.site_name,
        why: `This site is more than ${Math.round(AREA_MATCH_RADIUS_M / 1609.34)} miles from any pilot area, so no outreach list was built for it.`,
      });
      continue;
    }
    if (!byArea.has(match.area.id)) byArea.set(match.area.id, []);
    byArea.get(match.area.id).push(shift);
  }

  const assignments = [];
  const gaps = [];
  const planned = [];           // resident ids already spoken for
  let residentsTableMissing = false;

  // Highest-need areas first — that ordering is the whole point of the agent.
  for (const area of areas) {
    const areaShifts = byArea.get(area.id) || [];
    const risk = Number(area.risk_score);
    const uncovered = area.nearest_open_site_m === null;

    if (areaShifts.length === 0) {
      if (Number.isFinite(risk) && risk >= HIGH_PRIORITY_SCORE) {
        gaps.push({
          area: area.name,
          region: area.region,
          risk_score: risk,
          heat_index_f: area.heat_index_f === null ? null : Number(area.heat_index_f),
          open_site_nearby: !uncovered,
          why: uncovered
            ? `Ranked ${risk} for vulnerability with no open site nearby, and nobody is scheduled in the window.`
            : `Ranked ${risk} for vulnerability and nobody is scheduled in the window.`,
        });
      }
      continue;
    }

    // Split this area's residents across whoever is on shift here.
    const capacity = areaShifts.length * MAX_RESIDENTS_PER_SHIFT;
    const pool_ = await residentsNear(area, planned, capacity);
    if (pool_ === null) { residentsTableMissing = true; }
    const residents = pool_ || [];
    residents.forEach((r) => planned.push(r.id));

    areaShifts.forEach((shift, i) => {
      // Round-robin so the highest-need residents spread across shifts rather
      // than all landing on whoever happens to be sorted first.
      const mine = residents.filter((_, idx) => idx % areaShifts.length === i);
      assignments.push({
        volunteer: shift.volunteer_name,
        volunteer_id: shift.volunteer_id,
        shift_start: shift.start_time,
        shift_end: shift.end_time,
        site: { name: shift.site_name, type: shift.site_type, address: shift.site_address, status: shift.site_status },
        area: area.name,
        region: area.region,
        area_risk_score: risk,
        check_ins: mine,
        why: `${area.name} ranks ${risk} for heat vulnerability` +
             (uncovered ? ' with no open site nearby' : '') +
             `, and ${shift.volunteer_name} is already scheduled at ${shift.site_name} during this window.`,
        warning: shift.site_status !== 'open'
          ? `Site status is "${shift.site_status}" — confirm it is actually open before sending anyone.`
          : null,
      });
    });
  }

  return {
    planned_at: new Date().toISOString(),
    window_hours: hoursAhead,
    shifts_considered: shifts.length,
    areas_ranked: areas.length,
    assignments_made: assignments.length,
    residents_planned: planned.length,
    coverage_gaps: gaps,
    unmatched_shifts: unmatchedShifts,
    note: residentsTableMissing
      ? 'The residents table does not exist yet, so assignments have no check-in lists. Run migration_priority_access.sql to enable them.'
      : null,
    assignments,
  };
}

export { planDispatch, areaForShift, AREA_MATCH_RADIUS_M, MAX_RESIDENTS_PER_SHIFT, HIGH_PRIORITY_SCORE };
