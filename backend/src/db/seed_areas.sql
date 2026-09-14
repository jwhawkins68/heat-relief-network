-- Example seed data for the `areas` table (risk-scoring feature).
-- Manual/example data for demo purposes — same spirit as manually seeding
-- 10-20 real `sites` for a pilot area (see root README). Replace with real
-- Census ACS / local heat-vulnerability-index data before relying on this
-- for anything beyond a demo.
--
-- Pilot area: Texas (Houston, Dallas, Fort Worth, Austin, San Antonio) —
-- replaces the earlier Los Angeles County placeholder pilot areas so the
-- demo matches the project's actual target region. pct_no_ac is seeded low
-- across the board (unlike the old LA numbers) because central AC is
-- near-universal in Texas housing — the real heat-vulnerability driver
-- here is poverty/elderly population more than AC access.
--
-- Run with:
--   psql $DATABASE_URL -f src/db/seed_areas.sql

INSERT INTO areas (name, region, centroid, population, pct_elderly, pct_low_income, pct_no_ac, heat_index_f)
VALUES
  ('77051 - Sunnyside (Houston)', 'Harris County', ST_MakePoint(-95.371847, 29.669321)::geography,
   29000, 13, 35, 8, 109),

  ('75215 - South Dallas / Fair Park', 'Dallas County', ST_MakePoint(-96.766835, 32.770411)::geography,
   15000, 15, 40, 9, 107),

  ('76104 - Near Southeast (Fort Worth)', 'Tarrant County', ST_MakePoint(-97.318374, 32.733204)::geography,
   24000, 12, 38, 10, 106),

  ('78724 - East Austin', 'Travis County', ST_MakePoint(-97.674011, 30.314870)::geography,
   20000, 10, 28, 6, 104),

  ('78207 - West Side (San Antonio)', 'Bexar County', ST_MakePoint(-98.530072, 29.404375)::geography,
   28000, 16, 42, 9, 105);

-- After seeding, compute initial scores with:
--   npm run recompute-risk
