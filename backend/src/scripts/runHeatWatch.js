// HeatSafe — scheduled entry point for the Heat Emergency Watch agent.
//
// Run it by hand:      npm run heat-watch --prefix backend
// Preview only:        npm run heat-watch --prefix backend -- --dry-run
//
// To run it on a schedule during the pilot, a cron entry every 30 minutes is
// enough — conditions do not change faster than that, and the agent suppresses
// duplicate alerts, so a tighter interval buys nothing:
//   */30 * * * * cd /path/to/heat-relief-network/backend && npm run heat-watch

import 'dotenv/config';
import pool from '../db/pool.js';
import { runHeatWatch } from '../services/heatWatchAgent.js';

const dryRun = process.argv.includes('--dry-run');

try {
  const result = await runHeatWatch({ dryRun });

  console.log(`\n=== Heat Watch ${dryRun ? '(dry run — nothing written)' : ''} ===`);
  console.log(`Assessed ${result.areas_assessed} areas · ${result.areas_alerting} alerting`);
  console.log(`Alerts created: ${result.alerts_created} · suppressed as duplicates: ${result.alerts_suppressed_as_duplicate}`);
  if (result.note) console.log(`Note: ${result.note}`);
  console.log('');

  for (const a of result.assessments) {
    const label = a.severity ? a.severity.toUpperCase() : 'no action';
    console.log(`  [${label}] ${a.area} (${a.region}) — ${a.heat_index_f ?? '?'}°F, risk ${a.risk_score ?? '?'}`);
    a.reasons.forEach((r) => console.log(`      · ${r}`));
    if (a.contacts.length) {
      console.log(`      → ${a.contacts.length} resident(s) to contact, highest need first:`);
      a.contacts.slice(0, 5).forEach((c) =>
        console.log(`          Tier ${c.priority_tier} · ${c.full_name} · ${c.distance_mi} mi`));
      if (a.contacts.length > 5) console.log(`          …and ${a.contacts.length - 5} more`);
    }
  }
  console.log('');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('Heat watch failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
