-- ============================================================================
-- Automatic arrival + scheduled clock-in.
--
-- Adds the schema needed to (a) hold an early arrival as "onsite before shift"
-- instead of clocking in immediately, (b) create the clock-in at the scheduled
-- start from a SERVER-SIDE scheduled process (no app/WebView timer required),
-- and (c) audit every decision the pipeline makes.
--
-- Duplicate protection is enforced at the DATABASE level, not just in code:
-- there can be at most one OPEN timecard per (company, user, job, work_date),
-- and at most one scheduled-clock-in audit row per timecard.
-- ============================================================================

-- 1. New audit event types ---------------------------------------------------
-- The pipeline now distinguishes WHY a clock-in happened (or did not).
do $$ begin
  alter table public.jobsite_timecard_events
    drop constraint if exists jobsite_timecard_events_event_type_check;
end $$;

alter table public.jobsite_timecard_events
  add constraint jobsite_timecard_events_event_type_check
  check (event_type in (
    'entered_geofence','exited_geofence','auto_clock_in','auto_clock_out',
    'break_suggested','manager_edited','approved','rejected',
    -- Automatic arrival / scheduled clock-in (this migration):
    'onsite_before_shift',   -- arrived and confirmed onsite before scheduled start
    'scheduled_clock_in',    -- clock-in created at the scheduled start
    'clock_in_backfilled',   -- scheduled processing ran late; clock-in backdated
    'clock_in_rejected',     -- clock-in refused (e.g. open elsewhere, left early)
    'duplicate_suppressed'   -- a second writer lost the race; no record created
  ));

-- 2. Track the "onsite before shift" stamp once per timecard ------------------
-- Without this the hold state would re-log its audit event on every pass of the
-- reconciliation loop.
alter table public.jobsite_timecards
  add column if not exists onsite_before_shift_at timestamptz,
  -- Which mechanism produced clock_in_at. Distinguishes an arrival-time clock-in
  -- from one created by the scheduled process (and whether it was backfilled).
  add column if not exists clock_in_method text;

do $$ begin
  alter table public.jobsite_timecards
    add constraint jobsite_timecards_clock_in_method_check
    check (clock_in_method is null or clock_in_method in (
      'arrival', 'scheduled_start', 'scheduled_start_backfilled', 'manual', 'manager'
    ));
exception when duplicate_object then null; end $$;

-- 3. Database-level duplicate protection -------------------------------------
-- At most one OPEN (not clocked out) timecard per employee/job/day. A repeat
-- session on the same day is only ever created after the previous one is
-- closed, so this cannot block legitimate re-entry — but it does make a
-- duplicate clock-in from a native event racing the scheduler impossible.
--
-- Built CONCURRENTLY is not possible inside a migration transaction; these
-- tables are small (one row per employee-day) so a plain index is fine.
do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select company_id, user_id, job_id, work_date
    from public.jobsite_timecards
    where clock_out_at is null
    group by 1, 2, 3, 4
    having count(*) > 1
  ) dupes;

  if duplicate_count > 0 then
    -- Pre-existing duplicates would make the unique index creation fail. Close
    -- the older rows (keeping the newest open) so the constraint can apply.
    update public.jobsite_timecards t
    set clock_out_at = coalesce(t.clock_out_at, t.detected_departure_at, t.clock_in_at, t.updated_at),
        notes = concat_ws(' ', t.notes, '[auto-closed: duplicate open timecard]')
    where t.clock_out_at is null
      and exists (
        select 1 from public.jobsite_timecards n
        where n.company_id = t.company_id
          and n.user_id is not distinct from t.user_id
          and n.job_id is not distinct from t.job_id
          and n.work_date is not distinct from t.work_date
          and n.clock_out_at is null
          and n.created_at > t.created_at
      );
  end if;
end $$;

create unique index if not exists jobsite_timecards_open_unique_idx
  on public.jobsite_timecards (company_id, user_id, job_id, work_date)
  where clock_out_at is null;

-- One scheduled-clock-in audit row per timecard, even if two workers race.
create unique index if not exists jobsite_timecard_events_scheduled_clock_in_uidx
  on public.jobsite_timecard_events (timecard_id)
  where event_type = 'scheduled_clock_in';

-- 4. Candidate lookup index for the scheduled process ------------------------
-- The scheduler scans for "arrived, not yet clocked in" rows across companies.
create index if not exists jobsite_timecards_pending_arrival_idx
  on public.jobsite_timecards (work_date, company_id)
  where clock_in_at is null and clock_out_at is null and pending_arrival_at is not null;

-- 5. Scheduled-run audit ------------------------------------------------------
-- Records each pass of the server-side scheduled reconciliation so a missed or
-- delayed run is visible (and so backfills can be explained after the fact).
create table if not exists public.attendance_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'cron',
  candidates integer not null default 0,
  clocked_in integer not null default 0,
  backfilled integer not null default 0,
  rejected integer not null default 0,
  suppressed integer not null default 0,
  waiting integer not null default 0,
  error text
);

create index if not exists attendance_scheduler_runs_started_idx
  on public.attendance_scheduler_runs (started_at desc);

alter table public.attendance_scheduler_runs enable row level security;
-- No policies: service-role only (the scheduler has no user session).
