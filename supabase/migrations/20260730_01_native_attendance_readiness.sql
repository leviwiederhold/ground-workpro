-- ============================================================================
-- Native attendance readiness + background lifecycle diagnostics.
--
-- employee_location_permissions previously stored only the permission snapshot
-- observed by the WebView.  It could not prove that the native service was
-- healthy, the Keychain credential existed, or every assigned region was
-- actually registered.  The additional columns hold the last definitive native
-- report.  They contain no coordinates or continuous location history.
--
-- attendance_native_diagnostics is a service-role-only, bounded event trail
-- uploaded by the native process.  It identifies the lifecycle stage reached
-- (launch, region callback, Keychain, queue, HTTP) without exposing it in the
-- employee UI.
-- ============================================================================

alter table public.employee_location_permissions
  add column if not exists native_service_supported boolean null,
  add column if not exists native_service_healthy boolean null,
  add column if not exists background_refresh_enabled boolean null,
  add column if not exists native_has_secure_credential boolean null,
  add column if not exists required_region_ids text[] not null default '{}',
  add column if not exists registered_region_ids text[] not null default '{}',
  add column if not exists native_device_id text null,
  add column if not exists native_readiness_reported_at timestamptz null;

create table if not exists public.attendance_native_diagnostics (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id text not null,
  credential_id uuid null references public.device_attendance_credentials(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  employee_id uuid null,
  device_id text null,
  code text not null,
  stage text not null,
  status text not null,
  region_identifier text null,
  transition text null,
  occurred_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (credential_id, diagnostic_id)
);

create index if not exists attendance_native_diagnostics_company_time_idx
  on public.attendance_native_diagnostics (company_id, occurred_at desc);

alter table public.attendance_native_diagnostics enable row level security;
-- No policies: service-role only. Employee clients cannot read or write this
-- diagnostic trail.
