// HeatSafe — resident login sessions.
//
// A session token is 32 random bytes, handed to the browser once. The
// database stores only its SHA-256, so someone who reads the
// resident_sessions table can't turn it back into working logins.

import { randomBytes, createHash } from 'node:crypto';
import pool from '../db/pool.js';

const SESSION_DAYS = 30;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Pulls "Bearer <token>" out of the Authorization header, or null. */
function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/** `db` may be a transaction client, so a session is only kept if the transaction commits. */
async function createSession(residentId, db = pool) {
  const token = randomBytes(32).toString('hex');
  const { rows } = await db.query(
    `INSERT INTO resident_sessions (token_hash, resident_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)
     RETURNING expires_at`,
    [hashToken(token), residentId, String(SESSION_DAYS)]
  );
  return { token, expires_at: rows[0].expires_at };
}

/** Returns { resident_id, expires_at } for a live session, else null. */
async function findSession(token) {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT resident_id, expires_at FROM resident_sessions
     WHERE token_hash = $1 AND expires_at > now()`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

async function deleteSession(token) {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  await pool.query('DELETE FROM resident_sessions WHERE token_hash = $1', [hashToken(token)]);
}

// ── Password reset tokens (same hashing scheme, one hour, single use) ──────

async function createPasswordReset(residentId) {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO password_resets (token_hash, resident_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [hashToken(token), residentId]
  );
  return token;
}

/**
 * Consumes a reset token inside the caller's transaction. Returns the
 * resident id, or null if the token is unknown, expired or already used.
 */
async function consumePasswordReset(token, client) {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const { rows } = await client.query(
    `DELETE FROM password_resets WHERE token_hash = $1 RETURNING resident_id, expires_at > now() AS live`,
    [hashToken(token)]
  );
  return rows[0] && rows[0].live ? rows[0].resident_id : null;
}

export {
  createSession, findSession, deleteSession, bearerToken, hashToken, SESSION_DAYS,
  createPasswordReset, consumePasswordReset,
};
