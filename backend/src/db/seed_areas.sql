-- Example seed data for the `areas` table (risk-scoring feature).
-- Manual/example data for demo purposes — same spirit as manually seeding
-- 10-20 real `sites` for a pilot area (see root README). Replace with real
-- Census ACS / local heat-vulnerability-index data before relying on this
-- for anything beyond a demo.
--
-- Run with:
--   psql $DATABASE_URL -f src/db/seed_areas.sql

INSERT INTO areas (name, region, centroid, population, pct_elderly, pct_low_income, pct_no_ac, heat_index_f)
VALUES
  ('90011 - South LA', 'Los Angeles County', ST_MakePoint(-118.2584, 34.0072)::geography,
   45000, 11, 38, 42, 108),

  ('90065 - Glassell Park', 'Los Angeles County', ST_MakePoint(-118.2378, 34.1097)::geography,
   22000, 14, 22, 25, 101),

  ('90210 - Beverly Hills', 'Los Angeles County', ST_MakePoint(-118.4004, 34.0901)::geography,
   21000, 22, 4, 3, 99),

  ('91331 - Pacoima', 'Los Angeles County', ST_MakePoint(-118.4108, 34.2589)::geography,
   58000, 9, 33, 35, 112),

  ('90033 - Boyle Heights', 'Los Angeles County', ST_MakePoint(-118.2087, 34.0407)::geography,
   39000, 17, 41, 30, 105);

-- After seeding, compute initial scores with:
--   npm run recompute-risk
