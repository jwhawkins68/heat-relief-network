import { Router } from 'express';
import pool from '../db/pool.js';
import requireAdmin from '../middleware/requireAdmin.js';

const router = Router();

/**
 * GET /api/sites?lat=&lon=&radius_m=&type=&open_only=true
 * Core lookup used by the resident-facing map/list AND the AI agent's
 * search_sites tool.
 */
router.get('/', async (req, res) => {
  const { lat, lon, radius_m = 8000, type, open_only } = req.query;

  const conditions = [];
  const values = [];
  let i = 1;

  if (lat && lon) {
    conditions.push(
      `ST_DWithin(location, ST_MakePoint($${i++}, $${i++})::geography, $${i++})`
    );
    values.push(lon, lat, radius_m);
  }
  if (type) {
    conditions.push(`type = $${i++}`);
    values.push(type);
  }
  if (open_only === 'true') {
    conditions.push(`status = 'open'`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const distanceSelect = lat && lon
    ? `, ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m`
    : '';
  const orderBy = lat && lon ? 'ORDER BY distance_m ASC' : 'ORDER BY name ASC';

  const query = `
    SELECT id, name, type, address, status, hours_text, capacity,
           languages, accessibility, status_updated_at,
           ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
           ${distanceSelect}
    FROM sites
    ${where}
    ${orderBy}
    LIMIT 50;
  `;

  try {
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

/** GET /api/sites/:id — full detail including inventory */
router.get('/:id', async (req, res) => {
  try {
    const site = await pool.query(
      `SELECT id, org_id, name, type, address, status, hours_text, capacity,
              languages, accessibility, status_updated_at, status_updated_by, created_at,
              ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
       FROM sites WHERE id = $1`,
      [req.params.id]
    );
    if (!site.rows[0]) return res.status(404).json({ error: 'Site not found' });

    const inventory = await pool.query(
      'SELECT item, level, updated_at FROM inventory_items WHERE site_id = $1',
      [req.params.id]
    );
    res.json({ ...site.rows[0], inventory: inventory.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch site' });
  }
});

/** PATCH /api/sites/:id/status — org portal uses this to update status */
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status, updated_by } = req.body;
  if (!['open', 'closed', 'full', 'unknown'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE sites SET status = $1, status_updated_at = now(), status_updated_by = $2
       WHERE id = $3 RETURNING id, status, status_updated_at`,
      [status, updated_by, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

export default router;
