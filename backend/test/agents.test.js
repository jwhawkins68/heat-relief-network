import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessArea, NWS, HIGH_RISK_SCORE } from '../src/services/heatWatchAgent.js';
import { areaForShift, AREA_MATCH_RADIUS_M } from '../src/services/dispatchAgent.js';

const covered = { heat_index_f: 105, risk_score: 45, nearest_open_site_m: 1200 };
const noon = new Date('2026-07-15T13:00:00');
const night = new Date('2026-07-15T23:00:00');

test('heat index below caution produces no alert', () => {
  const r = assessArea({ ...covered, heat_index_f: 74 }, { now: noon });
  assert.equal(r.severity, null);
});

test('elevated but sub-advisory heat produces no alert, and says so', () => {
  const r = assessArea({ ...covered, heat_index_f: 85 }, { now: noon });
  assert.equal(r.severity, null);
  assert.match(r.reasons.join(' '), /below the advisory threshold/);
});

test('NWS bands map to the expected severities when relief is nearby', () => {
  assert.equal(assessArea({ ...covered, heat_index_f: 95 }, { now: noon }).severity, 'advisory');
  assert.equal(assessArea({ ...covered, heat_index_f: 110 }, { now: noon }).severity, 'warning');
  assert.equal(assessArea({ ...covered, heat_index_f: 130 }, { now: noon }).severity, 'emergency');
});

test('a vulnerable area with no open site nearby escalates one level', () => {
  const withRelief = assessArea({ ...covered, heat_index_f: 110 }, { now: noon });
  const without = assessArea({ ...covered, heat_index_f: 110, nearest_open_site_m: null }, { now: noon });
  assert.equal(withRelief.severity, 'warning');
  assert.equal(without.severity, 'emergency');
  assert.equal(without.escalated, true);
  assert.match(without.reasons.join(' '), /no open relief site/);
});

test('escalation requires BOTH vulnerability and no coverage', () => {
  const lowRisk = assessArea(
    { heat_index_f: 110, risk_score: HIGH_RISK_SCORE - 10, nearest_open_site_m: null }, { now: noon });
  assert.equal(lowRisk.severity, 'warning', 'a low-risk area should not escalate just for being uncovered');
  assert.equal(lowRisk.escalated, false);
});

test('escalation is capped at emergency', () => {
  const r = assessArea({ ...covered, heat_index_f: 130, nearest_open_site_m: null }, { now: noon });
  assert.equal(r.severity, 'emergency');
  assert.equal(r.escalated, false, 'already at the ceiling, so nothing to escalate');
});

test('overnight heat is noted but does not change severity', () => {
  const day = assessArea({ ...covered, heat_index_f: 110 }, { now: noon });
  const dark = assessArea({ ...covered, heat_index_f: 110 }, { now: night });
  assert.equal(day.severity, dark.severity);
  assert.match(dark.reasons.join(' '), /no recovery window/);
  assert.doesNotMatch(day.reasons.join(' '), /no recovery window/);
});

test('a missing heat index is reported rather than treated as zero', () => {
  const r = assessArea({ ...covered, heat_index_f: null }, { now: noon });
  assert.equal(r.severity, null);
  assert.match(r.reasons.join(' '), /No heat index on record/);
});

test('every alerting assessment carries at least one stated reason', () => {
  [95, 110, 130].forEach((h) => {
    const r = assessArea({ ...covered, heat_index_f: h }, { now: noon });
    assert.ok(r.reasons.length > 0, `heat ${h} produced no reasons`);
  });
});

// ── dispatch agent ──
const areas = [
  { id: 'a', name: 'Sunnyside (Houston)', lon: -95.371847, lat: 29.669321 },
  { id: 'b', name: 'East Austin',         lon: -97.674011, lat: 30.314870 },
];

test('a shift is matched to the area its site actually serves', () => {
  const m = areaForShift({ site_lon: -95.371, site_lat: 29.669 }, areas);
  assert.ok(m);
  assert.equal(m.area.name, 'Sunnyside (Houston)');
  assert.ok(m.distance_m < 500);
});

test('a shift far from every pilot area matches nothing', () => {
  // Amarillo — well outside the pilot region.
  const m = areaForShift({ site_lon: -101.831, site_lat: 35.221 }, areas);
  assert.equal(m, null);
});

test('the area match radius is the boundary that decides it', () => {
  // ~0.05 degrees of latitude is roughly 5.5km, inside the radius.
  const near = areaForShift({ site_lon: -95.371847, site_lat: 29.669321 + 0.05 }, areas);
  assert.ok(near && near.distance_m < AREA_MATCH_RADIUS_M);
});
