import { Router } from 'express';
import pool from '../db/pool.js';
import { scoreResident, incomeBand } from '../services/needScore.js';
import { matchServices } from '../services/serviceMatch.js';
import { resolveZip, ZipLookupError } from '../services/zipLookup.js';

const router = Router();

const EMPLOYMENT_STATUSES = [
  'outdoor_worker', 'unemployed', 'unable_to_work',
  'retired', 'part_time', 'student', 'full_time_indoor',
];
const INSURANCE_STATUSES = ['personal', 'government_assistance', 'none'];

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

  const errors = validateIntake(body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields', errors });
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

    const { rows: residentRows } = await client.query(
      `INSERT INTO residents (
         full_name, street_address, city, state, zip, location,
         age, household_size, children_under_5,
         employment_status, insurance_status, annual_income,
         fpl_pct, need_score, priority_tier,
         invite_id, consent_given_at
       ) VALUES (
         $1, $2, $3, $4, $5, ST_MakePoint($6, $7)::geography,
         $8, $9, $10,
         $11, $12, $13,
         $14, $15, $16,
         $17, now()
       )
       RETURNING id, full_name, city, zip, need_score, priority_tier, created_at`,
      [
        String(body.full_name).trim(),
        body.street_address ? String(body.street_address).trim() : null,
        body.city ? String(body.city).trim() : place.city,
        place.state,
        place.zip,
        place.lon,
        place.lat,
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
      ]
    );

    const resident = residentRows[0];

    await client.query(
      `UPDATE invites SET status = 'redeemed', redeemed_by_resident_id = $1, redeemed_at = now()
       WHERE id = $2`,
      [resident.id, invite.id]
    );

    await client.query('COMMIT');

    // Matching runs after commit — it only reads sites, and a site-lookup
    // hiccup shouldn't undo a valid registration.
    const match = await matchServices(intake, score);

    // NOTE: the raw income figure is deliberately absent from this response.
    res.status(201).json({
      resident: {
        id: resident.id,
        full_name: resident.full_name,
        city: resident.city,
        zip: resident.zip,
      },
      priority: {
        tier: score.tier,
        tier_label: score.tier_label,
        reasons: score.reasons,
      },
      ...match,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Log the error but never the request body — it contains income and
    // insurance status.
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
router.get('/', async (req, res) => {
  const { tier, city } = req.query;
  const conditions = [];
  const values = [];
  let i = 1;

  if (tier) {
    conditions.push(`priority_tier = $${i++}`);
    values.push(Number(tier));
  }
  if (city) {
    conditions.push(`city ILIKE $${i++}`);
    values.push(city);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, city, zip, age, household_size, children_under_5,
              employment_status, insurance_status, fpl_pct,
              need_score, priority_tier, created_at
       FROM residents
       ${where}
       ORDER BY need_score DESC, created_at ASC
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
router.get('/:id/match', async (req, res) => {
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

export default router;
