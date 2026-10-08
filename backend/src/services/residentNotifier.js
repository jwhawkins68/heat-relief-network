// HeatSafe — resident email notifications.
//
//   sendWelcomeEmail(residentId)  Registration ID, current heat alerts for the
//                                 resident's county, nearest cooling centers.
//                                 Sent on registration and when an older
//                                 profile is claimed.
//   notifyAlert(alertId)          Emails every opted-in resident in the
//                                 alert's county, highest need first, with
//                                 the cooling centers nearest to each of them.
//   notifyActiveAlerts()          notifyAlert for every alert still active.
//
// Each alert is emailed to a resident at most once: a notification_log row
// is claimed BEFORE sending (the unique index rejects a second claim), and
// released again if the send fails so a later run can retry it.
//
// The build*Email functions are pure so the wording can be unit tested.

import pool from '../db/pool.js';
import { sendMail } from './mailer.js';

function frontendBase() {
  return (process.env.FRONTEND_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there';
}

// ── Data ────────────────────────────────────────────────────────────────

async function nearestCoolingSites(residentId, limit = 3) {
  const { rows } = await pool.query(
    `SELECT s.name, s.address, s.status, s.hours_text,
            ROUND((ST_Distance(s.location, r.location) / 1609.344)::numeric, 1) AS distance_mi
     FROM residents r
     JOIN sites s ON s.type = 'cooling_center' AND s.status <> 'closed'
     WHERE r.id = $1
     ORDER BY ST_Distance(s.location, r.location) ASC
     LIMIT $2`,
    [residentId, limit]
  );
  return rows;
}

async function activeAlertsFor(region) {
  if (!region) return [];
  const { rows } = await pool.query(
    `SELECT id, severity, message, starts_at, ends_at FROM alerts
     WHERE region = $1 AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
     ORDER BY starts_at DESC`,
    [region]
  );
  return rows;
}

// ── Wording ─────────────────────────────────────────────────────────────

function siteLines(sites) {
  if (!sites.length) return ['  No cooling centers found near you right now. Check the map for other relief sites.'];
  return sites.map((s) => {
    const status = s.status === 'open' ? 'open' : 'status not confirmed - call ahead';
    const hours = s.hours_text ? `, ${s.hours_text}` : '';
    return `  - ${s.name} (${s.distance_mi} mi, ${status}${hours})\n    ${s.address}`;
  });
}

function siteListHtml(sites) {
  if (!sites.length) {
    return '<p>No cooling centers found near you right now. Check the map for other relief sites.</p>';
  }
  return `<ul>${sites.map((s) => {
    const status = s.status === 'open' ? 'Open' : 'Status not confirmed &mdash; call ahead';
    const hours = s.hours_text ? ` &middot; ${escapeHtml(s.hours_text)}` : '';
    return `<li><strong>${escapeHtml(s.name)}</strong> &middot; ${escapeHtml(s.distance_mi)} mi &middot; ${status}${hours}<br>${escapeHtml(s.address)}</li>`;
  }).join('')}</ul>`;
}

function footerText() {
  return `\nSee your info, check in, or turn these emails off: ${frontendBase()}/me.html\n` +
    'In a medical emergency, call 911.';
}

function footerHtml() {
  return `<p style="color:#666;font-size:13px;">See your info, check in, or turn these emails off at ` +
    `<a href="${frontendBase()}/me.html">My HeatSafe info</a>.<br>In a medical emergency, call 911.</p>`;
}

function buildWelcomeEmail({ resident, alerts, sites }) {
  const alertText = alerts.length
    ? alerts.map((a) => `  - [${a.severity.toUpperCase()}] ${a.message}`).join('\n')
    : `  No active heat alerts${resident.region ? ` for ${resident.region}` : ''} right now.`;

  const text = [
    `Hi ${firstName(resident.full_name)},`,
    '',
    "You're registered for HeatSafe priority access.",
    '',
    `Your Registration ID: ${resident.registration_id}`,
    'Give this ID to a caseworker or cooling-center staff so they can find your record quickly.',
    `Log in any time with this email address at ${frontendBase()}/login.html`,
    '',
    `Heat alerts${resident.region ? ` for ${resident.region}` : ''}:`,
    alertText,
    '',
    'Cooling centers nearest you:',
    ...siteLines(sites),
    '',
    `We'll email you here when a new heat alert is issued${resident.region ? ` for ${resident.region}` : ' for your county'}.`,
    footerText(),
  ].join('\n');

  const alertHtml = alerts.length
    ? `<ul>${alerts.map((a) => `<li><strong>${escapeHtml(a.severity.toUpperCase())}</strong> &mdash; ${escapeHtml(a.message)}</li>`).join('')}</ul>`
    : `<p>No active heat alerts${resident.region ? ` for ${escapeHtml(resident.region)}` : ''} right now.</p>`;

  const html = `
    <p>Hi ${escapeHtml(firstName(resident.full_name))},</p>
    <p>You're registered for HeatSafe priority access.</p>
    <p style="font-size:18px;">Your Registration ID: <strong style="letter-spacing:1px;">${escapeHtml(resident.registration_id)}</strong></p>
    <p>Give this ID to a caseworker or cooling-center staff so they can find your record quickly.
       <a href="${frontendBase()}/login.html">Log in</a> any time with this email address.</p>
    <h3>Heat alerts${resident.region ? ` for ${escapeHtml(resident.region)}` : ''}</h3>
    ${alertHtml}
    <h3>Cooling centers nearest you</h3>
    ${siteListHtml(sites)}
    <p>We'll email you here when a new heat alert is issued${resident.region ? ` for ${escapeHtml(resident.region)}` : ' for your county'}.</p>
    ${footerHtml()}`;

  return {
    subject: `Welcome to HeatSafe - your Registration ID is ${resident.registration_id}`,
    text,
    html,
  };
}

function buildAlertEmail({ resident, alert, sites }) {
  const severity = String(alert.severity || '').toUpperCase();
  const until = alert.ends_at
    ? ` until ${new Date(alert.ends_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' })} (Central)`
    : '';

  const text = [
    `Hi ${firstName(resident.full_name)},`,
    '',
    `HEAT ${severity} for ${alert.region}${until}.`,
    '',
    alert.message,
    '',
    'Cooling centers nearest you:',
    ...siteLines(sites),
    '',
    'Stay hydrated, avoid the midday sun, and check on neighbors.',
    `If you need help, tap "I need help" on your HeatSafe page: ${frontendBase()}/me.html`,
    `Registration ID: ${resident.registration_id}`,
    footerText(),
  ].join('\n');

  const html = `
    <p>Hi ${escapeHtml(firstName(resident.full_name))},</p>
    <p style="font-size:18px;"><strong>Heat ${escapeHtml(severity)} for ${escapeHtml(alert.region)}</strong>${escapeHtml(until)}.</p>
    <p>${escapeHtml(alert.message)}</p>
    <h3>Cooling centers nearest you</h3>
    ${siteListHtml(sites)}
    <p>Stay hydrated, avoid the midday sun, and check on neighbors.
       If you need help, tap <strong>I need help</strong> on <a href="${frontendBase()}/me.html">your HeatSafe page</a>.</p>
    <p>Registration ID: <strong>${escapeHtml(resident.registration_id)}</strong></p>
    ${footerHtml()}`;

  return {
    subject: `[HeatSafe] Heat ${alert.severity} for ${alert.region}`,
    text,
    html,
  };
}

function buildPasswordResetEmail({ resident, resetUrl }) {
  const text = [
    `Hi ${firstName(resident.full_name)},`,
    '',
    'Someone asked to reset the password for your HeatSafe account.',
    `To choose a new password, open this link within 1 hour:`,
    resetUrl,
    '',
    "If this wasn't you, ignore this email - your password stays the same.",
    `Registration ID: ${resident.registration_id}`,
  ].join('\n');

  const html = `
    <p>Hi ${escapeHtml(firstName(resident.full_name))},</p>
    <p>Someone asked to reset the password for your HeatSafe account.</p>
    <p><a href="${escapeHtml(resetUrl)}" style="font-size:16px;">Choose a new password</a> (link works for 1 hour).</p>
    <p>If this wasn't you, ignore this email &mdash; your password stays the same.</p>
    <p style="color:#666;font-size:13px;">Registration ID: ${escapeHtml(resident.registration_id)}</p>`;

  return { subject: 'Reset your HeatSafe password', text, html };
}

// ── Sending ─────────────────────────────────────────────────────────────

/**
 * Not written to notification_log: the email body holds a live reset link,
 * and the log (and its preview URLs) is readable by staff.
 */
async function sendPasswordResetEmail(resident, token) {
  const resetUrl = `${frontendBase()}/login.html?reset=${encodeURIComponent(token)}`;
  return sendMail({ to: resident.email, ...buildPasswordResetEmail({ resident, resetUrl }) });
}

/** Never throws — an email problem must not undo a registration. */
async function sendWelcomeEmail(residentId) {
  try {
    const { rows } = await pool.query(
      'SELECT id, full_name, email, registration_id, region FROM residents WHERE id = $1',
      [residentId]
    );
    const resident = rows[0];
    if (!resident || !resident.email) return { sent: false, reason: 'no email on file' };

    const [alerts, sites] = await Promise.all([
      activeAlertsFor(resident.region),
      nearestCoolingSites(resident.id),
    ]);

    const { previewUrl } = await sendMail({ to: resident.email, ...buildWelcomeEmail({ resident, alerts, sites }) });
    await pool.query(
      `INSERT INTO notification_log (resident_id, kind, preview_url) VALUES ($1, 'welcome', $2)`,
      [resident.id, previewUrl]
    );
    return { sent: true, previewUrl };
  } catch (err) {
    console.error('Welcome email failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function notifyAlert(alertId) {
  const { rows: alertRows } = await pool.query(
    `SELECT id, region, severity, message, starts_at, ends_at FROM alerts
     WHERE id = $1 AND (ends_at IS NULL OR ends_at > now())`,
    [alertId]
  );
  const alert = alertRows[0];
  const summary = { alert_id: alertId, region: alert ? alert.region : null, sent: 0, failed: 0, previews: [] };
  if (!alert || !alert.region) return summary;

  const { rows: residents } = await pool.query(
    `SELECT r.id, r.full_name, r.email, r.registration_id
     FROM residents r
     WHERE r.region = $1 AND r.email IS NOT NULL AND r.notify_email
       AND NOT EXISTS (
         SELECT 1 FROM notification_log n
         WHERE n.resident_id = r.id AND n.alert_id = $2 AND n.channel = 'email'
       )
     ORDER BY r.need_score DESC, r.created_at ASC`,
    [alert.region, alert.id]
  );

  for (const resident of residents) {
    // Claim first; if another run already claimed this pair, skip it.
    const { rows: claimed } = await pool.query(
      `INSERT INTO notification_log (resident_id, alert_id, kind)
       VALUES ($1, $2, 'alert')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [resident.id, alert.id]
    );
    if (!claimed[0]) continue;

    try {
      const sites = await nearestCoolingSites(resident.id);
      const { previewUrl } = await sendMail({ to: resident.email, ...buildAlertEmail({ resident, alert, sites }) });
      await pool.query('UPDATE notification_log SET preview_url = $1 WHERE id = $2', [previewUrl, claimed[0].id]);
      summary.sent += 1;
      if (previewUrl) summary.previews.push({ registration_id: resident.registration_id, preview_url: previewUrl });
    } catch (err) {
      await pool.query('DELETE FROM notification_log WHERE id = $1', [claimed[0].id]).catch(() => {});
      summary.failed += 1;
      console.error(`Alert email to ${resident.registration_id} failed:`, err.message);
    }
  }

  return summary;
}

async function notifyActiveAlerts() {
  const { rows } = await pool.query(
    `SELECT id FROM alerts
     WHERE starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
     ORDER BY starts_at ASC`
  );
  const results = [];
  for (const { id } of rows) results.push(await notifyAlert(id));
  return results;
}

export {
  sendWelcomeEmail, notifyAlert, notifyActiveAlerts, sendPasswordResetEmail,
  buildWelcomeEmail, buildAlertEmail, buildPasswordResetEmail,
};
