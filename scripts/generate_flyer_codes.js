#!/usr/bin/env node
// Issues a batch of single-use registration codes for every seeded cooling
// center and writes them to a CSV (site, city, code, expires_at, register_url).
// Called by scripts/generate_flyer_codes.sh, which loads backend/.env first.
//
// Env:  ADMIN_TOKEN (required, never printed)   API_BASE (default http://localhost:4000)
//       REGISTER_BASE_URL (default: this Mac's LAN address on :3000)
//       PER_SITE (default 25)   EXPIRES_IN_DAYS (default 30)   OUT_DIR   ORG_ID

const fs = require('fs');
const os = require('os');
const path = require('path');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const API_BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/+$/, '');
const ORG_ID = process.env.ORG_ID || 'c1335a41-dc02-4d0f-8a29-f1398bd955df';
const PER_SITE = Number(process.env.PER_SITE || 25);
const EXPIRES_IN_DAYS = Number(process.env.EXPIRES_IN_DAYS || 30);
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'Claude outputs', 'flyer-codes');

// The 8 cooling_center sites from backend/src/db/seed_sites.sql
const SITES = [
  ['Sunnyside Community Center & Park', 'Houston'],
  ['Park Place Regional Library', 'Houston'],
  ['Young Neighborhood Library', 'Houston'],
  ['Martin Luther King Jr. Branch Library', 'Dallas'],
  ['Ella Mae Shamblee Library', 'Fort Worth'],
  ['Southeast Branch Library', 'Austin'],
  ['Dottie Jordan Recreation Center', 'Austin'],
  ['BiblioTech West', 'San Antonio'],
];

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error('ADMIN_TOKEN not found - is backend/.env set up?');
  if (!Number.isInteger(PER_SITE) || PER_SITE < 1 || PER_SITE > 500) throw new Error('PER_SITE must be 1-500');
  if (!Number.isInteger(EXPIRES_IN_DAYS) || EXPIRES_IN_DAYS < 1 || EXPIRES_IN_DAYS > 365) {
    throw new Error('EXPIRES_IN_DAYS must be 1-365');
  }

  const base = (process.env.REGISTER_BASE_URL || `http://${lanAddress()}:3000`).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(base) || /^https?:\/\/https?:/i.test(base)) {
    throw new Error(`REGISTER_BASE_URL looks wrong: ${base} (use one "http://", no path)`);
  }
  const registerUrl = `${base}/register.html`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = path.join(OUT_DIR, `flyer_codes_${stamp}.csv`);
  const rows = [['site', 'city', 'code', 'expires_at', 'register_url']];

  const flush = () => fs.writeFileSync(outFile, rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

  let total = 0;
  for (const [site, city] of SITES) {
    process.stdout.write(`${site} (${city}) `);
    for (let n = 1; n <= PER_SITE; n++) {
      const res = await fetch(`${API_BASE}/api/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
        body: JSON.stringify({
          org_id: ORG_ID,
          issued_to_label: `${site} (${city}) - flyer batch ${stamp.slice(0, 10)} #${n}`,
          expires_in_days: EXPIRES_IN_DAYS,
        }),
      });
      let body = {};
      try { body = await res.json(); } catch { /* handled below */ }
      if (res.status !== 201 || !body.code) {
        flush();
        throw new Error(`\nAPI returned ${res.status}: ${body.error || 'no code in response'}. ` +
          `${total} codes saved so far in ${outFile}`);
      }
      rows.push([site, city, body.code, body.expires_at, registerUrl]);
      total++;
    }
    process.stdout.write(`-> ${PER_SITE} codes\n`);
  }
  flush();
  console.log(`\nDone: ${total} single-use codes, expire in ${EXPIRES_IN_DAYS} days.`);
  console.log(`Register page on the flyer: ${registerUrl}`);
  console.log(`CSV: ${outFile}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
