import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCounty } from '../src/services/countyLookup.js';

test('resolves each pilot metro to its county', () => {
  assert.equal(resolveCounty('Houston', 'TX'), 'Harris County');
  assert.equal(resolveCounty('Dallas', 'TX'), 'Dallas County');
  assert.equal(resolveCounty('Fort Worth', 'TX'), 'Tarrant County');
  assert.equal(resolveCounty('Austin', 'TX'), 'Travis County');
  assert.equal(resolveCounty('San Antonio', 'TX'), 'Bexar County');
});

test('is case- and whitespace-insensitive', () => {
  assert.equal(resolveCounty(' houston ', ' tx '), 'Harris County');
  assert.equal(resolveCounty('HOUSTON', 'TX'), 'Harris County');
});

test('returns null outside the pilot metros instead of guessing', () => {
  assert.equal(resolveCounty('Nowhere', 'ZZ'), null);
  assert.equal(resolveCounty('Houston', 'GA'), null); // there's a Houston, GA too
});

test('returns null on missing input', () => {
  assert.equal(resolveCounty(null, 'TX'), null);
  assert.equal(resolveCounty('Houston', null), null);
  assert.equal(resolveCounty(undefined, undefined), null);
});
