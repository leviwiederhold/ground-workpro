-- Track which employees joined through the shared company code so owners can
-- optionally review their safe default Employee/operator role. This metadata
-- never gates app access. A pending review is cleared only by an explicit
-- owner/co-owner action; elapsed time does not clear it.
alter table public.employees
  add column if not exists joined_via_company_code_at timestamptz,
  add column if not exists role_reviewed_at timestamptz;

create index if not exists employees_company_code_role_review_idx
  on public.employees (company_id, joined_via_company_code_at desc)
  where joined_via_company_code_at is not null
    and role_reviewed_at is null;

comment on column public.employees.joined_via_company_code_at is
  'When this employee joined through the reusable company employee code.';

comment on column public.employees.role_reviewed_at is
  'Optional owner/co-owner review timestamp; does not gate employee access.';

-- Validate the current code and create the membership + employee record in one
-- transaction. The user advisory lock serializes concurrent join attempts,
-- while the code row lock makes regeneration linearizable with acceptance.
create or replace function public.accept_employee_company_join(
  p_user_id uuid,
  p_code_digest text,
  p_email text,
  p_full_name text,
  p_joined_at timestamptz default statement_timestamp()
)
returns table (
  join_status text,
  joined_company_id uuid,
  joined_employee_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_company_id uuid;
  v_expires_at timestamptz;
  v_existing_company_id uuid;
  v_employee_id uuid;
  v_company_active boolean := false;
begin
  if p_user_id is null
    or length(coalesce(p_code_digest, '')) <> 64
    or nullif(trim(coalesce(p_email, '')), '') is null
    or nullif(trim(coalesce(p_full_name, '')), '') is null
  then
    return query select 'invalid_request'::text, null::uuid, null::uuid;
    return;
  end if;

  -- Every join path for this user observes a single membership decision.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select codes.company_id, codes.expires_at
    into v_company_id, v_expires_at
  from public.company_employee_join_codes as codes
  where codes.code_digest = p_code_digest
  for share;

  if v_company_id is null then
    return query select 'invalid_code'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_expires_at <= statement_timestamp() then
    return query select 'expired'::text, v_company_id, null::uuid;
    return;
  end if;

  select exists (
    select 1
    from public.companies as company
    where company.id = v_company_id
      and (
        lower(coalesce(company.subscription_status, '')) in ('active', 'trialing')
        or lower(coalesce(company.billing_override_type, '')) = 'free_lifetime'
        or (
          lower(coalesce(company.billing_override_type, '')) = 'free_until'
          and company.billing_override_until > statement_timestamp()
        )
      )
  ) into v_company_active;

  if not v_company_active then
    return query select 'company_inactive'::text, v_company_id, null::uuid;
    return;
  end if;

  select membership.company_id
    into v_existing_company_id
  from public.memberships as membership
  where membership.user_id = p_user_id
  limit 1;

  if v_existing_company_id is not null then
    return query
      select
        case
          when v_existing_company_id = v_company_id then 'already_member_same'
          else 'already_member_other'
        end,
        v_existing_company_id,
        null::uuid;
    return;
  end if;

  begin
    insert into public.memberships (company_id, user_id, role)
    values (v_company_id, p_user_id, 'operator');
  exception
    when unique_violation then
      select membership.company_id
        into v_existing_company_id
      from public.memberships as membership
      where membership.user_id = p_user_id
      limit 1;

      return query
        select
          case
            when v_existing_company_id = v_company_id then 'already_member_same'
            else 'already_member_other'
          end,
          v_existing_company_id,
          null::uuid;
      return;
  end;

  select employee.id
    into v_employee_id
  from public.employees as employee
  where employee.company_id = v_company_id
    and (
      employee.user_id = p_user_id
      or (
        employee.user_id is null
        and lower(coalesce(employee.email, '')) = lower(trim(p_email))
      )
    )
  order by case when employee.user_id = p_user_id then 0 else 1 end, employee.created_at
  limit 1
  for update;

  if v_employee_id is null then
    insert into public.employees (
      company_id,
      user_id,
      email,
      full_name,
      role,
      status,
      joined_via_company_code_at,
      role_reviewed_at
    )
    values (
      v_company_id,
      p_user_id,
      lower(trim(p_email)),
      trim(p_full_name),
      'operator',
      'active',
      p_joined_at,
      null
    )
    returning id into v_employee_id;
  else
    update public.employees
    set
      user_id = p_user_id,
      email = lower(trim(p_email)),
      full_name = trim(p_full_name),
      role = 'operator',
      status = 'active',
      joined_via_company_code_at = p_joined_at,
      role_reviewed_at = null
    where id = v_employee_id
      and company_id = v_company_id;
  end if;

  return query select 'joined'::text, v_company_id, v_employee_id;
end;
$$;

revoke all on function public.accept_employee_company_join(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.accept_employee_company_join(uuid, text, text, text, timestamptz)
  to service_role;
