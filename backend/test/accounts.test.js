import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validatePassword } from '../src/services/passwords.js';
import {
  generateRegistrationId, REGISTRATION_ID_PATTERN,
  normalizeEmail, validateEmail, isUuid,
} from '../src/services/accounts.js';

test('a hashed password verifies, and the hash never contains the password', async () => {
  const hash = await hashPassword('cooling-center-2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!hash.includes('cooling-center-2026'));
  assert.equal(await verifyPassword('cooling-center-2026', hash), true);
});

test('a wrong password does not verify', async () => {
  const hash = await hashPassword('cooling-center-2026');
  assert.equal(await verifyPassword('cooling-center-2025', hash), false);
});

test('the same password hashes differently each time (random salt)', async () => {
  const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
  assert.notEqual(a, b);
});

test('malformed or missing stored hashes fail closed instead of throwing', async () => {
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', 'scrypt$16384$8$1$$'), false);
});

test('password rules: 8 to 128 characters', () => {
  assert.ok(validatePassword(''));
  assert.ok(validatePassword('short'));
  assert.ok(validatePassword('x'.repeat(129)));
  assert.equal(validatePassword('longenough'), null);
});

test('registration IDs look like HS-XXXX-XXXX with no 0/O/1/I', () => {
  for (let i = 0; i < 500; i++) {
    const id = generateRegistrationId();
    assert.match(id, REGISTRATION_ID_PATTERN);
    assert.ok(!/[01OI]/.test(id.slice(3)), id);
  }
});

test('registration IDs are not repeated across a large batch', () => {
  const ids = new Set(Array.from({ length: 5000 }, generateRegistrationId));
  assert.equal(ids.size, 5000);
});

test('emails are trimmed and lowercased so duplicates are caught regardless of case', () => {
  assert.equal(normalizeEmail('  Ann.Lee@Example.COM '), 'ann.lee@example.com');
  assert.equal(normalizeEmail(undefined), '');
});

test('email validation', () => {
  assert.equal(validateEmail('ann@example.com'), null);
  assert.ok(validateEmail(''));
  assert.ok(validateEmail('ann@'));
  assert.ok(validateEmail('ann example@x.com'));
  assert.ok(validateEmail('ann@example'));
});

test('isUuid', () => {
  assert.equal(isUuid('c1335a41-dc02-4d0f-8a29-f1398bd955df'), true);
  assert.equal(isUuid('HS-7KQ2-M9XD'), false);
  assert.equal(isUuid("1' OR '1'='1"), false);
});
