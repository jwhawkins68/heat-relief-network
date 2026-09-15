-- Real relief-site seed data for the pilot area (Houston, Dallas, Fort
-- Worth, Austin, San Antonio) — matches the Texas pilot areas in
-- seed_areas.sql.
--
-- Sites are real, publicly documented locations (public library branches
-- that serve as official cooling centers, city recreation/community
-- centers, and public parks) — names, addresses and coordinates verified
-- against each city's library/parks department site and the Census
-- Bureau geocoder. `status` is deliberately seeded as 'unknown' and
-- `hours_text` left blank — this app's own design has an org admin set
-- real status via "Update Site Open/Closed Status" rather than us
-- guessing it.
--
-- No "community_center" type exists in the schema's CHECK constraint —
-- per team decision, community/recreation centers are seeded as
-- 'cooling_center' (most double as designated cooling centers in
-- practice).
--
-- Run with:
--   psql $DATABASE_URL -f src/db/seed_sites.sql

-- ── Demo organization (paste this UUID into the admin portal's
--    "Organization ID" field to load these sites) ──
INSERT INTO orgs (id, name, type, contact_email, contact_phone)
VALUES (
  'c1335a41-dc02-4d0f-8a29-f1398bd955df',
  'Texas Heat Relief Network',
  'government',
  'heatrelief@texasheatrelief.org',
  NULL
);

-- ── Sites ──
INSERT INTO sites (org_id, name, type, address, location, status)
VALUES
  -- Houston (Harris County)
  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Sunnyside Community Center & Park', 'cooling_center',
   '3502 Bellfort Ave, Houston, TX 77051',
   ST_MakePoint(-95.371847, 29.669321)::geography, 'unknown'),

  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Park Place Regional Library', 'cooling_center',
   '8145 Park Pl, Houston, TX 77017',
   ST_MakePoint(-95.274892, 29.687567)::geography, 'unknown'),

  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Young Neighborhood Library', 'cooling_center',
   '5107 Griggs Rd, Houston, TX 77021',
   ST_MakePoint(-95.338475, 29.698517)::geography, 'unknown'),

  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'MacGregor Park', 'splash_pad',
   '5225 Calhoun Rd, Houston, TX 77021',
   ST_MakePoint(-95.341630, 29.710702)::geography, 'unknown'),

  -- Dallas (Dallas County)
  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Martin Luther King Jr. Branch Library', 'cooling_center',
   '2922 Martin Luther King Jr Blvd, Dallas, TX 75215',
   ST_MakePoint(-96.766835, 32.770411)::geography, 'unknown'),

  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Fair Park', 'water_station',
   '3809 Grand Ave, Dallas, TX 75210',
   ST_MakePoint(-96.761973, 32.779635)::geography, 'unknown'),

  -- Fort Worth (Tarrant County)
  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Ella Mae Shamblee Library', 'cooling_center',
   '1062 Evans Ave, Fort Worth, TX 76104',
   ST_MakePoint(-97.318374, 32.733204)::geography, 'unknown'),

  -- Austin (Travis County)
  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Southeast Branch Library', 'cooling_center',
   '5803 Nuckols Crossing Rd, Austin, TX 78744',
   ST_MakePoint(-97.742174, 30.187922)::geography, 'unknown'),

  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Dottie Jordan Recreation Center', 'cooling_center',
   '2803 Loyola Ln, Austin, TX 78723',
   ST_MakePoint(-97.674011, 30.314870)::geography, 'unknown'),

  -- San Antonio (Bexar County)
  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'BiblioTech West', 'cooling_center',
   '2003 S Zarzamora St, San Antonio, TX 78207',
   ST_MakePoint(-98.530072, 29.404375)::geography, 'unknown'),

  ('c1335a41-dc02-4d0f-8a29-f1398bd955df',
   'Concepcion Park', 'shade',
   '600 E Theo Ave, San Antonio, TX 78210',
   ST_MakePoint(-98.498765, 29.387860)::geography, 'unknown');

-- After seeding, verify with:
--   SELECT name, type, status FROM sites ORDER BY name;
--   curl "http://localhost:4000/api/sites" | jq
-- Then re-run the priority-area recompute so "nearest open site" reflects
-- these new sites once an admin marks some 'open':
--   npm run recompute-risk
