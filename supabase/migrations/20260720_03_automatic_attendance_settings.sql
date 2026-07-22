-- ============================================================================
-- Company-level automatic-attendance configuration.
--
-- Adds explicit, first-class settings for the automatic attendance pipeline so
-- no component has to hard-code them. Existing companies receive the documented
-- defaults via the column defaults + an explicit backfill of any NULLs.
--
-- Reused existing columns (NOT re-added here):
--   attendance_early_arrival_window_minutes -> monitoringLeadMinutes
--   jobsite_manual_fallback_enabled         -> manualFallbackEnabled
--   timezone                                -> company timezone
-- ============================================================================

alter table public.companies
  add column if not exists attendance_automatic_enabled boolean not null default true,
  add column if not exists attendance_geofence_radius_meters integer not null default 200,
  add column if not exists attendance_arrival_dwell_minutes integer not null default 2,
  add column if not exists attendance_early_arrival_mode text not null default 'scheduled_start',
  add column if not exists attendance_departure_grace_minutes integer not null default 10,
  add column if not exists attendance_end_of_day_cutoff_minutes integer not null default 180,
  -- monitoring lead time (reused name); ensure it exists with the documented default.
  add column if not exists attendance_early_arrival_window_minutes integer not null default 120;

do $$ begin
  alter table public.companies
    add constraint companies_attendance_early_arrival_mode_check
    check (attendance_early_arrival_mode in ('clock_in_on_arrival', 'scheduled_start'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.companies
    add constraint companies_attendance_bounds_check
    check (
      attendance_early_arrival_window_minutes between 0 and 720
      and attendance_geofence_radius_meters between 50 and 5000
      and attendance_arrival_dwell_minutes between 0 and 60
      and attendance_departure_grace_minutes between 0 and 120
      and attendance_end_of_day_cutoff_minutes between 0 and 1440
    );
exception when duplicate_object then null; end $$;

-- Backfill any pre-existing NULLs (columns added with defaults only apply to new
-- rows if the column already existed nullable before this migration).
update public.companies set
  attendance_automatic_enabled = coalesce(attendance_automatic_enabled, true),
  attendance_geofence_radius_meters = coalesce(attendance_geofence_radius_meters, 200),
  attendance_arrival_dwell_minutes = coalesce(attendance_arrival_dwell_minutes, 2),
  attendance_early_arrival_mode = coalesce(attendance_early_arrival_mode, 'scheduled_start'),
  attendance_departure_grace_minutes = coalesce(attendance_departure_grace_minutes, 10),
  attendance_end_of_day_cutoff_minutes = coalesce(attendance_end_of_day_cutoff_minutes, 180),
  attendance_early_arrival_window_minutes = coalesce(attendance_early_arrival_window_minutes, 120)
where attendance_automatic_enabled is null
   or attendance_geofence_radius_meters is null
   or attendance_arrival_dwell_minutes is null
   or attendance_early_arrival_mode is null
   or attendance_departure_grace_minutes is null
   or attendance_end_of_day_cutoff_minutes is null
   or attendance_early_arrival_window_minutes is null;
