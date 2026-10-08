// HeatSafe — small, pure helpers for resident accounts (no database access,
// so they're straightforward to unit test).

import { randomInt } from 'node:crypto';

// Same alphabet as invite codes: no 0/O or 1/I, so a Registration ID can be
// read aloud to a caseworker over the phone without being misheard.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. "HS-7KQ2-M9XD". Human-facing only — it grants no access by itself. */
function generateRegistrationId() {
  let out = 'HS-';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }
  return out;
}

const REGISTRATION_ID_PATTERN = /^HS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Emails are compared case-insensitively everywhere, so store them lowercased. */
function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** Returns an error message, or null when the (already-normalized) email looks valid. */
function validateEmail(email) {
  if (!email) return 'Enter your email address';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return 'Enter a valid email address, like name@example.com';
  }
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ''));
}

export {
  generateRegistrationId, REGISTRATION_ID_PATTERN,
  normalizeEmail, validateEmail, isUuid,
};
