import { Router } from 'express';
import requireAdmin from '../middleware/requireAdmin.js';
import { runHeatWatch } from '../services/heatWatchAgent.js';
import { planDispatch } from '../services/dispatchAgent.js';

const router = Router();

// Both agents are organization-facing: their output names registered residents
// and their priority tiers, so they sit behind the same gate as the queue.

/**
 * POST /api/agents/heat-watch/run?dry_run=true
 * Runs one watch cycle. dry_run assesses and reports without writing alerts —
 * use it to preview what the agent would do before letting it act.
 */
router.post('/heat-watch/run', requireAdmin, async (req, res) => {
  const dryRun = req.query.dry_run === 'true';
  try {
    res.json(await runHeatWatch({ dryRun }));
  } catch (err) {
    console.error('Heat watch agent failed:', err.message);
    res.status(500).json({ error: 'Heat watch run failed' });
  }
});

/**
 * GET /api/agents/dispatch/plan?hours=12
 * Builds an outreach plan over the scheduled volunteer shifts in the window.
 * Read-only — it proposes, a coordinator disposes.
 */
router.get('/dispatch/plan', requireAdmin, async (req, res) => {
  const hours = Number(req.query.hours) || 12;
  if (hours < 1 || hours > 168) {
    return res.status(400).json({ error: 'hours must be between 1 and 168' });
  }
  try {
    res.json(await planDispatch({ hoursAhead: hours }));
  } catch (err) {
    console.error('Dispatch agent failed:', err.message);
    res.status(500).json({ error: 'Dispatch planning failed' });
  }
});

export default router;
