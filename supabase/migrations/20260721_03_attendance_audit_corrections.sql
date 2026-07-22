-- ============================================================================
-- Attendance audit trail + manager corrections.
--
-- Two rules the rest of this migration exists to enforce:
--
--   1. The event trail is IMMUTABLE. Attendance drives payroll, so "what the
--      system observed" must be answerable months later and must not be
--      rewritable by anyone — including an admin, including this app's own
--      code. Enforced by a trigger, not by convention.
--
--   2. A correction never destroys what it corrects. Manager edits are recorded
--      as their own rows carrying the ORIGINAL values, the new values, who,
--      when, and why. The timecard holds the effective record; the trail holds
--      how it got there.
-- ============================================================================

-- 1. Richer provenance on every event -----------------------------------------
-- `source` (manual/jobsite_auto/manager_adjusted) is too coarse to answer "did
-- this come from the phone in the background, or from a page load?", which is
-- exactly the question when an employee disputes a shift.
alter table public.jobsite_timecard_events
  add column if not exists event_source text,
  -- When the DEVICE says it happened, versus when the SERVER received it. The
  -- gap between them is the offline-queue delay, and it must stay visible.
  add column if not exists device_reported_at timestamptz,
  add column if not exists server_received_at timestamptz not null default now(),
  -- What the ingest pipeline decided about this event and why.
  add column if not exists validation_result text,
  add column if not exists validation_reason text,
  -- Set when the event was produced by a manager correction.
  add column if not exists correction_id uuid;

do $$ begin
  alter table public.jobsite_timecard_events
    add constraint jobsite_timecard_events_event_source_check
    check (event_source is null or event_source in (
      'native_geofence',           -- OS geofence transition, app backgrounded/closed
      'foreground_reconciliation', -- the app was open and repaired the state
      'scheduled_reconciliation',  -- the server-side scheduled pass
      'offline_sync',              -- flushed from the device's offline queue
      'employee_manual',           -- the employee's manual fallback
      'manager_correction'         -- a manager changed the record
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.jobsite_timecard_events
    add constraint jobsite_timecard_events_validation_result_check
    check (validation_result is null or validation_result in (
      'accepted', 'rejected', 'ignored', 'suppressed'
    ));
exception when duplicate_object then null; end $$;

-- Backfill provenance for existing rows from the coarse `source` column. Older
-- rows genuinely cannot be attributed more precisely than this.
update public.jobsite_timecard_events
set event_source = case
      when source = 'manual' then 'employee_manual'
      when source = 'manager_adjusted' then 'manager_correction'
      else 'native_geofence'
    end
where event_source is null;

update public.jobsite_timecard_events
set device_reported_at = coalesce(device_reported_at, occurred_at),
    server_received_at = coalesce(server_received_at, created_at, occurred_at)
where device_reported_at is null;

create index if not exists jobsite_timecard_events_source_idx
  on public.jobsite_timecard_events (company_id, event_source, occurred_at desc);

-- 2. Corrections --------------------------------------------------------------
create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Null only for a correction that CREATES a record (a missing clock-in for a
  -- day with no timecard at all).
  timecard_id uuid references public.jobsite_timecards(id) on delete set null,
  employee_id uuid,
  user_id uuid,
  correction_type text not null
    check (correction_type in (
      'missing_clock_in',
      'missing_clock_out',
      'incorrect_job',
      'incorrect_timestamp',
      'duplicate_record',
      'invalid_record'
    )),
  -- Required, and enforced here as well as in the API: a correction with no
  -- explanation is indistinguishable from tampering when read back later.
  reason text not null check (length(btrim(reason)) >= 10),
  -- The values as they were BEFORE this correction, and after. Both are kept
  -- forever; the original is never overwritten.
  original_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  corrected_by uuid not null,
  corrected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists attendance_corrections_company_idx
  on public.attendance_corrections (company_id, corrected_at desc);
create index if not exists attendance_corrections_timecard_idx
  on public.attendance_corrections (timecard_id, corrected_at desc);

-- Mark the effective record as corrected so the UI can show the current values
-- and the correction history as two distinct things.
alter table public.jobsite_timecards
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by uuid,
  add column if not exists correction_count integer not null default 0;

-- 3. Immutability -------------------------------------------------------------
-- The event trail is append-only. A trigger is the only place this can be
-- enforced against every writer, including the service-role client the
-- attendance runners use.
create or replace function public.jobsite_timecard_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'jobsite_timecard_events is append-only: % is not permitted. Record a correction instead.', tg_op;
end $$;

drop trigger if exists jobsite_timecard_events_no_update on public.jobsite_timecard_events;
create trigger jobsite_timecard_events_no_update
  before update on public.jobsite_timecard_events
  for each row execute function public.jobsite_timecard_events_append_only();

drop trigger if exists jobsite_timecard_events_no_delete on public.jobsite_timecard_events;
create trigger jobsite_timecard_events_no_delete
  before delete on public.jobsite_timecard_events
  for each row execute function public.jobsite_timecard_events_append_only();

-- Corrections are equally immutable: a correction that was itself wrong is
-- superseded by ANOTHER correction, never edited away.
create or replace function public.attendance_corrections_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'attendance_corrections is append-only: % is not permitted. Record a superseding correction instead.', tg_op;
end $$;

drop trigger if exists attendance_corrections_no_update on public.attendance_corrections;
create trigger attendance_corrections_no_update
  before update on public.attendance_corrections
  for each row execute function public.attendance_corrections_append_only();

drop trigger if exists attendance_corrections_no_delete on public.attendance_corrections;
create trigger attendance_corrections_no_delete
  before delete on public.attendance_corrections
  for each row execute function public.attendance_corrections_append_only();

-- NOTE: `on delete cascade` from companies still removes rows when a whole
-- tenant is deleted — the triggers above fire on direct DELETE, and a cascade
-- from a company teardown is a deliberate, separate operation.

-- 4. RLS ----------------------------------------------------------------------
-- Company isolation for reads; writes go through the API (service role), which
-- enforces the manager role. Defense in depth, not the only check.
alter table public.attendance_corrections enable row level security;

drop policy if exists attendance_corrections_company_read on public.attendance_corrections;
create policy attendance_corrections_company_read on public.attendance_corrections
  for select to authenticated
  using (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()));

-- Deliberately NO insert/update/delete policy for authenticated users: an
-- employee must never be able to write their own correction.
