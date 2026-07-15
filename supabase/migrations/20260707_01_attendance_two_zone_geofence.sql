-- ============================================================================
-- Attendance: two-zone geofence model.
--
-- Automatic Jobsite Time previously used a single geofence radius for both
-- "wake the app" and "count as arrived/left". That made it too easy to mark
-- someone arrived just for driving within a mile of a job. This introduces
-- two independently-configurable zones:
--
--   Wake radius (jobsite_wake_radius_meters)       - wide (~1 mile default).
--     Wakes closer monitoring only; never marks arrival by itself.
--   Arrival radius (jobsite_geofence_radius_feet)  - tight (~500 ft default).
--     The actual attendance (clock-in/out) event radius. Column name is kept
--     for compatibility with existing saved company settings/timecards.
--
-- Arrivals/departures are also no longer applied the instant an enter/exit
-- event is received: pending_arrival_at / pending_departure_at record the
-- moment a transition was observed, and are only finalized into
-- clock_in_at / clock_out_at once the configured confirmation delay /
-- departure grace period has elapsed (see
-- src/lib/jobsite-time/finalizeAttendance.ts). This holds even if the
-- underlying native signal is a single instantaneous enter/exit callback.
-- ============================================================================

alter table public.companies
  add column if not exists jobsite_wake_radius_meters integer not null default 1609,
  add column if not exists jobsite_departure_grace_minutes integer not null default 5,
  add column if not exists jobsite_arrival_confirmation_seconds integer not null default 45;

-- New companies (and rows that never set a value) now default to the 500 ft
-- arrival radius from the two-zone model. Existing companies keep whatever
-- radius they already saved.
alter table public.companies
  alter column jobsite_geofence_radius_feet set default 500;

-- Companies still sitting on the old single-zone 1-mile default (5280 ft,
-- introduced by 20260705_02) never configured a real ARRIVAL footprint — that
-- value only ever meant "somewhere near the job". Re-home it as their wake
-- radius (already ~1 mile) and reset the arrival radius to the new 500 ft
-- default, otherwise the two-zone model is silently defeated for every
-- existing company until an admin happens to resave settings. Companies that
-- explicitly chose a different radius are left untouched.
update public.companies
  set jobsite_wake_radius_meters = 1609,
      jobsite_geofence_radius_feet = 500
  where jobsite_geofence_radius_feet = 5280;

alter table public.jobsite_timecards
  add column if not exists pending_arrival_at timestamptz null,
  add column if not exists pending_departure_at timestamptz null;
