-- Separate immutable workspace ownership from assignable owner-level access.
-- Exactly one membership remains `owner`; every additional full-access member
-- becomes `co_owner` without changing the legacy admin permission profile.

alter table public.companies
  add column if not exists primary_owner_user_id uuid;

-- Prefer explicit historical creator/owner columns when an installation has
-- one. Older Groundwork schemas did not, so each reference is dynamic.
do $$
declare
  candidate_column text;
begin
  foreach candidate_column in array array['created_by', 'owner_user_id'] loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'companies'
        and column_name = candidate_column
    ) then
      execute format($sql$
        update public.companies c
        set primary_owner_user_id = m.user_id
        from public.memberships m
        where c.primary_owner_user_id is null
          and m.company_id = c.id
          and m.user_id::text = c.%I::text
      $sql$, candidate_column);
    end if;
  end loop;
end
$$;

-- Then choose a current owner-level membership deterministically. This keeps
-- the same access holder in place and gives repeatable results for duplicate
-- legacy Owner rows.
update public.companies c
set primary_owner_user_id = (
  select m.user_id
  from public.memberships m
  where m.company_id = c.id
  order by
    case
      when lower(regexp_replace(coalesce(m.role, ''), '[^a-z0-9]', '', 'g'))
        in ('owner', 'admin', 'executive', 'ceo') then 0
      else 1
    end,
    m.user_id
  limit 1
)
where c.primary_owner_user_id is null;

do $$
begin
  if exists (
    select 1 from public.companies where primary_owner_user_id is null
  ) then
    raise exception 'Cannot establish a primary owner for a company with no membership';
  end if;
end
$$;

-- Remove role checks before introducing the new canonical value.
do $$
declare
  target regclass;
  constraint_row record;
begin
  foreach target in array array[
    'public.memberships'::regclass,
    'public.employees'::regclass,
    'public.pending_invitations'::regclass,
    'public.invite_tokens'::regclass
  ] loop
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = target
        and contype = 'c'
        and conname ilike '%role%'
        and conname not ilike '%legacy_permission_profile%'
    loop
      execute format('alter table %s drop constraint %I', target, constraint_row.conname);
    end loop;
  end loop;
end
$$;

alter table public.memberships disable trigger memberships_canonicalize_team_role;
alter table public.employees disable trigger employees_canonicalize_team_role;
alter table public.pending_invitations disable trigger pending_invitations_canonicalize_team_role;
alter table public.invite_tokens disable trigger invite_tokens_canonicalize_team_role;

update public.memberships m
set role = 'owner', legacy_permission_profile = 'admin'
from public.companies c
where c.id = m.company_id
  and m.user_id = c.primary_owner_user_id;

update public.memberships m
set role = 'co_owner', legacy_permission_profile = 'admin'
from public.companies c
where c.id = m.company_id
  and m.user_id is distinct from c.primary_owner_user_id
  and lower(regexp_replace(coalesce(m.role, ''), '[^a-z0-9]', '', 'g'))
    in ('owner', 'coowner', 'admin', 'executive', 'ceo', 'coceo');

update public.employees e
set role = 'owner', legacy_permission_profile = 'admin'
from public.companies c
where c.id = e.company_id
  and e.user_id = c.primary_owner_user_id;

update public.employees e
set role = 'co_owner', legacy_permission_profile = 'admin'
from public.companies c
where c.id = e.company_id
  and e.user_id is distinct from c.primary_owner_user_id
  and lower(regexp_replace(coalesce(e.role, ''), '[^a-z0-9]', '', 'g'))
    in ('owner', 'coowner', 'admin', 'executive', 'ceo', 'coceo');

update public.pending_invitations
set role = 'co_owner', legacy_permission_profile = 'admin'
where lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g'))
  in ('owner', 'coowner', 'admin', 'executive', 'ceo', 'coceo');

update public.invite_tokens
set role = 'co_owner', legacy_permission_profile = 'admin'
where lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g'))
  in ('owner', 'coowner', 'admin', 'executive', 'ceo', 'coceo');

alter table public.memberships
  add constraint memberships_canonical_role_check
  check (role in ('owner', 'co_owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.employees
  add constraint employees_canonical_role_check
  check (role is null or role in ('owner', 'co_owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.pending_invitations
  add constraint pending_invitations_canonical_role_check
  check (role in ('co_owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.invite_tokens
  add constraint invite_tokens_canonical_role_check
  check (role in ('co_owner', 'administrator', 'manager', 'crew_lead', 'team_member'));

create or replace function public.default_company_primary_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.primary_owner_user_id := coalesce(new.primary_owner_user_id, auth.uid());
  return new;
end
$$;

drop trigger if exists companies_default_primary_owner on public.companies;
create trigger companies_default_primary_owner
before insert on public.companies
for each row execute function public.default_company_primary_owner();

alter table public.companies
  alter column primary_owner_user_id set not null;
alter table public.companies
  drop constraint if exists companies_primary_owner_user_id_fkey;
alter table public.companies
  add constraint companies_primary_owner_user_id_fkey
  foreign key (primary_owner_user_id) references auth.users(id) on delete restrict;

create unique index if not exists memberships_one_primary_owner_per_company
  on public.memberships (company_id)
  where role = 'owner';

comment on column public.companies.primary_owner_user_id is
  'The one primary workspace owner. Transfer requires a deliberate ownership workflow.';

drop policy if exists company_employee_join_codes_owner_select
  on public.company_employee_join_codes;
create policy company_employee_join_codes_owner_select
  on public.company_employee_join_codes
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('owner', 'co_owner', 'admin', 'ceo', 'executive')
    )
  );

drop policy if exists company_employee_join_codes_owner_insert
  on public.company_employee_join_codes;
create policy company_employee_join_codes_owner_insert
  on public.company_employee_join_codes
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('owner', 'co_owner', 'admin', 'ceo', 'executive')
    )
  );

drop policy if exists company_employee_join_codes_owner_update
  on public.company_employee_join_codes;
create policy company_employee_join_codes_owner_update
  on public.company_employee_join_codes
  for update to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('owner', 'co_owner', 'admin', 'ceo', 'executive')
    )
  )
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.memberships m
      where m.company_id = company_employee_join_codes.company_id
        and m.user_id = auth.uid()
        and lower(coalesce(m.role, '')) in ('owner', 'co_owner', 'admin', 'ceo', 'executive')
    )
  );

-- Released clients still send admin/CEO for full access. Those values now mean
-- Co-Owner; only an explicit owner write for the company marker can be primary.
create or replace function public.canonicalize_groundwork_team_role()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_role text;
  recompute_profile boolean;
begin
  if new.role is null then
    new.legacy_permission_profile := null;
    return new;
  end if;

  raw_role := lower(regexp_replace(new.role, '[^a-z0-9]', '', 'g'));
  recompute_profile := new.legacy_permission_profile is null;
  if tg_op = 'UPDATE' then
    recompute_profile := new.role is distinct from old.role
      and new.legacy_permission_profile is not distinct from old.legacy_permission_profile;
  end if;

  if new.legacy_permission_profile is null or recompute_profile then
    new.legacy_permission_profile := case
      when raw_role in ('owner', 'coowner', 'admin', 'executive', 'ceo', 'coceo') then 'admin'
      when raw_role in ('administrator', 'pm', 'manager', 'operations', 'operationsmanager', 'projectmanager') then 'pm'
      when raw_role in ('foreman', 'crewlead') then 'foreman'
      when raw_role = 'mechanic' then 'mechanic'
      when raw_role in ('field', 'fieldstaff') then 'fieldstaff'
      when raw_role in ('teammember', 'employee', 'operator', 'laborer', 'labourer', 'technician') then 'operator'
      else null
    end;
  end if;

  new.role := case
    when raw_role = 'owner' then 'owner'
    when raw_role in ('coowner', 'admin', 'executive', 'ceo', 'coceo') then 'co_owner'
    when raw_role = 'administrator' then 'administrator'
    when raw_role in ('pm', 'manager', 'operations', 'operationsmanager', 'projectmanager') then 'manager'
    when raw_role in ('foreman', 'crewlead') then 'crew_lead'
    when raw_role in ('teammember', 'employee', 'mechanic', 'operator', 'field', 'fieldstaff', 'laborer', 'labourer', 'technician') then 'team_member'
    else null
  end;

  if new.role is null or new.legacy_permission_profile is null then
    raise exception 'Unsupported Groundwork Pro team role';
  end if;
  return new;
end
$$;

alter table public.memberships enable trigger memberships_canonicalize_team_role;
alter table public.employees enable trigger employees_canonicalize_team_role;
alter table public.pending_invitations enable trigger pending_invitations_canonicalize_team_role;
alter table public.invite_tokens enable trigger invite_tokens_canonicalize_team_role;

create or replace function public.enforce_primary_owner_membership()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  company_owner uuid;
begin
  if tg_op = 'DELETE' then
    -- Trusted server workflows may remove an entire disposable bootstrap
    -- company while an invited user joins their real workspace. Normal users
    -- and all request-scoped clients remain locked.
    if auth.role() = 'service_role' then
      return old;
    end if;
    select primary_owner_user_id into company_owner
    from public.companies
    where id = old.company_id;
    if old.user_id = company_owner then
      raise exception 'Primary owner membership cannot be deleted; use ownership transfer';
    end if;
    return old;
  end if;

  select primary_owner_user_id into company_owner
  from public.companies
  where id = new.company_id;

  if new.role = 'owner' and new.user_id is distinct from company_owner then
    raise exception 'Only the company primary owner may have the Owner role';
  end if;
  if new.user_id = company_owner and new.role <> 'owner' then
    raise exception 'Primary owner role is locked; use ownership transfer';
  end if;
  return new;
end
$$;

drop trigger if exists memberships_enforce_primary_owner on public.memberships;
create trigger memberships_enforce_primary_owner
before insert or update of company_id, user_id, role on public.memberships
for each row execute function public.enforce_primary_owner_membership();

drop trigger if exists memberships_protect_primary_owner_delete on public.memberships;
create trigger memberships_protect_primary_owner_delete
before delete on public.memberships
for each row execute function public.enforce_primary_owner_membership();

create or replace function public.lock_primary_owner_transfer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.primary_owner_user_id is distinct from old.primary_owner_user_id then
    raise exception 'Use the dedicated ownership transfer workflow';
  end if;
  return new;
end
$$;

drop trigger if exists companies_lock_primary_owner_transfer on public.companies;
create trigger companies_lock_primary_owner_transfer
before update of primary_owner_user_id on public.companies
for each row execute function public.lock_primary_owner_transfer();

alter table public.module_permission_templates
  drop constraint if exists module_permission_templates_role_check;

insert into public.module_permission_templates (role, module_key, access_level)
select 'co_owner', module_key, access_level
from public.module_permission_templates
where role = 'owner'
on conflict (role, module_key) do update set access_level = excluded.access_level;

alter table public.module_permission_templates
  add constraint module_permission_templates_role_check
  check (role in (
    'owner', 'co_owner', 'administrator', 'manager', 'crew_lead', 'team_member',
    'ceo', 'foreman', 'mechanic', 'operator', 'fieldstaff'
  ));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.memberships m
      where m.company_id = notifications.company_id
        and m.user_id = auth.uid()
        and lower(m.role) in ('owner', 'co_owner', 'admin', 'executive', 'ceo')
    )
  );
