-- Heat Relief Network — Priority Access & Resident Matching (SCRUM-29)
-- Additive migration. Safe to run against an existing database.
--
-- PRIVACY NOTE: the residents table holds the most sensitive data in this
-- system — home location, income, and insurance status together. Two rules
-- follow from that and are enforced in the application layer:
--   1. annual_income is never returned by any list endpoint (GET /api/residents
--      returns a coarse band derived from fpl_pct instead).
--   2. Request bodies for registration are never written to application logs.
-- Retention position: intake records are kept for the duration of the pilot
-- and deleted at its conclusion; there is no production retention policy yet
-- because there is no production deployment yet. See docs/NEED-SCORING.md.

-- ─────────────────────────────────────────────
-- Invites — single-use codes issued by partner orgs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invites (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    TEXT NOT NULL UNIQUE,
  issued_by_org_id        UUID REFERENCES orgs(id) ON DELETE SET NULL,
  issued_to_label         TEXT,            -- e.g. "Sunnyside clinic walk-ins"
  status                  TEXT NOT NULL DEFAULT 'unused'
                            CHECK (status IN ('unused', 'redeemed', 'revoked')),
  expires_at              TIMESTAMPTZ NOT NULL,
  redeemed_by_resident_id UUID,            -- FK added below (circular reference)
  redeemed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invites_code_idx ON invites (code);
CREATE INDEX IF NOT EXISTS invites_org_idx  ON invites (issued_by_org_id);

-- ─────────────────────────────────────────────
-- Residents — intake answers + derived priority
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS residents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name         TEXT NOT NULL,
  street_address    TEXT,
  city              TEXT,
  state             TEXT,
  zip               TEXT NOT NULL,
  location          GEOGRAPHY(POINT, 4326) NOT NULL,  -- lon/lat, from the ZIP

  -- Intake answers
  age               INTEGER NOT NULL CHECK (age >= 0 AND age <= 120),
  household_size    INTEGER NOT NULL CHECK (household_size >= 1 AND household_size <= 20),
  children_under_5  BOOLEAN NOT NULL DEFAULT FALSE,
  employment_status TEXT NOT NULL CHECK (employment_status IN (
                      'outdoor_worker', 'unemployed', 'unable_to_work',
                      'retired', 'part_time', 'student', 'full_time_indoor')),
  insurance_status  TEXT NOT NULL CHECK (insurance_status IN (
                      'personal', 'government_assistance', 'none')),
  annual_income     NUMERIC(12,2) NOT NULL CHECK (annual_income >= 0),

  -- Derived by services/needScore.js, stored so the queue can sort without
  -- recomputing and so a score can be audited against the rubric of the day.
  fpl_pct           INTEGER,
  need_score        INTEGER NOT NULL CHECK (need_score >= 0 AND need_score <= 100),
  priority_tier     SMALLINT NOT NULL CHECK (priority_tier IN (1, 2, 3)),

  invite_id         UUID REFERENCES invites(id) ON DELETE SET NULL,
  consent_given_at  TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS residents_location_idx ON residents USING GIST (location);
CREATE INDEX IF NOT EXISTS residents_priority_idx ON residents (need_score DESC);
CREATE INDEX IF NOT EXISTS residents_city_idx     ON residents (city);

-- Close the circular reference now that both tables exist.
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_redeemed_by_resident_fk;
ALTER TABLE invites ADD CONSTRAINT invites_redeemed_by_resident_fk
  FOREIGN KEY (redeemed_by_resident_id) REFERENCES residents(id) ON DELETE SET NULL;
