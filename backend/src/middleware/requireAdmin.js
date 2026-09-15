import { timingSafeEqual } from 'node:crypto';

/**
 * Minimal admin gate.
 *
 * This is NOT real user authentication. It is a shared organization token that
 * keeps the admin surface — org site management, invite issuing, and the
 * resident priority queue — from being readable by anyone who happens to know
 * or guess an org UUID. The resident queue holds real people's age, income
 * band, employment and insurance status, so it must not be world-readable.
 *
 * Set ADMIN_TOKEN in backend/.env. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Fails CLOSED: if ADMIN_TOKEN is unset the admin routes refuse to serve rather
 * than falling open. Replace with per-user org accounts when auth is scheduled.
 */
export default function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    return res.status(503).json({
      error:
        'Admin access is not configured on this server. Set ADMIN_TOKEN in ' +
        'backend/.env and then restart the backend — .env is only read at ' +
        'startup, so a running server will not pick up a newly added token.',
    });
  }

  const provided = req.get('x-admin-token') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid or missing admin token' });
  }

  next();
}
