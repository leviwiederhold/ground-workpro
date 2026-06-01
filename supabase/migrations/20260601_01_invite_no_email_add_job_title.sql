-- Refactor employee invites: admin no longer supplies the employee's email or
-- personal info at creation time. Email + name are collected from the employee
-- when they accept. Add job_title carried on the invite.

-- 1. Email becomes optional (collected at acceptance, not creation).
alter table public.pending_invitations
  alter column email drop not null;

-- 2. Drop the "@" email-format check (email may now be null at creation).
alter table public.pending_invitations
  drop constraint if exists pending_invitations_email_check;

-- 3. Drop the active (company_id, lower(email)) unique index — multiple pending
--    invites with no email must be allowed. (NULL emails wouldn't collide, but
--    the index served the old email-per-company model that no longer applies.)
drop index if exists public.pending_invitations_company_email_active_idx;

-- 4. Carry the job title on the invite so it can be applied to the employee
--    profile on acceptance.
alter table public.pending_invitations
  add column if not exists job_title text;

-- 5. Employees: ensure a job_title column exists to receive the invite value.
alter table public.employees
  add column if not exists job_title text;
