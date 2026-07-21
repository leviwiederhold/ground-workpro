-- ============================================================================
-- Device-scoped attendance credentials + background-event audit/idempotency.
--
-- Lets a native app submit attendance events while backgrounded/closed, without
-- WebView cookies, using a restricted bearer credential that:
--   - carries no user password and no general Supabase access,
--   - is scoped to attendance event submission only,
--   - is bound to (company, user, device),
--   - supports expiration, rotation, revocation, and logout cleanup.
--
-- Only the service-role admin client touches these tables (the verify path has
-- no user session), so RLS is enabled with NO policies — denying all direct
-- access from anon/authenticated roles.
-- ============================================================================

create table if not exists public.device_attendance_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid null,
  device_id text not null,
  platform text null,
  -- SHA-256 hex of the secret; the plaintext token is NEVER stored.
  token_hash text not null unique,
  scope text not null default 'attendance:events',
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  last_used_at timestamptz null,
  revoked_at timestamptz null
);

create index if not exists device_attendance_credentials_company_user_idx
  on public.device_attendance_credentials (company_id, user_id, device_id);

-- Only one ACTIVE (un-revoked) credential per device.
create unique index if not exists device_attendance_credentials_active_device_uidx
  on public.device_attendance_credentials (company_id, user_id, device_id)
  where revoked_at is null;

alter table public.device_attendance_credentials enable row level security;
-- No policies: service-role only.

-- Append-only audit of authenticated background ingest attempts. The unique
-- idempotency_key both dedupes duplicate native deliveries and records the
-- attempt (who/what/when/outcome).
create table if not exists public.attendance_event_audit (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid null references public.device_attendance_credentials(id) on delete set null,
  company_id uuid not null,
  user_id uuid null,
  employee_id uuid null,
  device_id text null,
  job_id text null,
  zone text null,
  transition text null,
  occurred_at timestamptz null,
  idempotency_key text not null unique,
  result text not null,
  ip text null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_event_audit_company_idx
  on public.attendance_event_audit (company_id, created_at desc);

alter table public.attendance_event_audit enable row level security;
-- No policies: service-role only.
