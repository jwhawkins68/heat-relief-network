import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResident, fplPercent, fplThreshold, incomeBand } from '../src/services/needScore.js';

const base = {
  age: 40,
  household_size: 1,
  children_under_5: false,
  employment_status: 'full_time_indoor',
  insurance_status: 'personal',
  annual_income: 60000,
};

test('FPL threshold grows by the per-person increment', () => {
  assert.equal(fplThreshold(1), 15650);
  assert.equal(fplThreshold(3), 15650 + 2 * 5500);
});

test('fplPercent is income as a share of the household threshold', () => {
  assert.equal(fplPercent(15650, 1), 100);
  assert.equal(fplPercent(7825, 1), 50);
  assert.equal(fplPercent(0, 4), 0);
});

test('78-year-old uninsured retiree at ~90% FPL lands in Tier 1', () => {
  const r = scoreResident({
    ...base,
    age: 78,
    employment_status: 'retired',
    insurance_status: 'none',
    annual_income: 14000, // ~89% FPL for a household of 1
  });
  // 35 age + 30 income + 10 retired + 15 uninsured = 90
  assert.equal(r.score, 90);
  assert.equal(r.tier, 1);
  assert.match(r.tier_label, /Urgent/);
  assert.ok(r.reasons.length >= 4, 'every scoring branch contributes a reason');
});

test('30-year-old insured office worker at ~350% FPL lands in Tier 3', () => {
  const r = scoreResident({
    ...base,
    age: 30,
    annual_income: 54775, // 350% FPL for a household of 1
  });
  // 5 age + 6 income + 2 employment + 0 insurance = 13
  assert.equal(r.score, 13);
  assert.equal(r.tier, 3);
});

test('outdoor worker with no insurance is prioritised even when young', () => {
  const r = scoreResident({
    ...base,
    age: 29,
    employment_status: 'outdoor_worker',
    insurance_status: 'none',
    annual_income: 24000,
    household_size: 3,
  });
  // 5 age + 30 income (24k vs 26,650 threshold = 90%) + 20 outdoor + 15 uninsured = 70
  assert.equal(r.score, 70);
  assert.equal(r.tier, 1, 'exactly 70 is the Tier 1 boundary and must be inclusive');
});

test('Tier 2 boundary is inclusive at 45', () => {
  // 5 (age 18-54) + 24 (<=138% FPL) + 8 (part_time) + 0 (insured) = 37 -> just under
  const under = scoreResident({
    ...base,
    age: 40,
    employment_status: 'part_time',
    annual_income: 21000, // ~134% FPL, household of 1
  });
  assert.equal(under.score, 37);
  assert.equal(under.tier, 3);

  // 12 (age 55-64) + 24 + 8 (part_time) + 0 = 44 -> one point below the line
  const justUnder = scoreResident({
    ...base,
    age: 60,
    employment_status: 'part_time',
    annual_income: 21000,
  });
  assert.equal(justUnder.score, 44);
  assert.equal(justUnder.tier, 3, '44 must stay Tier 3');

  // 5 + 24 + 16 (unemployed) + 0 = 45 -> exactly the threshold
  const exactly45 = scoreResident({
    ...base,
    age: 40,
    employment_status: 'unemployed',
    annual_income: 21000,
  });
  assert.equal(exactly45.score, 45);
  assert.equal(exactly45.tier, 2, '45 must be Tier 2 — the threshold is inclusive');
});

test('Tier 1 boundary is inclusive at 70', () => {
  // 28 (age 65-74) + 16 (<=200% FPL) + 10 (retired) + 15 (uninsured) = 69
  const justUnder = scoreResident({
    ...base,
    age: 70,
    employment_status: 'retired',
    insurance_status: 'none',
    annual_income: 30000, // ~192% FPL, household of 1
  });
  assert.equal(justUnder.score, 69);
  assert.equal(justUnder.tier, 2, '69 must stay Tier 2');

  // The outdoor-worker case above lands on exactly 70 and is asserted Tier 1.
});

test('child-under-5 modifier applies and the score clamps at 100', () => {
  const withChild = scoreResident({ ...base, children_under_5: true });
  const withoutChild = scoreResident(base);
  assert.equal(withChild.score - withoutChild.score, 10);

  const maxed = scoreResident({
    age: 80,                          // 35
    household_size: 4,
    children_under_5: true,           // +10
    employment_status: 'outdoor_worker', // 20
    insurance_status: 'none',         // 15
    annual_income: 0,                 // 30
  });
  assert.equal(maxed.score, 100, 'raw 110 must clamp to 100');
});

test('a resident with no risk factors still gets an explanation', () => {
  const r = scoreResident(base);
  assert.ok(r.reasons.length > 0, 'reasons must never be empty');
});

test('incomeBand never leaks a dollar figure', () => {
  assert.equal(incomeBand(80), 'Below poverty line');
  assert.equal(incomeBand(150), 'Below 200% FPL');
  assert.equal(incomeBand(500), 'Above 200% FPL');
});
