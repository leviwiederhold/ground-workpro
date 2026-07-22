-- Attendance records become server-write-only.
--
-- jobsite_timecards and jobsite_timecard_events were created in
-- 20260602_01_jobsite_time.sql with `for all to authenticated`, scoped by
-- company but with no role predicate. That let any signed-in employee insert,
-- update, or delete any timecard in their company directly with the anon key,
-- and insert forged rows into the audit trail. The append-only triggers added in
-- 20260721_03 block UPDATE and DELETE on the event table, but not INSERT.
--
-- Every attendance table added since June is already server-only:
--   device_attendance_credentials  RLS on, no policy   (20260720_05)
--   attendance_event_audit         RLS on, no policy   (20260720_05)
--   attendance_scheduler_runs      RLS on, no policy   (20260721_01)
--   attendance_corrections         for select only     (20260721_03)
-- This brings the two originals in line with them.
--
-- SELECT is retained rather than removed: the read paths legitimately use the
-- caller's session client, and the API narrows employees to their own rows on
-- top of the company predicate below. Writes now come only from the service-role
-- client, which bypasses RLS — no policy is added for it, because adding one
-- would imply these policies constrain it.

-- jobsite_timecards ----------------------------------------------------------
drop policy if exists jobsite_timecards_company_members on public.jobsite_timecards;
create policy jobsite_timecards_company_read on public.jobsite_timecards
  for select to authenticated
  using (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()));

-- jobsite_timecard_events ----------------------------------------------------
drop policy if exists jobsite_timecard_events_company_members on public.jobsite_timecard_events;
create policy jobsite_timecard_events_company_read on public.jobsite_timecard_events
  for select to authenticated
  using (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()));

-- RLS is already enabled on both tables (20260602_01). Restated so this
-- migration is safe to apply against a database where it was ever turned off.
alter table public.jobsite_timecards enable row level security;
alter table public.jobsite_timecard_events enable row level security;
