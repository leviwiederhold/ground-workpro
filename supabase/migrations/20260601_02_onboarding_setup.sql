-- First-login setup wizard support.
-- Authoritative completion flags + the few fields not already present.

-- Per-user setup completion (authoritative "wizard finished" flag).
alter table public.profiles
  add column if not exists setup_completed_at timestamptz;

-- Optional preferred landing page chosen during account-settings step.
alter table public.profiles
  add column if not exists landing_page text;

-- Company-level setup completion (set when an owner/admin finishes the wizard).
alter table public.companies
  add column if not exists setup_completed_at timestamptz;

-- Employee emergency contact collected in the employee work-profile step.
alter table public.employees
  add column if not exists emergency_contact text;

-- (first_name / last_name intentionally NOT added — the app uses profiles.full_name;
--  the wizard composes full_name from first + last. phone, job_title, avatar_url,
--  timezone, notification_preferences, company name/timezone/phone/address all
--  already exist.)
