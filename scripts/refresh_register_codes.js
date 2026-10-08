#!/usr/bin/env node
// Replaces the dead (already used / expired / unknown) registration codes in the
// register-page dropdown with freshly issued single-use codes.
// Called by scripts/refresh_register_codes.sh, which loads backend/.env first.
//
// For each center listed in frontend/js/register.js (INVITE_OPTIONS) it asks the
// backend whether the code is still usable (read-only). Usable codes are kept.
// Dead ones get a new code from POST /api/invites and register.js is rewritten.
//
// Env: ADMIN_TOKEN (required, never printed)  API_BASE (default http://localhost:4000)
//      ORG_ID  EXPIRES_IN_DAYS (default 30)  REGISTER_JS (default frontend/js/register.js)
//      DRY_RUN=1  report only, issue nothing, change nothing
//      REFRESH_ALL=1  replace every code, even usable ones

const fs = require('fs');
const path = require('path');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const API_BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/+$/, '');
const ORG_ID = process.env.ORG_ID || 'c1335a41-dc02-4d0f-8a29-f1398bd955df';
const EXPIRES_IN_DAYS = Number(process.env.EXPIRES_IN_DAYS || 30);
const REGISTER_JS = process.env.REGISTER_JS || path.join('frontend', 'js', 'register.js');
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'Claude outputs', 'flyer-codes');
const DRY_RUN = process.env.DRY_RUN === '1';
const REFRESH_ALL = process.env.REFRESH_ALL === '1';

const LINE = /\{\s*site:\s*'([^']+)',\s*city:\s*'([^']+)',\s*code:\s*'([A-Z0-9]{8})'\s*\}/g;

async function main() {
  if (!DRY_RUN && !ADMIN_TOKEN) throw new Error('ADMIN_TOKEN not found - is backend/.env set up?');
  if (!Number.isInteger(EXPIRES_IN_DAYS) || EXPIRES_IN_DAYS < 1 || EXPIRES_IN_DAYS > 365) {
    throw new Error('EXPIRES_IN_DAYS must be 1-365');
  }
  const original = fs.readFileSync(REGISTER_JS, 'utf8');
  const options = [...original.matchAll(LINE)].map((m) => ({ site: m[1], city: m[2], code: m[3] }));
  if (options.length === 0) throw new Error(`No INVITE_OPTIONS entries found in ${REGISTER_JS}`);

  // 1. Read-only check of every current code. Any surprise stops the run before changes.
  const plan = [];
  for (const o of options) {
    let res;
    try { res = await fetch(`${API_BASE}/api/invites/${o.code}/validate`); }
    catch { throw new Error(`Backend is not answering on ${API_BASE} - start it with ./start.sh first.`); }
    let body = {};
    try { body = await res.json(); } catch { /* ignore */ }
    if (![200, 404, 409].includes(res.status)) {
      throw new Error(`Unexpected ${res.status} checking ${o.code} (${o.site}). Nothing was changed.`);
    }
    const usable = res.status === 200;
    const why = usable ? 'usable' : (body.reason || (res.status === 404 ? 'not_found' : 'unusable'));
    plan.push({ ...o, usable, why, replace: REFRESH_ALL || !usable });
    console.log(`${usable ? 'ok     ' : 'DEAD   '} ${o.code}  ${o.site} (${o.city})  ${why}`);
  }
  const todo = plan.filter((p) => p.replace);
  console.log(`\n${todo.length} of ${plan.length} codes need replacing.`);
  if (DRY_RUN) { console.log('DRY_RUN=1 - nothing issued, nothing changed.'); return; }
  if (todo.length === 0) { console.log('Nothing to do.'); return; }

  // 2. Issue replacements. Nothing is written to register.js until all succeed.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  for (const p of todo) {
    const res = await fetch(`${API_BASE}/api/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({
        org_id: ORG_ID,
        issued_to_label: `${p.site} (${p.city}) - register dropdown ${stamp.slice(0, 10)}`,
        expires_in_days: EXPIRES_IN_DAYS,
      }),
    });
    let body = {};
    try { body = await res.json(); } catch { /* handled below */ }
    if (res.status !== 201 || !body.code) {
      throw new Error(`API returned ${res.status}: ${body.error || 'no code in response'} for ${p.site}. ` +
        `register.js was NOT changed (codes issued so far stay unused in the database).`);
    }
    p.newCode = body.code;
    p.expires = body.expires_at;
    console.log(`issued  ${p.site} (${p.city}): ${p.code} -> ${p.newCode}`);
  }

  // 3. Back up, then rewrite only the code strings.
  fs.mkdirSync(path.join(OUT_DIR, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'backups', `register.js.${stamp}.bak`), original);
  let updated = original;
  for (const p of todo) {
    const oldEntry = new RegExp(`(site:\\s*'${p.site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*city:\\s*'${p.city}',\\s*code:\\s*')${p.code}(')`);
    if (!oldEntry.test(updated)) throw new Error(`Could not locate ${p.site} in ${REGISTER_JS}; nothing written.`);
    updated = updated.replace(oldEntry, `$1${p.newCode}$2`);
  }
  fs.writeFileSync(REGISTER_JS, updated);

  const log = path.join(OUT_DIR, `refreshed_codes_${stamp}.csv`);
  fs.writeFileSync(log, ['site,city,old_code,new_code,expires_at',
    ...todo.map((p) => [p.site, p.city, p.code, p.newCode, p.expires].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n') + '\n');
  console.log(`\nUpdated ${REGISTER_JS} (${todo.length} codes). Backup and log saved in ${OUT_DIR}`);
  console.log(`Log: ${log}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
