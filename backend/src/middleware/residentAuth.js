// HeatSafe — who may read or change a resident record.
//
// authorizeResident guards every /api/residents/:id route a resident uses
// themselves (view, edit, check-in):
//
//   1. A valid login session for THAT resident            -> allowed
//   2. A session for someone else                          -> 403
//   3. No session, and the profile has no password yet     -> allowed
//      (legacy stopgap: residents registered before accounts existed still
//      prove ownership with their own UUID until they claim the profile)
//   4. No session, and the profile HAS a password          -> 401, log in
//
// Case 4 is the upgrade: once someone sets a password, knowing their UUID is
// no longer enough to open their record.
//
// requireResidentSession is stricter — a valid session, nothing else — and
// guards /api/auth routes that act on "whoever is logged in".

import pool from '../db/pool.js';
import { bearerToken, findSession } from '../services/sessions.js';
import { isUuid } from '../services/accounts.js';

async function authorizeResident(req, res, next) {
  if (!isUuid(req.params.id)) {
    return res.status(404).json({ error: 'Resident not found' });
  }

  try {
    const token = bearerToken(req);
    if (token) {
      const session = await findSession(token);
      if (!session) {
        return res.status(401).json({ error: 'Your login has expired. Please log in again.', login_required: true });
      }
      if (session.resident_id !== req.params.id) {
        return res.status(403).json({ error: 'That record belongs to a different account.' });
      }
      req.residentId = session.resident_id;
      return next();
    }

    const { rows } = await pool.query(
      'SELECT password_hash IS NOT NULL AS claimed FROM residents WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Resident not found' });
    if (rows[0].claimed) {
      return res.status(401).json({ error: 'Please log in to see this record.', login_required: true });
    }

    req.residentId = req.params.id;
    req.legacyAccess = true;
    return next();
  } catch (err) {
    console.error('Resident authorization failed:', err.message);
    return res.status(500).json({ error: 'Could not check your access. Please try again.' });
  }
}

async function requireResidentSession(req, res, next) {
  try {
    const session = await findSession(bearerToken(req));
    if (!session) {
      return res.status(401).json({ error: 'Please log in.', login_required: true });
    }
    req.residentId = session.resident_id;
    return next();
  } catch (err) {
    console.error('Session check failed:', err.message);
    return res.status(500).json({ error: 'Could not check your login. Please try again.' });
  }
}

export { authorizeResident, requireResidentSession };
