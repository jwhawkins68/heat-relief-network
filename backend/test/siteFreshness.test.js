import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSite, confirmationPriority, HEAT_PRESSURE_F } from '../src/services/siteFreshnessAgent.js';

const NOW = new Date('2026-07-15T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

const mild = { now: NOW, areaHeatF: 88, areaRisk: 30 };
const hot = { now: NOW, areaHeatF: 109, areaRisk: 30 };

test('an unknown status is unconfirmed, not stale', () => {
  const r = assessSite({ status: 'unknown', status_updated_at: null }, mild);
  assert.equal(r.confidence, 'unconfirmed');
  assert.equal(r.action, 'needs_first_confirmation');
  assert.match(r.reasons.join(' '), /never been confirmed/);
});

test('a recent confirmation is fresh in mild weather', () => {
  const r = assessSite({ status: 'open', status_updated_at: hoursAgo(6) }, mild);
  assert.equal(r.confidence, 'fresh');
  assert.equal(r.action, 'none');
});

test('the same 6-hour-old claim is still fresh under heat, but 13h is not', () => {
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(6) }, hot).confidence, 'fresh');
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(13) }, hot).confidence, 'aging');
});

test('heat tightens the window — the SAME claim is fresh when mild and expired when hot', () => {
  // 50h sits under the 72h mild aging limit, but past the 48h limit under heat.
  // One claim, one age, two verdicts — which is the whole point of the rule.
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(50) }, mild).confidence, 'fresh');
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(50) }, hot).confidence, 'expired');
});

test('mild-weather bands land where the thresholds say', () => {
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(71) }, mild).confidence, 'fresh');
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(73) }, mild).confidence, 'aging');
  assert.equal(assessSite({ status: 'open', status_updated_at: hoursAgo(169) }, mild).confidence, 'expired');
});

test('an expired claim is marked for retirement', () => {
  const r = assessSite({ status: 'open', status_updated_at: hoursAgo(200) }, mild);
  assert.equal(r.confidence, 'expired');
  assert.equal(r.action, 'retire_to_unknown');
});

test('an expired OPEN says why it is worse than unknown', () => {
  const open = assessSite({ status: 'open', status_updated_at: hoursAgo(200) }, mild);
  const closed = assessSite({ status: 'closed', status_updated_at: hoursAgo(200) }, mild);
  assert.match(open.reasons.join(' '), /worse than "unknown"/);
  assert.doesNotMatch(closed.reasons.join(' '), /worse than "unknown"/);
});

test('an asserted status with no timestamp is unverifiable rather than assumed fresh', () => {
  const r = assessSite({ status: 'open', status_updated_at: null }, mild);
  assert.equal(r.confidence, 'unverifiable');
  assert.equal(r.action, 'needs_confirmation');
});

test('the heat-pressure threshold is the boundary that switches windows', () => {
  const below = assessSite({ status: 'open', status_updated_at: hoursAgo(20) }, { now: NOW, areaHeatF: HEAT_PRESSURE_F - 1 });
  const at = assessSite({ status: 'open', status_updated_at: hoursAgo(20) }, { now: NOW, areaHeatF: HEAT_PRESSURE_F });
  assert.equal(below.under_heat, false);
  assert.equal(at.under_heat, true);
  assert.equal(below.confidence, 'fresh');
  assert.equal(at.confidence, 'aging');
});

test('a missing heat index is treated as normal conditions, not as heat', () => {
  const r = assessSite({ status: 'open', status_updated_at: hoursAgo(20) }, { now: NOW, areaHeatF: null });
  assert.equal(r.under_heat, false);
});

test('every assessment states at least one reason', () => {
  [
    { status: 'unknown', status_updated_at: null },
    { status: 'open', status_updated_at: hoursAgo(1) },
    { status: 'open', status_updated_at: hoursAgo(100) },
    { status: 'open', status_updated_at: null },
  ].forEach((s) => assert.ok(assessSite(s, mild).reasons.length > 0));
});

// ── ranking ──
test('fresh sites carry no confirmation priority', () => {
  const a = assessSite({ status: 'open', status_updated_at: hoursAgo(1) }, mild);
  assert.equal(confirmationPriority(a, mild), 0);
});

test('expired outranks aging, and a more vulnerable area outranks a less vulnerable one', () => {
  const expired = assessSite({ status: 'open', status_updated_at: hoursAgo(200) }, mild);
  const aging = assessSite({ status: 'open', status_updated_at: hoursAgo(80) }, mild);
  assert.ok(confirmationPriority(expired, mild) > confirmationPriority(aging, mild));

  const highRisk = confirmationPriority(expired, { areaRisk: 30 });
  const lowRisk = confirmationPriority(expired, { areaRisk: 5 });
  assert.ok(highRisk > lowRisk, 'a stale site in a more vulnerable area should be confirmed first');
});

test('heat pressure raises confirmation priority for the same staleness', () => {
  const m = assessSite({ status: 'open', status_updated_at: hoursAgo(200) }, mild);
  const h = assessSite({ status: 'open', status_updated_at: hoursAgo(200) }, hot);
  assert.ok(confirmationPriority(h, hot) > confirmationPriority(m, mild));
});
