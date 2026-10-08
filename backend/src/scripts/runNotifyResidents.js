// HeatSafe — email residents about every heat alert that is still active.
//
//   npm run notify-residents --prefix backend
//
// Safe to re-run: each resident gets each alert at most once
// (notification_log). The heat-watch agent already emails residents when it
// creates an alert; this covers alerts added any other way (seed data, a
// future NWS import, a manual INSERT) and retries any send that failed.

import 'dotenv/config';
import pool from '../db/pool.js';
import { notifyActiveAlerts } from '../services/residentNotifier.js';
import { usingTestInbox } from '../services/mailer.js';

try {
  const results = await notifyActiveAlerts();
  console.log(`\n=== Resident alert emails ${usingTestInbox() ? '(Ethereal TEST inbox)' : ''} ===`);
  if (!results.length) console.log('No active alerts - nothing to send.');
  for (const r of results) {
    console.log(`  ${r.region}: ${r.sent} sent, ${r.failed} failed`);
    r.previews.forEach((p) => console.log(`      ${p.registration_id}  ${p.preview_url}`));
  }
  console.log('');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('Notify residents failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
}
