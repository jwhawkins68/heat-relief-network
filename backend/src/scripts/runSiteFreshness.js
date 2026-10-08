// HeatSafe — scheduled entry point for the Site Status Freshness agent.
//
// Report only:   npm run site-freshness --prefix backend
// Also retire:   npm run site-freshness --prefix backend -- --expire
//
// Daily is the right cadence — status decays over hours and days, not minutes:
//   0 6 * * * cd /path/to/heat-relief-network/backend && npm run site-freshness

import 'dotenv/config';
import pool from '../db/pool.js';
import { runSiteFreshness } from '../services/siteFreshnessAgent.js';

const expire = process.argv.includes('--expire');

try {
  const r = await runSiteFreshness({ expire });

  console.log(`\n=== Site Status Freshness ${expire ? '(retiring expired claims)' : '(report only)'} ===`);
  console.log(`Assessed ${r.sites_assessed} sites — ${JSON.stringify(r.by_confidence)}`);
  if (expire) console.log(`Retired ${r.claims_retired} expired claim(s) to "unknown".`);
  else if (r.would_retire) console.log(`${r.would_retire} claim(s) would be retired. Re-run with --expire to apply.`);
  console.log('');

  if (!r.confirm_first.length) {
    console.log('  Every site status is current. Nothing to confirm.\n');
  } else {
    console.log(`  Confirm these first (${r.confirm_first.length}):\n`);
    r.confirm_first.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.confidence}] ${s.name} — ${s.status}`);
      console.log(`      ${s.area || 'no area'} · ${s.area_heat_f ?? '?'}°F · priority ${s.confirmation_priority}${s.retired ? ' · RETIRED' : ''}`);
      s.reasons.forEach((x) => console.log(`      · ${x}`));
      console.log('');
    });
  }

  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('Site freshness failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
