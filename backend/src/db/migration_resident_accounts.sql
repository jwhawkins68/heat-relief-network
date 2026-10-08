-- HeatSafe — Resident accounts, Registration IDs and email notifications
-- Additive migration. Safe to run more than once against an existing database.
--
-- Run with:
--   cd ~/heat-relief-network
--   set -a && source backend/.env && set +a
--   psql "$DATABASE_URL" -f backend/src/db/migration_resident_accounts.sql
-- Then restart the backend.
--
-- What it adds:
--   residents.email            login + notification address. Unique ignoring
--                              case, so "Ann@x.com" and "ann@x.com" are the
--                              same person. Nullable ONLY so residents who
--                              registered before accounts existed stay valid;
--                              the API requires it for every new registration.
--   residents.password_hash    scrypt hash (services/passwords.js). Never the
--                              password itself, never returned by any route.
--   residents.registration_id  human-readable ID, e.g. HS-7KQ2-M9XD. Safe to
--                              read aloud or print; unlike the UUID it grants
--                              no access to anything on its own.
--   residents.notify_email     resident's opt-in/out for alert emails.
--   resident_sessions          login sessions. Only a SHA-256 of each token is
--                              stored, so a database leak can't be replayed as
--                              logins.
--   notification_log           one row per email sent; also what stops the
--                              same alert being emailed to someone twice.
--   password_resets            one-hour, single-use reset links (hashed, like
--                              sessions).

ALTER TABLE residents ADD COLUMN IF NOT EXISTS email           TEXT;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS password_hash   TEXT;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS registration_id TEXT;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS notify_email    BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS residents_email_unique
  ON residents (lower(email)) WHERE email IS NOT NULL;

-- ── Backfill Registration IDs for everyone already registered ─────────────
-- Same alphabet as invite codes: no 0/O or 1/I, so an ID can be read over the
-- phone without being misheard. Format HS-XXXX-XXXX.
CREATE OR REPLACE FUNCTION pg_temp.heatsafe_registration_id() RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := 'HS-';
BEGIN
  FOR i IN 1..8 LOOP
    IF i = 5 THEN result := result || '-'; END IF;
    result := result || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

UPDATE residents
   SET registration_id = pg_temp.heatsafe_registration_id()
 WHERE registration_id IS NULL;

ALTER TABLE residents ALTER COLUMN registration_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS residents_registration_id_unique
  ON residents (registration_id);

-- ── Login sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resident_sessions (
  token_hash   TEXT PRIMARY KEY,                -- sha256 hex of the bearer token
  resident_id  UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS resident_sessions_resident_idx ON resident_sessions (resident_id);

-- ── Email notification log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id  UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  alert_id     UUID REFERENCES alerts(id) ON DELETE CASCADE,  -- null for welcome emails
  kind         TEXT NOT NULL CHECK (kind IN ('welcome', 'alert')),
  channel      TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  preview_url  TEXT,                            -- Ethereal test-inbox link, when used
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_once_per_alert
  ON notification_log (resident_id, alert_id, channel) WHERE alert_id IS NOT NULL;

-- ── Password reset links ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash   TEXT PRIMARY KEY,                -- sha256 hex of the emailed token
  resident_id  UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_resident_idx ON password_resets (resident_id);

-- Verify:
--   SELECT registration_id, email IS NOT NULL AS has_email FROM residents;
