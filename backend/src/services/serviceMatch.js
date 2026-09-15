// Heat Relief Network — service matching.
//
// Turns a resident's intake answers into an ORDERED list of site types that
// actually fit their situation, then finds real open sites of those types
// near them.
//
// The ordering matters more than it looks. Sending an outdoor construction
// worker to a cooling center twelve miles away is technically a match and
// practically useless — he cannot leave the job site for two hours. A water
// station and a shaded break spot near the site are what he can actually use.
// Each rule below encodes that kind of constraint, not just a risk level.

import pool from '../db/pool.js';

const SEARCH_RADIUS_M = 24140; // ~15 miles
const SITES_PER_TYPE = 3;

const TYPE_LABELS = {
  cooling_center: 'Cooling center',
  water_station: 'Water station',
  shade: 'Shade structure',
  splash_pad: 'Splash pad',
};

/**
 * Decide which site types suit this resident, in priority order.
 * Rules are evaluated top to bottom; the first match wins.
 *
 * @param {object} intake
 * @param {{tier:number}} score
 * @returns {Array<{type:string, label:string, why:string}>}
 */
function recommendTypes(intake, score) {
  const age = Number(intake.age);

  if (intake.children_under_5) {
    return [
      { type: 'splash_pad', why: 'Water play is what families with toddlers reliably use and keeps young children cool safely.' },
      { type: 'cooling_center', why: 'A backup with sustained air conditioning for the hottest part of the afternoon.' },
    ].map(withLabel);
  }

  if (age >= 65 || intake.employment_status === 'unable_to_work') {
    return [
      { type: 'cooling_center', why: 'Sustained air conditioning, seating, and staff nearby matter more than water access.' },
      { type: 'water_station', why: 'Hydration support close to home.' },
    ].map(withLabel);
  }

  if (intake.employment_status === 'outdoor_worker') {
    return [
      { type: 'water_station', why: 'Hydration you can reach without leaving the job site for hours.' },
      { type: 'shade', why: 'A shaded spot for break periods during peak heat.' },
      { type: 'cooling_center', why: 'For a longer cool-down before or after a shift.' },
    ].map(withLabel);
  }

  if (intake.insurance_status === 'none' && score.tier === 1) {
    return [
      { type: 'cooling_center', why: 'Staffed sites are the ones most likely to notice someone in trouble early.' },
      { type: 'water_station', why: 'Hydration support nearby.' },
    ].map(withLabel);
  }

  return [
    { type: 'cooling_center', why: 'General-purpose relief with air conditioning and water available.' },
  ].map(withLabel);
}

function withLabel(rec) {
  return { ...rec, label: TYPE_LABELS[rec.type] ?? rec.type };
}

/** Nearest OPEN sites of the given types, nearest first. */
async function findNearestByTypes(lat, lon, types, limit = SITES_PER_TYPE) {
  const { rows } = await pool.query(
    `SELECT id, name, type, address, status, hours_text,
            ST_X(location::geometry) AS lon,
            ST_Y(location::geometry) AS lat,
            ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m
     FROM sites
     WHERE type = ANY($3)
       AND status = 'open'
       AND ST_DWithin(location, ST_MakePoint($1, $2)::geography, $4)
     ORDER BY distance_m ASC
     LIMIT $5;`,
    [lon, lat, types, SEARCH_RADIUS_M, limit]
  );
  return rows.map(toSiteCard);
}

/** Nearest open site of ANY type — the fallback when nothing recommended is nearby. */
async function findNearestAnyType(lat, lon, limit = SITES_PER_TYPE) {
  const { rows } = await pool.query(
    `SELECT id, name, type, address, status, hours_text,
            ST_X(location::geometry) AS lon,
            ST_Y(location::geometry) AS lat,
            ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m
     FROM sites
     WHERE status = 'open'
       AND ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
     ORDER BY distance_m ASC
     LIMIT $4;`,
    [lon, lat, SEARCH_RADIUS_M, limit]
  );
  return rows.map(toSiteCard);
}

function toSiteCard(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    type_label: TYPE_LABELS[row.type] ?? row.type,
    address: row.address,
    status: row.status,
    hours_text: row.hours_text,
    lat: row.lat,
    lon: row.lon,
    distance_mi: Math.round((row.distance_m / 1609.34) * 10) / 10,
  };
}

/**
 * Full match: recommended types + real nearby open sites for each.
 *
 * @param {object} intake  resident intake answers (must include lat/lon)
 * @param {object} score   output of scoreResident()
 */
async function matchServices(intake, score) {
  const recommendations = recommendTypes(intake, score);

  const matched = [];
  for (const rec of recommendations) {
    const sites = await findNearestByTypes(intake.lat, intake.lon, [rec.type]);
    matched.push({ ...rec, sites });
  }

  const foundAny = matched.some((m) => m.sites.length > 0);

  // Be explicit about an empty result rather than returning a silent blank.
  let fallback = null;
  let note = null;
  if (!foundAny) {
    fallback = await findNearestAnyType(intake.lat, intake.lon);
    note = fallback.length
      ? 'No open sites of the recommended types were found within 15 miles, so the nearest open sites of any type are shown instead.'
      : 'No open relief sites were found within 15 miles. Site status is updated by partner organizations and may not reflect every location — call 211 for help locating one.';
  }

  return { recommendations: matched, fallback_sites: fallback, note };
}

export { matchServices, recommendTypes, findNearestByTypes, findNearestAnyType, TYPE_LABELS };
