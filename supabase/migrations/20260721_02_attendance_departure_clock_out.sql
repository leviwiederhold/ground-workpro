-- ============================================================================
-- Automatic departure and clock-out.
--
-- A geofence exit opens a DEPARTURE-PENDING state (pending_departure_at, added
-- in the two-zone migration) rather than clocking anyone out. This migration
-- adds what the server-side confirmation needs: how the clock-out was produced,
-- when monitoring stopped for the resolved workday, and audit event types for
-- every step of the departure lifecycle.
-- ============================================================================

-- 1. Departure audit event types ---------------------------------------------
do $$ begin
  alter table public.jobsite_timecard_events
    drop constraint if exists jobsite_timecard_events_event_type_check;
end $$;

alter table public.jobsite_timecard_events
  add constraint jobsite_timecard_events_event_type_check
  check (event_type in (
    'entered_geofence','exited_geofence','auto_clock_in','auto_clock_out',
    'break_suggested','manager_edited','approved','rejected',
    -- Automatic arrival / scheduled clock-in:
    'onsite_before_shift','scheduled_clock_in','clock_in_backfilled',
    'clock_in_rejected','duplicate_suppressed',
    -- Automatic departure / clock-out (this migration):
    'departure_pending',     -- exit observed; grace period started
    'departure_cancelled',   -- employee returned during the grace period
    'fallback_clock_out',    -- no exit event ever arrived; closed at scheduled end
    'clock_out_rejected',    -- clock-out refused (e.g. nothing open to close)
    'monitoring_stopped'     -- workday resolved; monitoring ended for the assignment
  ));

-- 2. How the clock-out was produced ------------------------------------------
alter table public.jobsite_timecards
  add column if not exists clock_out_method text,
  -- Set when the workday is resolved. Monitoring must not keep re-triggering
  -- arrivals for a shift that is already finished.
  add column if not exists monitoring_stopped_at timestamptz;

do $$ begin
  alter table public.jobsite_timecards
    add constraint jobsite_timecards_clock_out_method_check
    check (clock_out_method is null or clock_out_method in (
      'departure_grace', 'fallback_end_of_day', 'manual', 'manager'
    ));
exception when duplicate_object then null; end $$;

-- 3. Candidate lookup for the scheduled departure pass ------------------------
-- The pass scans every OPEN clocked-in card: those with a pending departure may
-- be due, and those without one may need the end-of-day fallback.
create index if not exists jobsite_timecards_open_shift_idx
  on public.jobsite_timecards (work_date, company_id)
  where clock_in_at is not null and clock_out_at is null;

-- 4. Scheduled-run counters for the departure pass ---------------------------
alter table public.attendance_scheduler_runs
  add column if not exists clocked_out integer not null default 0,
  add column if not exists fallback_clocked_out integer not null default 0,
  add column if not exists departures_cancelled integer not null default 0;
