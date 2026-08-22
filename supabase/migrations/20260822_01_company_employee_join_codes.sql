-- Temporary, reusable employee join code. There is exactly one current code
-- per company, so an upsert during regeneration immediately replaces (and
-- invalidates) the previous value.
create table if not exists public.company_employee_join_codes (
  company_id uuid primary key references public.companies(id) on delete cascade,
  code text not null,
  code_digest text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint company_employee_join_codes_code_format_check
    check (code ~ '^[A-Z2-9]{6}$'),
  constraint company_employee_join_codes_expiration_check
    check (expires_at = created_at + interval '24 hours')
);

create index if not exists company_employee_join_codes_expires_at_idx
  on public.company_employee_join_codes (expires_at);

alter table public.company_employee_join_codes enable row level security;

-- Owners/co-owners are represented by the existing admin/CEO membership role.
-- The public validation and acceptance endpoints use the service-role client;
-- there is intentionally no anonymous policy exposing codes.
drop policy if exists company_employee_join_codes_owner_select
  on public.company_employee_join_codes;
create policy company_employee_join_codes_owner_select
  on public.company_employee_join_codes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('admin', 'ceo', 'executive', 'owner')
    )
  );

drop policy if exists company_employee_join_codes_owner_insert
  on public.company_employee_join_codes;
create policy company_employee_join_codes_owner_insert
  on public.company_employee_join_codes
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('admin', 'ceo', 'executive', 'owner')
    )
  );

drop policy if exists company_employee_join_codes_owner_update
  on public.company_employee_join_codes;
create policy company_employee_join_codes_owner_update
  on public.company_employee_join_codes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('admin', 'ceo', 'executive', 'owner')
    )
  )
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('admin', 'ceo', 'executive', 'owner')
    )
  );

revoke all on table public.company_employee_join_codes from anon;

-- Groundwork Pro has one active company context per auth user. The previous
-- company-scoped unique constraint allowed two concurrent onboarding requests
-- for different companies to create an ambiguous second membership.
create unique index if not exists memberships_user_id_unique
  on public.memberships (user_id);

-- Persistent rate-limit state keeps brute-force protection effective across
-- serverless instances and deploys. Keys are SHA-256 digests produced by the
-- application, so client IP addresses are never stored in plaintext.
create table if not exists public.employee_join_code_rate_limits (
  rate_limit_key text primary key,
  attempt_count integer not null default 0,
  reset_at timestamptz not null,
  constraint employee_join_code_rate_limits_count_check
    check (attempt_count >= 0)
);

create index if not exists employee_join_code_rate_limits_reset_at_idx
  on public.employee_join_code_rate_limits (reset_at);

alter table public.employee_join_code_rate_limits enable row level security;
revoke all on table public.employee_join_code_rate_limits from public, anon, authenticated;

create or replace function public.consume_employee_join_code_rate_limit(
  p_rate_limit_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, rate_limit_reset_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
  v_reset_at timestamptz;
begin
  if length(coalesce(p_rate_limit_key, '')) <> 64
    or p_limit < 1
    or p_limit > 1000
    or p_window_seconds < 1
    or p_window_seconds > 86400
  then
    raise exception 'invalid employee join-code rate-limit parameters';
  end if;

  insert into public.employee_join_code_rate_limits as limits (
    rate_limit_key,
    attempt_count,
    reset_at
  )
  values (
    p_rate_limit_key,
    1,
    statement_timestamp() + make_interval(secs => p_window_seconds)
  )
  on conflict (rate_limit_key) do update
  set
    attempt_count = case
      when limits.reset_at <= statement_timestamp() then 1
      else limits.attempt_count + 1
    end,
    reset_at = case
      when limits.reset_at <= statement_timestamp()
        then statement_timestamp() + make_interval(secs => p_window_seconds)
      else limits.reset_at
    end
  returning limits.attempt_count, limits.reset_at
    into v_count, v_reset_at;

  -- Bound cleanup work while preventing abandoned identifiers from growing
  -- forever. The active key cannot match this one-day-old cutoff.
  delete from public.employee_join_code_rate_limits
  where ctid in (
    select ctid
    from public.employee_join_code_rate_limits
    where reset_at < statement_timestamp() - interval '1 day'
    limit 100
  );

  return query select v_count <= p_limit, v_reset_at;
end;
$$;

revoke all on function public.consume_employee_join_code_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_employee_join_code_rate_limit(text, integer, integer)
  to service_role;
