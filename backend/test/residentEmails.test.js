import { test } from 'node:test';
import assert from 'node:assert/strict';

// residentNotifier imports the db pool, which needs a DATABASE_URL to exist
// (pg connects lazily, so nothing is actually contacted here).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:1/test';
const { buildWelcomeEmail, buildAlertEmail, buildPasswordResetEmail } = await import('../src/services/residentNotifier.js');

const resident = {
  full_name: 'Maria Lopez',
  registration_id: 'HS-7KQ2-M9XD',
  region: 'Harris County',
};
const sites = [
  { name: 'Sunnyside Community Center & Park', address: '3502 Bellfort Ave, Houston, TX 77051', status: 'open', hours_text: '9am-6pm', distance_mi: '1.2' },
  { name: 'Young Neighborhood Library', address: '5107 Griggs Rd, Houston, TX 77021', status: 'unknown', hours_text: null, distance_mi: '2.8' },
];

test('welcome email carries the Registration ID, county alerts and cooling centers', () => {
  const alerts = [{ severity: 'warning', message: 'Heat index near 110F this afternoon.' }];
  const email = buildWelcomeEmail({ resident, alerts, sites });
  assert.match(email.subject, /HS-7KQ2-M9XD/);
  for (const body of [email.text, email.html]) {
    assert.match(body, /HS-7KQ2-M9XD/);
    assert.match(body, /Harris County/);
    assert.match(body, /Heat index near 110F/);
    assert.match(body, /Sunnyside Community Center/);
  }
  assert.match(email.text, /Hi Maria,/);
});

test('welcome email says so when there are no active alerts', () => {
  const email = buildWelcomeEmail({ resident, alerts: [], sites });
  assert.match(email.text, /No active heat alerts for Harris County/);
});

test('unconfirmed site status is flagged instead of implying the site is open', () => {
  const email = buildWelcomeEmail({ resident, alerts: [], sites });
  assert.match(email.text, /Young Neighborhood Library \(2\.8 mi, status not confirmed/);
});

test('alert email names severity, county, message and nearest cooling centers', () => {
  const alert = { severity: 'emergency', region: 'Harris County', message: 'Extreme heat. Go to a cooling center.', ends_at: null };
  const email = buildAlertEmail({ resident, alert, sites });
  assert.equal(email.subject, '[HeatSafe] Heat emergency for Harris County');
  assert.match(email.text, /HEAT EMERGENCY for Harris County/);
  assert.match(email.text, /Extreme heat\. Go to a cooling center\./);
  assert.match(email.text, /Sunnyside Community Center/);
  assert.match(email.text, /I need help/);
});

test('HTML emails escape names and messages', () => {
  const alert = { severity: 'warning', region: 'Harris County', message: '<script>x</script>', ends_at: null };
  const email = buildAlertEmail({ resident: { ...resident, full_name: '<b>Eve</b>' }, alert, sites: [] });
  assert.ok(!email.html.includes('<script>'));
  assert.ok(!email.html.includes('<b>Eve</b>'));
  assert.match(email.html, /&lt;script&gt;/);
});

test('password reset email carries the one-time link and says it expires', () => {
  const resetUrl = 'http://localhost:3000/login.html?reset=' + 'a'.repeat(64);
  const email = buildPasswordResetEmail({ resident, resetUrl });
  assert.equal(email.subject, 'Reset your HeatSafe password');
  assert.ok(email.text.includes(resetUrl));
  assert.ok(email.html.includes(resetUrl));
  assert.match(email.text, /within 1 hour/);
  assert.match(email.text, /HS-7KQ2-M9XD/);
});
