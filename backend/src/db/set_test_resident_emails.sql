-- HeatSafe — give the five pilot test residents an email address
-- (firstname.lastname@example.com). Added 2026-09-30.
--
-- Run with:
--   cd ~/heat-relief-network
--   set -a && source backend/.env && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/set_test_resident_emails.sql
--
-- Safe to re-run: it only fills in residents whose email is still empty, so
-- it never overwrites an address someone has set. example.com is a reserved
-- test domain — nothing sent to these addresses reaches a real person.
--
-- This sets EMAIL ONLY, not a password, so these residents still can't log
-- in until a password is set (see the note printed at the end).

BEGIN;

WITH wanted(full_name, email) AS (
  VALUES
    ('Test Resident', 'test.resident@example.com'),
    ('James Hawkins', 'james.hawkins@example.com'),
    ('John Beamen',   'john.beamen@example.com'),
    ('Maria Torres',  'maria.torres@example.com'),
    ('John Johnson',  'john.johnson@example.com')
)
UPDATE residents r
   SET email = w.email
  FROM wanted w
 WHERE lower(trim(r.full_name)) = lower(w.full_name)
   AND r.email IS NULL
RETURNING r.registration_id, r.full_name, r.email;

COMMIT;

-- Confirm: every resident, with or without an email.
SELECT registration_id, full_name, email,
       CASE WHEN password_hash IS NULL THEN 'no password yet' ELSE 'can log in' END AS login
  FROM residents
 ORDER BY full_name;
