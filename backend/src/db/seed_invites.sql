-- Heat Relief Network — demo invite codes (SCRUM-30)
-- Three unused codes against the Texas Heat Relief Network demo org so the
-- registration flow is demoable without clicking through the admin UI first.
-- Re-runnable: existing codes are left alone.

INSERT INTO invites (code, issued_by_org_id, issued_to_label, expires_at)
SELECT v.code, o.id, v.label, now() + interval '30 days'
FROM (VALUES
  ('HEAT2026', 'Sunnyside community outreach'),
  ('COOLTX24', 'Dallas Fair Park clinic referrals'),
  ('RELIEF99', 'Demo code for Sprint review')
) AS v(code, label)
CROSS JOIN (SELECT id FROM orgs WHERE name = 'Texas Heat Relief Network' LIMIT 1) o
WHERE NOT EXISTS (SELECT 1 FROM invites i WHERE i.code = v.code);
