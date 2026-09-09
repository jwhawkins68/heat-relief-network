import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

/** GET /api/alerts?region= — active alerts for a region */
router.get('/', async (req, res) => {
  const { region } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM alerts
       WHERE (ends_at IS NULL OR ends_at > now())
         AND ($1::text IS NULL OR region = $1)
       ORDER BY starts_at DESC`,
      [region || null]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// TODO: background job that polls the NWS API (api.weather.gov/alerts/active)
// on a schedule, diffs against this table, inserts new alerts, and triggers
// the notification service (Twilio/FCM/email) for opted-in users in region.

export default router;
