// HeatSafe — resident login.
//
//   POST  /api/auth/login        { email, password } -> session
//   POST  /api/auth/logout       ends the current session
//   GET   /api/auth/me           who is logged in (id, Registration ID, email)
//   PATCH /api/auth/preferences  { notify_email } - opt in/out of alert emails
//   POST  /api/auth/claim        { resident_id, email, password } - adds a
//                                login to a profile registered before
//                                accounts existed (one time only)
//   POST  /api/auth/forgot       { email } - emails a one-hour reset link
//   POST  /api/auth/reset        { token, password } - sets a new password,
//                                signs out every other device
//
// Sessions are bearer tokens (Authorization: Bearer <token>), not cookies:
// the frontend (port 3000) and API (port 4000) are different origins, and a
// header avoids cross-site cookie and CSRF handling entirely.

import { Router } from 'express';
import pool from '../db/pool.js';
import { hashPassword, verifyPassword, validatePassword, dummyHash } from '../services/passwords.js';
import { normalizeEmail, validateEmail, isUuid } from '../services/accounts.js';
import {
  createSession, deleteSession, bearerToken, createPasswordReset, consumePasswordReset,
} from '../services/sessions.js';
import { requireResidentSession } from '../middleware/residentAuth.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../services/residentNotifier.js';

const router = Router();

// ── Brute-force guard ────────────────────────────────────────────────────
// In-memory, per email: 5 wrong passwords in 15 minutes locks that email out
// for the rest of the window. Resets on server restart — adequate for a
// single-server pilot; a shared store (e.g. Redis) would be needed at scale.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map();

function isLockedOut(email) {
  const entry = failures.get(email);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(email);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(email) {
  const entry = failures.get(email);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failures.set(email, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

const LOGIN_FAILED = 'That email and password combination is not correct.';

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!email || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  if (isLockedOut(email)) {
    return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again, or ask the organization that invited you for help.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, registration_id, password_hash FROM residents
       WHERE lower(email) = $1 AND password_hash IS NOT NULL`,
      [email]
    );
    const resident = rows[0];

    // Same work whether or not the email exists, so timing reveals nothing.
    const ok = await verifyPassword(password, resident ? resident.password_hash : await dummyHash());
    if (!resident || !ok) {
      recordFailure(email);
      return res.status(401).json({ error: LOGIN_FAILED });
    }

    failures.delete(email);
    const session = await createSession(resident.id);
    res.json({
      token: session.token,
      expires_at: session.expires_at,
      resident_id: resident.id,
      registration_id: resident.registration_id,
    });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await deleteSession(bearerToken(req));
  } catch (err) {
    console.error('Logout failed:', err.message);
  }
  res.status(204).end();
});

router.get('/me', requireResidentSession, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, registration_id, email, full_name, region, notify_email
       FROM residents WHERE id = $1`,
      [req.residentId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Resident not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load your account' });
  }
});

router.patch('/preferences', requireResidentSession, async (req, res) => {
  if (typeof req.body?.notify_email !== 'boolean') {
    return res.status(400).json({ error: 'notify_email must be true or false' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE residents SET notify_email = $1 WHERE id = $2 RETURNING notify_email',
      [req.body.notify_email, req.residentId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save your preference' });
  }
});

router.post('/claim', async (req, res) => {
  const residentId = req.body?.resident_id;
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  const errors = {};
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(password);
  if (passwordError) errors.password = passwordError;
  if (!isUuid(residentId)) return res.status(404).json({ error: 'Resident not found' });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields', errors });
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, password_hash FROM residents WHERE id = $1 FOR UPDATE',
      [residentId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Resident not found' });
    }
    if (rows[0].password_hash) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This profile already has a login. Log in with its email and password instead.' });
    }

    const { rows: updated } = await client.query(
      `UPDATE residents SET email = $1, password_hash = $2 WHERE id = $3
       RETURNING id, registration_id, email`,
      [email, passwordHash, residentId]
    );
    const session = await createSession(residentId, client);
    await client.query('COMMIT');

    res.json({
      token: session.token,
      expires_at: session.expires_at,
      resident_id: updated[0].id,
      registration_id: updated[0].registration_id,
      email: updated[0].email,
    });

    sendWelcomeEmail(residentId); // fire and forget; never throws
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      const message = 'Another profile already uses this email. Log in with it instead, or use a different email.';
      return res.status(409).json({ error: message, errors: { email: message } });
    }
    console.error('Claim failed:', err.message);
    res.status(500).json({ error: 'Could not add a login. Please try again.' });
  } finally {
    client.release();
  }
});

// ── Forgotten password ──────────────────────────────────────────────────
// Always answers the same way, whether or not the email has an account, so
// this can't be used to discover who is registered. At most 3 reset emails
// per address per 15 minutes.
const resetRequests = new Map();
const FORGOT_REPLY = { ok: true, message: "If that email has a HeatSafe account, we've sent it a link to choose a new password. It works for 1 hour." };

router.post('/forgot', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (validateEmail(email)) {
    return res.status(400).json({ error: 'Enter the email address you registered with.', errors: { email: 'Enter a valid email address' } });
  }

  const entry = resetRequests.get(email);
  const now = Date.now();
  if (entry && now - entry.first < WINDOW_MS && entry.count >= 3) return res.json(FORGOT_REPLY);
  if (!entry || now - entry.first >= WINDOW_MS) resetRequests.set(email, { count: 1, first: now });
  else entry.count += 1;

  res.json(FORGOT_REPLY);

  // After responding, so response time doesn't reveal whether it exists.
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, registration_id FROM residents
       WHERE lower(email) = $1 AND password_hash IS NOT NULL`,
      [email]
    );
    if (!rows[0]) return;
    const token = await createPasswordReset(rows[0].id);
    await sendPasswordResetEmail(rows[0], token);
  } catch (err) {
    console.error('Password reset email failed:', err.message);
  }
});

router.post('/reset', async (req, res) => {
  const token = String(req.body?.token || '');
  const password = req.body?.password;
  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError, errors: { password: passwordError } });
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const residentId = await consumePasswordReset(token, client);
    if (!residentId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' });
    }
    await client.query('UPDATE residents SET password_hash = $1 WHERE id = $2', [passwordHash, residentId]);
    // Anyone logged in with the old password is signed out.
    await client.query('DELETE FROM resident_sessions WHERE resident_id = $1', [residentId]);
    await client.query('DELETE FROM password_resets WHERE resident_id = $1', [residentId]);
    const session = await createSession(residentId, client);
    const { rows } = await client.query('SELECT registration_id, email FROM residents WHERE id = $1', [residentId]);
    await client.query('COMMIT');

    failures.delete(rows[0].email); // a fresh password lifts any wrong-password lockout
    res.json({
      token: session.token,
      expires_at: session.expires_at,
      resident_id: residentId,
      registration_id: rows[0].registration_id,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Password reset failed:', err.message);
    res.status(500).json({ error: 'Could not reset your password. Please try again.' });
  } finally {
    client.release();
  }
});

export default router;
