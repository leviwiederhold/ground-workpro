-- ============================================================================
-- Attendance stack — what does this database still need?
--
-- This repo has no migration tracking table (migrations are applied by hand in
-- the SQL editor), so the only reliable way to know what is applied is to look
-- at the schema itself. This checks for the objects each migration creates.
--
-- SAFE TO RUN ANYWHERE. Reads only; changes nothing.
--
-- Run it, then apply whichever rows say MISSING, in the order shown.
-- ============================================================================

with checks(sort_order, migration, requirement, present) as (
  values
    -- ── Prerequisites (older migrations the attendance stack builds on) ─────
    (0, '20260602_01_jobsite_time', 'table jobsite_timecards',
      to_regclass('public.jobsite_timecards') is not null),
    (0, '20260602_01_jobsite_time', 'table jobsite_timecard_events',
      to_regclass('public.jobsite_timecard_events') is not null),
    (0, '20260706_01_jobs_address_verification', 'jobs.address_verified',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobs' and column_name='address_verified')),
    (0, '20260706_02_company_work_schedule', 'companies.default_work_start_time',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='companies' and column_name='default_work_start_time')),
    (0, '20260707_01_attendance_two_zone_geofence', 'jobsite_timecards.pending_arrival_at',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobsite_timecards' and column_name='pending_arrival_at')),

    -- ── The attendance stack ────────────────────────────────────────────────
    (3, '20260720_03_automatic_attendance_settings', 'companies.attendance_automatic_enabled',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='companies' and column_name='attendance_automatic_enabled')),
    (3, '20260720_03_automatic_attendance_settings', 'companies.attendance_early_arrival_mode',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='companies' and column_name='attendance_early_arrival_mode')),

    (4, '20260720_04_employee_location_permissions', 'table employee_location_permissions',
      to_regclass('public.employee_location_permissions') is not null),

    (5, '20260720_05_device_attendance_credentials', 'table device_attendance_credentials',
      to_regclass('public.device_attendance_credentials') is not null),
    (5, '20260720_05_device_attendance_credentials', 'table attendance_event_audit',
      to_regclass('public.attendance_event_audit') is not null),

    (6, '20260721_01_attendance_scheduled_clock_in', 'table attendance_scheduler_runs',
      to_regclass('public.attendance_scheduler_runs') is not null),
    (6, '20260721_01_attendance_scheduled_clock_in', 'jobsite_timecards.onsite_before_shift_at',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobsite_timecards' and column_name='onsite_before_shift_at')),
    (6, '20260721_01_attendance_scheduled_clock_in', 'index jobsite_timecards_open_unique_idx',
      exists (select 1 from pg_indexes
              where schemaname='public' and indexname='jobsite_timecards_open_unique_idx')),

    (7, '20260721_02_attendance_departure_clock_out', 'jobsite_timecards.clock_out_method',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobsite_timecards' and column_name='clock_out_method')),
    (7, '20260721_02_attendance_departure_clock_out', 'jobsite_timecards.monitoring_stopped_at',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobsite_timecards' and column_name='monitoring_stopped_at')),
    (7, '20260721_02_attendance_departure_clock_out', 'attendance_scheduler_runs.clocked_out',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='attendance_scheduler_runs' and column_name='clocked_out')),

    (8, '20260721_03_attendance_audit_corrections', 'table attendance_corrections',
      to_regclass('public.attendance_corrections') is not null),
    (8, '20260721_03_attendance_audit_corrections', 'jobsite_timecard_events.event_source',
      exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobsite_timecard_events' and column_name='event_source')),
    (8, '20260721_03_attendance_audit_corrections', 'append-only trigger (events)',
      exists (select 1 from pg_trigger
              where tgname='jobsite_timecard_events_no_update' and not tgisinternal)),
    (8, '20260721_03_attendance_audit_corrections', 'append-only trigger (corrections)',
      exists (select 1 from pg_trigger
              where tgname='attendance_corrections_no_update' and not tgisinternal))
)
select
  case when sort_order = 0 then 'PREREQUISITE' else 'attendance' end as kind,
  migration,
  requirement,
  case when present then '✅ present' else '❌ MISSING' end as status
from checks
order by sort_order, migration, requirement;


-- ============================================================================
-- The event_type constraint — the one thing migration ORDER can silently break.
--
-- 20260721_01 and _02 EACH drop and recreate this constraint. _02 carries the
-- union of both. If they are applied out of order, the constraint ends up
-- missing five departure event types and every departure event fails at
-- runtime with a constraint violation.
--
-- After applying both, this must list all 18 types.
-- ============================================================================

select
  count(*) filter (where t = any(array[
    'entered_geofence','exited_geofence','auto_clock_in','auto_clock_out',
    'break_suggested','manager_edited','approved','rejected',
    'onsite_before_shift','scheduled_clock_in','clock_in_backfilled',
    'clock_in_rejected','duplicate_suppressed',
    'departure_pending','departure_cancelled','fallback_clock_out',
    'clock_out_rejected','monitoring_stopped'
  ])) as types_present,
  18 as types_expected,
  case
    when count(*) filter (where t = any(array[
      'departure_pending','departure_cancelled','fallback_clock_out',
      'clock_out_rejected','monitoring_stopped'])) = 5
    then '✅ departure types present — order was correct'
    else '❌ RE-APPLY 20260721_02 — the departure event types are missing'
  end as verdict
from (
  select unnest(regexp_matches(
    pg_get_constraintdef(oid), '''([a-z_]+)''', 'g'
  ))::text as t
  from pg_constraint
  where conname = 'jobsite_timecard_events_event_type_check'
) types;
