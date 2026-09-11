// Heat Relief Network — batch recompute of area risk scores.
//
// Run manually with `npm run recompute-risk`, or on a schedule (cron, a
// hosted scheduler, etc.) once this is deployed — the same pattern the
// stubbed NWS-polling job in routes/alerts.js is meant to follow.
// Each area's heat_index_f would ideally be refreshed from a weather feed
// right before this runs; for now it recomputes from whatever is stored.

import pool from '../db/pool.js';
import { computeVulnerabilityScore } from '../services/riskScore.js';

async function run() {
  const { rows: areas } = await pool.query('SELECT * FROM areas');

  for (const area of areas) {
    const { score } = computeVulnerabilityScore(area);
    await pool.query(
      `UPDATE areas SET risk_score = $1, risk_score_updated_at = now() WHERE id = $2`,
      [score, area.id]
    );
    console.log(`${area.name}: risk_score = ${score}`);
  }

  console.log(`Recomputed ${areas.length} area(s).`);
  await pool.end();
}

run().catch((err) => {
  console.error('Failed to recompute risk scores:', err);
  process.exit(1);
});
