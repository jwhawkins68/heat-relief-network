import { Router } from 'express';
import pool from '../db/pool.js';
import { computeVulnerabilityScore, applyResourceGap } from '../services/riskScore.js';

const router = Router();

/**
 * GET /api/risk-areas?region=
 * Ranks areas by priority = base vulnerability score adjusted for how far
 * the nearest OPEN site is. This is the "match high-heat areas to the
 * customers who need resources most" feature.
 */
router.get('/', async (req, res) => {
  const { region } = req.query;

  try {
    const { rows: areas } = await pool.query(
      `SELECT id, name, region, population, pct_elderly, pct_low_income,
              pct_no_ac, heat_index_f, risk_score, risk_score_updated_at,
              ST_X(centroid::geometry) AS lon, ST_Y(centroid::geometry) AS lat
       FROM areas
       WHERE ($1::text IS NULL OR region = $1)`,
      [region || null]
    );

    const ranked = await Promise.all(
      areas.map(async (area) => {
        const { rows: nearest } = await pool.query(
          `SELECT id, name, type, address,
                  ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m
           FROM sites
           WHERE status = 'open'
           ORDER BY location <-> ST_MakePoint($1, $2)::geography
           LIMIT 1`,
          [area.lon, area.lat]
        );

        const nearestSite = nearest[0] || null;
        const priority_score = applyResourceGap(
          Number(area.risk_score) || 0,
          nearestSite ? Number(nearestSite.distance_m) : null
        );

        return { ...area, nearest_open_site: nearestSite, priority_score };
      })
    );

    ranked.sort((a, b) => b.priority_score - a.priority_score);
    res.json(ranked);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch risk areas' });
  }
});

/**
 * POST /api/risk-areas/:id/recompute
 * Recomputes one area's base vulnerability score from its stored inputs
 * (heat_index_f, pct_elderly, pct_low_income, pct_no_ac). In production
 * this would run on a schedule — see ../scripts/recomputeAllRiskScores.js
 * — or be triggered whenever heat_index_f is refreshed from a weather feed.
 */
router.post('/:id/recompute', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM areas WHERE id = $1', [req.params.id]);
    const area = rows[0];
    if (!area) return res.status(404).json({ error: 'Area not found' });

    const { score, breakdown } = computeVulnerabilityScore(area);

    const { rows: updated } = await pool.query(
      `UPDATE areas SET risk_score = $1, risk_score_updated_at = now()
       WHERE id = $2 RETURNING id, name, risk_score, risk_score_updated_at`,
      [score, req.params.id]
    );

    res.json({ ...updated[0], breakdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to recompute risk score' });
  }
});

export default router;
