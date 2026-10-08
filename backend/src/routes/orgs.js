import { Router } from 'express';
import pool from '../db/pool.js';
import requireAdmin from '../middleware/requireAdmin.js';

const router = Router();

/** GET /api/orgs/:id/sites — sites managed by an org, for the admin portal */
router.get('/:id/sites', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, type, status, status_updated_at FROM sites WHERE org_id = $1',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch org sites' });
  }
});

export default router;
