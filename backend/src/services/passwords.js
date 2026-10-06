// HeatSafe — resident password hashing.
//
// Uses Node's built-in scrypt (a deliberately slow, memory-hard hash), so no
// third-party crypto dependency. Stored format, one self-describing string:
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
// Carrying the parameters in the string means they can be raised later
// without breaking passwords hashed under the old ones.

import { scrypt as scryptCallback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;

const MIN_PASSWORD_LENGTH = 8;
// An upper bound stops someone posting a multi-megabyte "password" to burn CPU.
const MAX_PASSWORD_LENGTH = 128;

/** Returns an error message, or null when the password is acceptable. */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Choose a password';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use no more than ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  if (!expected.length) return false;

  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used when a login names an email that doesn't exist: we still run one full
// hash comparison so the response time doesn't reveal which emails are
// registered.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

export {
  hashPassword, verifyPassword, validatePassword, dummyHash,
  MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
};
