-- Heat Relief Network — Database Schema
-- Postgres + PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────────
-- Organizations (nonprofits, city agencies, volunteer groups)
-- ─────────────────────────────────────────────
CREATE TABLE orgs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('nonprofit', 'government', 'volunteer_group')),
  contact_email TEXT,
  contact_phone TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- Sites (cooling centers, water stations, shade, splash pads)
-- ─────────────────────────────────────────────
CREATE TABLE sites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID REFERENCES orgs(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('cooling_center', 'water_station', 'shade', 'splash_pad')),
  address           TEXT NOT NULL,
  location          GEOGRAPHY(POINT, 4326) NOT NULL, -- lon/lat
  hours_text        TEXT,               -- human-readable hours, e.g. "Mon–Fri 9am–6pm"
  capacity          INTEGER,            -- null = not tracked
  languages         TEXT[] DEFAULT '{}',
  accessibility     TEXT[] DEFAULT '{}', -- e.g. {'wheelchair_accessible','transit_adjacent'}
  status            TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('open', 'closed', 'full', 'unknown')),
  status_updated_at TIMESTAMPTZ,
  status_updated_by UUID,               -- references a user/org contact who made the update
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sites_location_idx ON sites USING GIST (location);

-- ─────────────────────────────────────────────
-- Inventory (per-site stock of water/ice/fans etc.)
-- ─────────────────────────────────────────────
CREATE TABLE inventory_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item         TEXT NOT NULL CHECK (item IN ('water', 'ice', 'fans', 'masks', 'other')),
  level        TEXT NOT NULL CHECK (level IN ('plenty', 'low', 'out')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID
);

-- ─────────────────────────────────────────────
-- Volunteers
-- ─────────────────────────────────────────────
CREATE TABLE volunteers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  skills       TEXT[] DEFAULT '{}',
  home_location GEOGRAPHY(POINT, 4326),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE volunteer_shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id  UUID NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled'))
);

-- ─────────────────────────────────────────────
-- Alerts (heat advisories per region)
-- ─────────────────────────────────────────────
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region          TEXT NOT NULL,          -- e.g. NWS zone or city name
  severity        TEXT NOT NULL CHECK (severity IN ('advisory', 'warning', 'emergency')),
  message         TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'NWS',
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- Residents (optional accounts — anonymous use is supported at the app layer)
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone                 TEXT UNIQUE,       -- primary channel for SMS-first users
  email                 TEXT UNIQUE,
  preferred_language    TEXT DEFAULT 'en',
  notify_region         TEXT,              -- opt-in region for alerts
  notify_sms            BOOLEAN DEFAULT false,
  notify_push           BOOLEAN DEFAULT false,
  notify_email          BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Example query the AI agent's search_sites tool would run:
-- Find open sites within 5km of a point, ordered by distance
--
-- SELECT id, name, type, address, status,
--        ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m
-- FROM sites
-- WHERE status = 'open'
--   AND ST_DWithin(location, ST_MakePoint($1, $2)::geography, 5000)
-- ORDER BY distance_m ASC;
