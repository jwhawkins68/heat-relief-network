-- Heat-vulnerability areas for the Heat Relief Network service region.
--
-- Region: Texas — Harris, Dallas, Tarrant, Travis and Bexar counties.
-- `region` is always a COUNTY name (never a city) — it is the key the alerts
-- and priority-area filters match on. See CLAUDE.md "Region = county".
--
-- DATA PROVENANCE
--   population, pct_elderly, pct_low_income — U.S. Census Bureau ACS 5-year
--     estimates, keyed by ZCTA. Refresh with the ACS pull documented in
--     docs/DATA-SOURCES.md.
--   heat_index_f — provisional until the live NWS integration (SCRUM-23-25)
--     replaces it.
--   pct_no_ac — no free authoritative source exists at this geography. Seeded
--     low across Texas because central AC is near-universal in TX housing; the
--     real vulnerability drivers here are poverty and elderly population.
--     This gap is documented rather than fabricated.
--
-- Run with:
--   psql $DATABASE_URL -f src/db/seed_areas.sql
-- Then compute scores (REQUIRED — the ranking is meaningless without it):
--   npm run recompute-risk

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
