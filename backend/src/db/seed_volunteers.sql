-- HeatSafe — demo volunteers and scheduled shifts (SCRUM-40)
--
-- Gives the Outreach Dispatch Planner something real to plan against.
-- Re-runnable: existing volunteers (matched by email) are left alone.
--
-- DELIBERATE GAP: shifts cover Houston, Dallas, San Antonio and Fort Worth but
-- NOT East Austin. That is not an oversight — it is how you see the agent's
-- coverage-gap output do its job.

INSERT INTO volunteers (name, email, phone, skills, home_location)
SELECT v.name, v.email, v.phone, v.skills::text[], ST_MakePoint(v.lon, v.lat)::geography
FROM (VALUES
  ('Marcus Bell',   'marcus.bell@example.org',   '713-555-0142', ARRAY['wellness_check','spanish'], -95.371847, 29.669321),
  ('Alicia Romero', 'alicia.romero@example.org', '214-555-0188', ARRAY['wellness_check','driver'],  -96.766835, 32.770411),
  ('Dennis Okafor', 'dennis.okafor@example.org', '210-555-0119', ARRAY['first_aid','driver'],       -98.530072, 29.404375),
  ('Priya Raman',   'priya.raman@example.org',   '817-555-0176', ARRAY['wellness_check'],           -97.318374, 32.733204)
) AS v(name, email, phone, skills, lon, lat)
WHERE NOT EXISTS (SELECT 1 FROM volunteers x WHERE x.email = v.email);

-- Shifts across the next 12 hours, anchored to real seeded sites.
INSERT INTO volunteer_shifts (volunteer_id, site_id, start_time, end_time, status)
SELECT vol.id, site.id, now() + (d.offset_h || ' hours')::interval,
       now() + ((d.offset_h + 4) || ' hours')::interval, 'scheduled'
FROM (VALUES
  ('marcus.bell@example.org',   'Sunnyside Community Center & Park',     1),
  ('alicia.romero@example.org', 'Martin Luther King Jr. Branch Library', 2),
  ('dennis.okafor@example.org', 'BiblioTech West',                       1),
  ('priya.raman@example.org',   'Ella Mae Shamblee Library',             3)
) AS d(email, site_name, offset_h)
JOIN volunteers vol ON vol.email = d.email
JOIN sites site     ON site.name = d.site_name
WHERE NOT EXISTS (
  SELECT 1 FROM volunteer_shifts vs
   WHERE vs.volunteer_id = vol.id AND vs.site_id = site.id AND vs.status = 'scheduled'
);
