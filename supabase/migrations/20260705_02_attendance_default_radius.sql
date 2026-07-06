-- ============================================================================
-- Attendance (Jobsite Time): raise the DEFAULT geofence radius to ~1 mile
-- (5280 ft). Only the column default changes — existing companies keep the
-- radius they already saved. New companies (and rows that never set a value)
-- get the 1-mile default.
-- ============================================================================

alter table public.companies
  alter column jobsite_geofence_radius_feet set default 5280;
