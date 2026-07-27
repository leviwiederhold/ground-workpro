-- ============================================================================
-- jobsite_timecard_events.event_type — diagnose and repair
--
-- Run PART 1 first. It tells you which situation you are actually in; the
-- status script's verdict cannot distinguish "applied out of order" from
-- "never applied", because both leave the departure types absent.
--
-- Then run PART 2 only if PART 1 says to.
-- ============================================================================


-- ── PART 1: DIAGNOSE (read-only) ────────────────────────────────────────────

-- 1a. Does the table exist, and does the constraint exist on it?
select
  to_regclass('public.jobsite_timecard_events') is not null as table_exists,
  exists (
    select 1 from pg_constraint
    where conname = 'jobsite_timecard_events_event_type_check'
      and conrelid = 'public.jobsite_timecard_events'::regclass
  ) as constraint_exists;

-- 1b. What does the constraint currently ALLOW? (the ground truth)
select pg_get_constraintdef(oid) as current_definition
from pg_constraint
where conname = 'jobsite_timecard_events_event_type_check';

-- 1c. Which of the six attendance migrations left a trace?
select
  to_regclass('public.attendance_scheduler_runs') is not null as m01_scheduled_clock_in,
  exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='jobsite_timecards'
            and column_name='clock_out_method')                as m02_departure_clock_out,
  to_regclass('public.attendance_corrections') is not null     as m03_audit_corrections;

-- 1d. Event types actually PRESENT IN THE DATA (matters for PART 2: adding a
--     CHECK constraint validates existing rows, so a stray type would make the
--     repair fail).
select event_type, count(*) as rows
from public.jobsite_timecard_events
group by event_type
order by count(*) desc;


-- ============================================================================
-- HOW TO READ PART 1
--
--   constraint_exists = false
--     → the base migration 20260602_01_jobsite_time has not been applied, or
--       the constraint was dropped manually. Do NOT run PART 2. Apply the
--       migrations from the beginning; see scripts/attendance-migration-status.sql.
--
--   constraint_exists = true, and 1b lists only the 8 original types
--   ('entered_geofence' … 'rejected')
--     → neither 20260721_01 nor _02 has been applied. Apply BOTH, in order.
--       PART 2 is not a substitute — those migrations also add columns,
--       indexes, and the scheduler-run counters.
--
--   constraint_exists = true, 1b lists 13 types (has 'scheduled_clock_in' but
--   NOT 'departure_pending'), and 1c shows m02_departure_clock_out = true
--     → _02 WAS applied, then _01 was applied after it and overwrote the
--       constraint. This is the out-of-order case. PART 2 is the correct fix.
--
--   constraint_exists = true, 13 types, m02_departure_clock_out = false
--     → _01 applied, _02 never applied. Apply 20260721_02 in full — it adds
--       clock_out_method, monitoring_stopped_at and the scheduler counters as
--       well as the constraint. PART 2 alone would leave those missing.
-- ============================================================================


-- ── PART 2: REPAIR (only for the out-of-order case) ─────────────────────────
--
-- Sets the constraint to the canonical union of all 18 event types. Idempotent
-- and safe to re-run. Wrapped so a violating row aborts cleanly with a readable
-- message instead of a bare constraint error.

do $$
declare
  offending text;
begin
  if to_regclass('public.jobsite_timecard_events') is null then
    raise exception 'jobsite_timecard_events does not exist — apply the base migrations first, not this repair';
  end if;

  -- Existing rows are validated when the constraint is added. Fail loudly and
  -- specifically rather than letting Postgres report a generic violation.
  select string_agg(distinct event_type, ', ')
  into offending
  from public.jobsite_timecard_events
  where event_type <> all (array[
    'entered_geofence','exited_geofence','auto_clock_in','auto_clock_out',
    'break_suggested','manager_edited','approved','rejected',
    'onsite_before_shift','scheduled_clock_in','clock_in_backfilled',
    'clock_in_rejected','duplicate_suppressed',
    'departure_pending','departure_cancelled','fallback_clock_out',
    'clock_out_rejected','monitoring_stopped'
  ]);

  if offending is not null then
    raise exception
      'Existing rows use event types not in the canonical list: %. Investigate before repairing — do not widen the constraint to accommodate unexpected data.',
      offending;
  end if;

  alter table public.jobsite_timecard_events
    drop constraint if exists jobsite_timecard_events_event_type_check;

  alter table public.jobsite_timecard_events
    add constraint jobsite_timecard_events_event_type_check
    check (event_type in (
      -- Original (20260602_01)
      'entered_geofence','exited_geofence','auto_clock_in','auto_clock_out',
      'break_suggested','manager_edited','approved','rejected',
      -- Automatic arrival / scheduled clock-in (20260721_01)
      'onsite_before_shift','scheduled_clock_in','clock_in_backfilled',
      'clock_in_rejected','duplicate_suppressed',
      -- Automatic departure / clock-out (20260721_02)
      'departure_pending','departure_cancelled','fallback_clock_out',
      'clock_out_rejected','monitoring_stopped'
    ));

  raise notice 'event_type constraint repaired: 18 types allowed';
end $$;


-- ── VERIFY (expect 18 / 18) ─────────────────────────────────────────────────

select
  count(*) as types_allowed,
  18 as expected,
  case when count(*) = 18 then '✅ repaired' else '❌ still wrong — re-read PART 1' end as status
from (
  select unnest(regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g')) as t
  from pg_constraint
  where conname = 'jobsite_timecard_events_event_type_check'
) types;
