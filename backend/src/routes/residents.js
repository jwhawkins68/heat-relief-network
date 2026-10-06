import { Router } from 'express';
import pool from '../db/pool.js';
import requireAdmin from '../middleware/requireAdmin.js';
import { scoreResident, incomeBand } from '../services/needScore.js';
import { matchServices } from '../services/serviceMatch.js';
import { resolveZip, ZipLookupError } from '../services/zipLookup.js';
import { resolveCounty } from '../services/countyLookup.js';
import { hashPassword, validatePassword } from '../services/passwords.js';
import { generateRegistrationId, normalizeEmail, validateEmail } from '../services/accounts.js';
import { createSession } from '../services/sessions.js';
import { authorizeResident } from '../middleware/residentAuth.js';
import { sendWelcomeEmail } from '../services/residentNotifier.js';

const router = Router();

const EMPLOYMENT_STATUSES = [
  'outdoor_worker', 'unemployed', 'unable_to_work',
  'retired', 'part_time', 'student', 'full_time_indoor',
];
const INSURANCE_STATUSES = ['personal', 'government_assistance', 'none'];

const EMAIL_TAKEN = 'An account with this email already exists. Log in instead, or use a different email.';

/**
 * Field-level validation. Returns { field: message } so the registration form
 * can render each error against the input it belongs to.
 */
function validateIntake(body) {
  const errors = {};

  if (!body.full_name || !String(body.full_name).trim()) {
    errors.full_name = 'Please enter your name';
  }
  if (!body.zip || !/^\d{5}$/.test(String(body.zip).trim())) {
    errors.zip = 'Enter a 5-digit ZIP code';
  }

  const age = Number(body.age);
  if (!Number.isFinite(age) || age < 0 || age > 120) {
    errors.age = 'Enter an age between 0 and 120';
  }

  const household = Number(body.household_size);
  if (!Number.isInteger(household) || household < 1 || household > 20) {
    errors.household_size = 'Enter a household size between 1 and 20';
  }

  const income = Number(body.annual_income);
  if (!Number.isFinite(income) || income < 0) {
    errors.annual_income = 'Enter your annual household income (enter 0 if none)';
  }

  if (!EMPLOYMENT_STATUSES.includes(body.employment_status)) {
    errors.employment_status = 'Choose an employment status';
  }
  if (!INSURANCE_STATUSES.includes(body.insurance_status)) {
    errors.insurance_status = 'Choose an insurance status';
  }

  if (body.consent !== true) {
    errors.consent = 'We need your permission before we can store these answers';
  }

  return errors;
}

/** Login details, required for every new registration. */
function validateAccount(body) {
  const errors = {};
  const emailError = validateEmail(normalizeEmail(body.email));
  if (emailError) errors.email = emailError;
  const passwordError = validatePassword(body.password);
  if (passwordError) errors.password = passwordError;
  return errors;
}

/**
 * POST /api/residents/register
 * Redeems an invite code and registers a resident, scoring them and matching
 * them to nearby relief sites in one round trip.
 *
 * Everything runs inside one transaction: a failed geocode or score must not
 * leave a half-written resident row or burn the invite code.
 */
router.post('/register', async (req, res) => {
  const body = req.body || {};
  const code = String(body.invite_code || '').trim().toUpperCase();

  if (!code) {
    return res.status(400).json({ error: 'An invite code is required', errors: { invite_code: 'Enter your invite code' } });
  }

  const errors = { ...validateIntake(body), ...validateAccount(body) };
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields', errors });
  }

  // One profile per email. Checked up front so the resident gets a friendly
  // message before their invite code is touched; the unique index on
  // lower(email) is what actually guarantees it (see the 23505 handling in
  // the catch below for two sign-ups racing each other).
  const email = normalizeEmail(body.email);
  let passwordHash;
  try {
    const { rows: existingEmail } = await pool.query(
      'SELECT 1 FROM residents WHERE lower(email) = $1',
      [email]
    );
    if (existingEmail[0]) {
      return res.status(409).json({ error: EMAIL_TAKEN, code: 'email_taken', errors: { email: EMAIL_TAKEN } });
    }
    passwordHash = await hashPassword(body.password);
  } catch (err) {
    // Most likely cause: migration_resident_accounts.sql hasn't been run.
    console.error('Registration pre-check failed:', err.message);
    return res.status(500).json({ error: 'Registration is temporarily unavailable. Please try again shortly.' });
  }

  // Geocode before opening the transaction — it's a network call and we don't
  // want to hold a row lock while waiting on an external service.
  let place;
  try {
    place = await resolveZip(body.zip);
  } catch (err) {
    if (err instanceof ZipLookupError) {
      return res.status(err.status).json({ error: err.message, errors: { zip: err.message } });
    }
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the invite row so two simultaneous submissions can't both redeem it.
    const { rows: inviteRows } = await client.query(
      `SELECT id, status, expires_at FROM invites WHERE code = $1 FOR UPDATE`,
      [code]
    );
    const invite = inviteRows[0];

    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "That invite code wasn't recognized.", errors: { invite_code: "That invite code wasn't recognized." } });
    }
    if (invite.status !== 'unused') {
      await client.query('ROLLBACK');
      const message = invite.status === 'redeemed'
        ? 'That invite code has already been used.'
        : 'That invite code is no longer active.';
      return res.status(409).json({ error: message, errors: { invite_code: message } });
    }
    if (new Date(invite.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      const message = 'That invite code has expired.';
      return res.status(409).json({ error: message, errors: { invite_code: message } });
    }

    const intake = {
      age: Number(body.age),
      household_size: Number(body.household_size),
      children_under_5: body.children_under_5 === true,
      employment_status: body.employment_status,
      insurance_status: body.insurance_status,
      annual_income: Number(body.annual_income),
      lat: place.lat,
      lon: place.lon,
    };

    const score = scoreResident(intake);
    const region = resolveCounty(body.city ? String(body.city).trim() : place.city, place.state);

    const { rows: residentRows } = await client.query(
      `INSERT INTO residents (
         full_name, street_address, city, state, zip, location, region,
         age, household_size, children_under_5,
         employment_status, insurance_status, annual_income,
         fpl_pct, need_score, priority_tier,
         invite_id, consent_given_at,
         email, password_hash, registration_id
       ) VALUES (
         $1, $2, $3, $4, $5, ST_MakePoint($6, $7)::geography, $8,
         $9, $10, $11,
         $12, $13, $14,
         $15, $16, $17,
         $18, now(),
         $19, $20, $21
       )
       RETURNING id, full_name, city, zip, need_score, priority_tier, created_at,
                 registration_id, email`,
      [
        String(body.full_name).trim(),
        body.street_address ? String(body.street_address).trim() : null,
        body.city ? String(body.city).trim() : place.city,
        place.state,
        place.zip,
        place.lon,
        place.lat,
        region,
        intake.age,
        intake.household_size,
        intake.children_under_5,
        intake.employment_status,
        intake.insurance_status,
        intake.annual_income,
        score.fpl_pct,
        score.score,
        score.tier,
        invite.id,
        email,
        passwordHash,
        // Random, so a collision is ~1 in 10^12; the unique index would turn
        // one into a failed (retryable) registration rather than a duplicate.
        generateRegistrationId(),
      ]
    );

    const resident = residentRows[0];

    await client.query(
      `UPDATE invites SET status = 'redeemed', redeemed_by_resident_id = $1, redeemed_at = now()
       WHERE id = $2`,
      [resident.id, invite.id]
    );

    // Created inside the transaction: no committed resident, no session.
    const session = await createSession(resident.id, client);

    await client.query('COMMIT');

    // Matching runs after commit — it only reads sites, and a site-lookup
    // hiccup shouldn't undo a valid registration.
    const match = await matchServices(intake, score);

    // NOTE: the raw income figure is deliberately absent from this response.
    res.status(201).json({
      resident: {
        id: resident.id,
        registration_id: resident.registration_id,
        email: resident.email,
        full_name: resident.full_name,
        city: resident.city,
        zip: resident.zip,
      },
      session: { token: session.token, expires_at: session.expires_at },
      priority: {
        tier: score.tier,
        tier_label: score.tier_label,
        reasons: score.reasons,
      },
      ...match,
    });

    // Registration ID, current alerts and nearest cooling centers, by email.
    // Fire and forget: it never throws, and a slow mail server must not hold
    // up the resident's confirmation screen.
    sendWelcomeEmail(resident.id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505' && err.constraint === 'residents_email_unique') {
      return res.status(409).json({ error: EMAIL_TAKEN, code: 'email_taken', errors: { email: EMAIL_TAKEN } });
    }
    // Log the error but never the request body — it contains income,
    // insurance status and a password.
    console.error('Resident registration failed:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/residents?tier=&city=
 * Priority-ranked queue for the admin portal.
 * Raw annual_income is NEVER included — only a coarse band. See
 * docs/NEED-SCORING.md for why.
 */
router.get('/', requireAdmin, async (req, res) => {
  const { tier, city } = req.query;
  const conditions = [];
  const values = [];
  let i = 1;

  if (tier) {
    conditions.push(`r.priority_tier = $${i++}`);
    values.push(Number(tier));
  }
  if (city) {
    conditions.push(`r.city ILIKE $${i++}`);
    values.push(city);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.registration_id, r.email, r.full_name, r.city, r.zip, r.age, r.household_size, r.children_under_5,
              r.employment_status, r.insurance_status, r.fpl_pct,
              r.need_score, r.priority_tier, r.created_at,
              ci.status AS latest_check_in_status, ci.responded_at AS latest_check_in_at
       FROM residents r
       LEFT JOIN LATERAL (
         SELECT status, responded_at FROM check_ins
         WHERE resident_id = r.id
         ORDER BY responded_at DESC
         LIMIT 1
       ) ci ON true
       ${where}
       ORDER BY r.need_score DESC, r.created_at ASC
       LIMIT 200`,
      values
    );

    res.json(rows.map(({ fpl_pct, ...r }) => ({
      ...r,
      income_band: incomeBand(fpl_pct),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch residents' });
  }
});

/**
 * GET /api/residents/:id/match
 * Re-runs matching for an already-registered resident. Site status changes
 * through the day, so yesterday's answer may not be today's.
 */
router.get('/:id/match', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, age, household_size, children_under_5,
              employment_status, insurance_status, annual_income,
              need_score, priority_tier,
              ST_X(location::geometry) AS lon, ST_Y(location::geometry) AS lat
       FROM residents WHERE id = $1`,
      [req.params.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Resident not found' });

    const score = scoreResident(r);
    const match = await matchServices({ ...r, lat: r.lat, lon: r.lon }, score);

    res.json({
      resident: { id: r.id, full_name: r.full_name },
      priority: { tier: score.tier, tier_label: score.tier_label, reasons: score.reasons },
      ...match,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to match resident' });
  }
});


// ─────────────────────────────────────────────
// Resident self-service (Checkpoint plan items A, B, D)
//
// ACCESS: every route below goes through authorizeResident
// (middleware/residentAuth.js). A resident proves who they are with a login
// session (email + password, see routes/auth.js). Profiles registered before
// accounts existed have no password yet; for those only, the resident's own
// UUID still works as a bearer capability until they claim the profile by
// adding an email and password on the My info page. Once claimed, the UUID
// alone opens nothing.
// ─────────────────────────────────────────────

/**
 * GET /api/residents/:id
 * A resident's own info, for the "My HeatSafe info" page. annual_income is
 * deliberately never included — see the NOTE beside it in POST /register.
 */
router.get('/:id', authorizeResident, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, registration_id, email, notify_email,
              password_hash IS NOT NULL AS has_login,
              full_name, street_address, city, state, zip, region,
              age, household_size, children_under_5,
              employment_status, insurance_status, fpl_pct,
              need_score, priority_tier, created_at
       FROM residents WHERE id = $1`,
      [req.params.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Resident not found' });

    const { fpl_pct, ...safe } = r;
    res.json({ ...safe, income_band: incomeBand(fpl_pct) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch resident' });
  }
});

/**
 * PATCH /api/residents/:id
 * Self-service profile update. Takes the same shape as registration (minus
 * invite_code) and re-runs geocoding + need-scoring, since a changed ZIP or
 * household detail can change both the priority tier and which sites get
 * matched. This is a full replace of the editable fields rather than a
 * partial merge, EXCEPT for annual_income: since GET /:id above never
 * echoes it back, the resident's edit form can't pre-fill it, so leaving it
 * blank here means "no change" and keeps whatever is already on file rather
 * than being coerced to 0.
 */
router.patch('/:id', authorizeResident, async (req, res) => {
  const body = req.body || {};
  const incomeProvided = body.annual_income !== undefined && body.annual_income !== null && body.annual_income !== '';

  const errors = validateIntake({ ...body, annual_income: incomeProvided ? body.annual_income : 0 });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields', errors });
  }

  let place;
  try {
    place = await resolveZip(body.zip);
  } catch (err) {
    if (err instanceof ZipLookupError) {
      return res.status(err.status).json({ error: err.message, errors: { zip: err.message } });
    }
    throw err;
  }

  try {
    const { rows: existingRows } = await pool.query(
      'SELECT annual_income FROM residents WHERE id = $1',
      [req.params.id]
    );
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'Resident not found' });

    const intake = {
      age: Number(body.age),
      household_size: Number(body.household_size),
      children_under_5: body.children_under_5 === true,
      employment_status: body.employment_status,
      insurance_status: body.insurance_status,
      annual_income: incomeProvided ? Number(body.annual_income) : Number(existing.annual_income),
      lat: place.lat,
      lon: place.lon,
    };

    const score = scoreResident(intake);
    const region = resolveCounty(body.city ? String(body.city).trim() : place.city, place.state);

    const { rows } = await pool.query(
      `UPDATE residents SET
         full_name = $1, street_address = $2, city = $3, state = $4, zip = $5,
         location = ST_MakePoint($6, $7)::geography, region = $8,
         age = $9, household_size = $10, children_under_5 = $11,
         employment_status = $12, insurance_status = $13, annual_income = $14,
         fpl_pct = $15, need_score = $16, priority_tier = $17
       WHERE id = $18
       RETURNING id, registration_id, email, full_name, street_address, city, state, zip, region,
                 age, household_size, children_under_5,
                 employment_status, insurance_status, fpl_pct,
                 need_score, priority_tier, created_at`,
      [
        String(body.full_name).trim(),
        body.street_address ? String(body.street_address).trim() : null,
        body.city ? String(body.city).trim() : place.city,
        place.state,
        place.zip,
        place.lon,
        place.lat,
        region,
        intake.age,
        intake.household_size,
        intake.children_under_5,
        intake.employment_status,
        intake.insurance_status,
        intake.annual_income,
        score.fpl_pct,
        score.score,
        score.tier,
        req.params.id,
      ]
    );

    const r = rows[0];
    const { fpl_pct, ...safe } = r;
    res.json({
      resident: { ...safe, income_band: incomeBand(fpl_pct) },
      priority: { tier: score.tier, tier_label: score.tier_label, reasons: score.reasons },
    });
  } catch (err) {
    console.error('Resident update failed:', err.message);
    res.status(500).json({ error: 'Update failed. Please try again.' });
  }
});

/**
 * POST /api/residents/:id/check-in
 * Records the resident's own response to a wellness check-in ("I'm safe" /
 * "I need help"). The admin resident queue (GET /) surfaces the latest one.
 */
router.post('/:id/check-in', authorizeResident, async (req, res) => {
  const body = req.body || {};
  const status = body.status;
  if (!['ok', 'need_help'].includes(status)) {
    return res.status(400).json({ error: "status must be 'ok' or 'need_help'" });
  }
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  try {
    const { rows: residentRows } = await pool.query('SELECT id FROM residents WHERE id = $1', [req.params.id]);
    if (!residentRows[0]) return res.status(404).json({ error: 'Resident not found' });

    const { rows } = await pool.query(
      `INSERT INTO check_ins (resident_id, status, note)
       VALUES ($1, $2, $3)
       RETURNING id, status, note, responded_at`,
      [req.params.id, status, note]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record check-in' });
  }
});

/**
 * GET /api/residents/:id/check-ins
 * A resident's own check-in history, most recent first.
 */
router.get('/:id/check-ins', authorizeResident, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, status, note, responded_at FROM check_ins
       WHERE resident_id = $1
       ORDER BY responded_at DESC
       LIMIT 20`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch check-ins' });
  }
});

export default router;
