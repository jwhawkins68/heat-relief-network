import { Router } from 'express';
import { randomInt } from 'node:crypto';
import pool from '../db/pool.js';

const router = Router();

// 0/O and 1/I are excluded so a code can be read aloud over the phone by a
// caseworker without being misheard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const DEFAULT_EXPIRY_DAYS = 30;

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * POST /api/invites
 * Body: { org_id, issued_to_label?, expires_in_days? }
 * Issues a new single-use invite code for a partner organization.
 */
router.post('/', async (req, res) => {
  const { org_id, issued_to_label = null, expires_in_days = DEFAULT_EXPIRY_DAYS } = req.body;

  if (!org_id) {
    return res.status(400).json({ error: 'org_id is required' });
  }

  const days = Number(expires_in_days);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: 'expires_in_days must be between 1 and 365' });
  }

  try {
    // Retry on the astronomically unlikely code collision rather than 500.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      try {
        const { rows } = await pool.query(
          `INSERT INTO invites (code, issued_by_org_id, issued_to_label, expires_at)
           VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)
           RETURNING code, issued_to_label, status, expires_at, created_at`,
          [code, org_id, issued_to_label, String(days)]
        );
        return res.status(201).json(rows[0]);
      } catch (err) {
        if (err.code === '23505') continue; // unique violation on code
        if (err.code === '23503') {
          return res.status(400).json({ error: 'That organization does not exist' });
        }
        throw err;
      }
    }
    res.status(500).json({ error: 'Could not generate a unique invite code' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to issue invite' });
  }
});

/**
 * GET /api/invites/:code/validate
 * Checks a code without consuming it. Returns a specific reason on rejection
 * so the registration page can tell the resident what actually went wrong.
 */
router.get('/:code/validate', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();

  try {
    const { rows } = await pool.query(
      `SELECT i.code, i.status, i.expires_at, o.name AS org_name
       FROM invites i
       LEFT JOIN orgs o ON o.id = i.issued_by_org_id
       WHERE i.code = $1`,
      [code]
    );

    const invite = rows[0];
    if (!invite) {
      return res.status(404).json({ valid: false, reason: 'not_found', error: "That invite code wasn't recognized. Check it and try again." });
    }
    if (invite.status === 'redeemed') {
      return res.status(409).json({ valid: false, reason: 'already_redeemed', error: 'That invite code has already been used.' });
    }
    if (invite.status === 'revoked') {
      return res.status(409).json({ valid: false, reason: 'revoked', error: 'That invite code is no longer active.' });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(409).json({ valid: false, reason: 'expired', error: 'That invite code has expired. Ask the organization that gave it to you for a new one.' });
    }

    res.json({ valid: true, code: invite.code, org_name: invite.org_name, expires_at: invite.expires_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to validate invite' });
  }
});

/** PATCH /api/invites/:code/revoke — kill a code handed out by mistake. */
router.patch('/:code/revoke', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  try {
    const { rows } = await pool.query(
      `UPDATE invites SET status = 'revoked'
       WHERE code = $1 AND status = 'unused'
       RETURNING code, status`,
      [code]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: 'Only an unused invite code can be revoked' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

/** GET /api/invites?org_id= — codes an org has issued (admin view). */
router.get('/', async (req, res) => {
  const { org_id } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT code, issued_to_label, status, expires_at, created_at
       FROM invites
       ${org_id ? 'WHERE issued_by_org_id = $1' : ''}
       ORDER BY created_at DESC
       LIMIT 100`,
      org_id ? [org_id] : []
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

export default router;
export { generateInviteCode };
