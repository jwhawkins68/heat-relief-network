-- HeatSafe — Resident self-service (Checkpoint plan items A-D)
-- Additive migration. Safe to run against an existing database.
--
-- Run with:
--   psql $DATABASE_URL -f backend/src/db/migration_resident_self_service.sql
-- Then restart the backend (double-click "Restart HeatSafe" on the Desktop) —
-- nothing here needs a server restart on its own, but do it anyway if you
-- also touched backend/.env in the same sitting.

-- A resident's own county, derived at registration/update time from the
-- pilot's known city->county mapping (backend/src/services/countyLookup.js).
-- Nullable: outside the five pilot metros this stays null and the
-- resident-facing pages fall back to asking for a county by hand, same as
-- today, rather than guessing wrong.
ALTER TABLE residents ADD COLUMN IF NOT EXISTS region TEXT;

-- Wellness check-in responses ("respond to a wellness check-in" feature).
-- One row per response; the admin resident queue shows only the most recent
-- one per resident (see the LEFT JOIN LATERAL in routes/residents.js).
CREATE TABLE IF NOT EXISTS check_ins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id   UUID NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('ok', 'need_help')),
  note          TEXT,
  responded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS check_ins_resident_idx ON check_ins (resident_id, responded_at DESC);
