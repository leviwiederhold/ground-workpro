-- ============================================================================
-- Jobs address verification: store the provider place id and whether the saved
-- address/coordinates came from a trusted geocoding result. Attendance/geofence
-- should only trust coordinates when address_verified = true.
-- ============================================================================

alter table public.jobs
  add column if not exists place_id text null,
  add column if not exists address_verified boolean not null default false;
