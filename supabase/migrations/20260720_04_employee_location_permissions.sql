-- ============================================================================
-- Per-employee native location permission state.
--
-- Records the four separated permission dimensions (location services,
-- foreground, background, precise) plus onboarding completion, so:
--   - the app avoids re-prompting once background access is granted,
--   - revoked/downgraded access is detectable, and
--   - company admins can see whether automatic attendance is configured for
--     each employee.
--
-- Keyed by auth user_id for simple, robust RLS: a user writes only their own
-- row; any company member (admins/PMs in practice) can read the company's rows.
-- ============================================================================

create table if not exists public.employee_location_permissions (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  location_services_enabled boolean null,
  foreground text not null default 'unknown',
  background text not null default 'unknown',
  precise boolean null,
  platform text not null default 'unknown',
  onboarding_completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists employee_location_permissions_company_idx
  on public.employee_location_permissions (company_id);

alter table public.employee_location_permissions enable row level security;

-- Read: any company member (managers use this for the admin visibility view).
drop policy if exists employee_location_permissions_select on public.employee_location_permissions;
create policy employee_location_permissions_select
  on public.employee_location_permissions
  for select
  using (public.is_company_member(company_id));

-- Write: a user may only upsert their OWN row, and only within a company they
-- belong to.
drop policy if exists employee_location_permissions_insert on public.employee_location_permissions;
create policy employee_location_permissions_insert
  on public.employee_location_permissions
  for insert
  with check (user_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists employee_location_permissions_update on public.employee_location_permissions;
create policy employee_location_permissions_update
  on public.employee_location_permissions
  for update
  using (user_id = auth.uid() and public.is_company_member(company_id))
  with check (user_id = auth.uid() and public.is_company_member(company_id));
