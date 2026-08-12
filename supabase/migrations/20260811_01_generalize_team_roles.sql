-- Canonical application roles are intentionally separate from job titles.
-- legacy_permission_profile is an internal transition field: it preserves the
-- exact authorization behavior of the former specialized roles while current
-- clients display only Owner / Administrator / Manager / Crew Lead / Team Member.

alter table public.memberships
  add column if not exists legacy_permission_profile text;
alter table public.employees
  add column if not exists legacy_permission_profile text;
alter table public.pending_invitations
  add column if not exists legacy_permission_profile text;
alter table public.invite_tokens
  add column if not exists legacy_permission_profile text;

comment on column public.memberships.legacy_permission_profile is
  'Internal authorization compatibility profile; never use as a job title or user-facing role.';
comment on column public.employees.legacy_permission_profile is
  'Internal authorization compatibility profile; never use as a job title or user-facing role.';
comment on column public.pending_invitations.legacy_permission_profile is
  'Internal authorization compatibility profile captured when the invitation is created.';
comment on column public.invite_tokens.legacy_permission_profile is
  'Internal authorization compatibility profile for released-client invite compatibility.';

-- Existing constraint names predate migrations in this repository. Remove only
-- CHECK constraints explicitly named for role before rewriting the values.
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
    loop
      execute format('alter table %s drop constraint %I', target, constraint_row.conname);
    end loop;
  end loop;
end
$$;

-- Capture the old semantics before replacing role values. Administrator is a
-- new role, so it deliberately receives the existing PM/manager profile rather
-- than the former top-level admin profile.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['memberships', 'employees', 'pending_invitations', 'invite_tokens']
  loop
    execute format($sql$
      update public.%I
      set legacy_permission_profile = case
        when lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g')) in ('admin', 'executive', 'ceo', 'coceo', 'owner') then 'admin'
        when lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g')) in ('administrator', 'pm', 'manager', 'operations', 'operationsmanager', 'projectmanager') then 'pm'
        when lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g')) in ('foreman', 'crewlead') then 'foreman'
        when lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g')) = 'mechanic' then 'mechanic'
        when lower(regexp_replace(coalesce(role, ''), '[^a-z0-9]', '', 'g')) in ('field', 'fieldstaff') then 'fieldstaff'
        when role is not null then 'operator'
        else null
      end
      where legacy_permission_profile is null
    $sql$, table_name);

    execute format($sql$
      update public.%I
      set role = case
        when role is null then null
        when lower(regexp_replace(role, '[^a-z0-9]', '', 'g')) in ('admin', 'executive', 'ceo', 'coceo', 'owner') then 'owner'
        when lower(regexp_replace(role, '[^a-z0-9]', '', 'g')) = 'administrator' then 'administrator'
        when lower(regexp_replace(role, '[^a-z0-9]', '', 'g')) in ('pm', 'manager', 'operations', 'operationsmanager', 'projectmanager') then 'manager'
        when lower(regexp_replace(role, '[^a-z0-9]', '', 'g')) in ('foreman', 'crewlead') then 'crew_lead'
        else 'team_member'
      end
    $sql$, table_name);
  end loop;
end
$$;

alter table public.memberships
  add constraint memberships_canonical_role_check
  check (role in ('owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.memberships
  add constraint memberships_legacy_permission_profile_check
  check (legacy_permission_profile in ('admin', 'pm', 'foreman', 'mechanic', 'operator', 'fieldstaff'));

alter table public.employees
  add constraint employees_canonical_role_check
  check (role is null or role in ('owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.employees
  add constraint employees_legacy_permission_profile_check
  check (legacy_permission_profile is null or legacy_permission_profile in ('admin', 'pm', 'foreman', 'mechanic', 'operator', 'fieldstaff'));

alter table public.pending_invitations
  add constraint pending_invitations_canonical_role_check
  check (role in ('owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.pending_invitations
  add constraint pending_invitations_legacy_permission_profile_check
  check (legacy_permission_profile in ('admin', 'pm', 'foreman', 'mechanic', 'operator', 'fieldstaff'));

alter table public.invite_tokens
  add constraint invite_tokens_canonical_role_check
  check (role in ('owner', 'administrator', 'manager', 'crew_lead', 'team_member'));
alter table public.invite_tokens
  add constraint invite_tokens_legacy_permission_profile_check
  check (legacy_permission_profile in ('admin', 'pm', 'foreman', 'mechanic', 'operator', 'fieldstaff'));

-- Released clients may still submit legacy role values. Normalize those writes
-- before canonical constraints run so old TestFlight/native sessions continue to
-- work without allowing ambiguous values to persist.
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
      when raw_role in ('admin', 'executive', 'ceo', 'coceo', 'owner') then 'admin'
      when raw_role in ('administrator', 'pm', 'manager', 'operations', 'operationsmanager', 'projectmanager') then 'pm'
      when raw_role in ('foreman', 'crewlead') then 'foreman'
      when raw_role = 'mechanic' then 'mechanic'
      when raw_role in ('field', 'fieldstaff') then 'fieldstaff'
      when raw_role in ('teammember', 'employee', 'operator', 'laborer', 'labourer', 'technician') then 'operator'
      else null
    end;
  end if;

  new.role := case
    when raw_role in ('admin', 'executive', 'ceo', 'coceo', 'owner') then 'owner'
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

drop trigger if exists memberships_canonicalize_team_role on public.memberships;
create trigger memberships_canonicalize_team_role
before insert or update of role, legacy_permission_profile on public.memberships
for each row execute function public.canonicalize_groundwork_team_role();

drop trigger if exists employees_canonicalize_team_role on public.employees;
create trigger employees_canonicalize_team_role
before insert or update of role, legacy_permission_profile on public.employees
for each row execute function public.canonicalize_groundwork_team_role();

drop trigger if exists pending_invitations_canonicalize_team_role on public.pending_invitations;
create trigger pending_invitations_canonicalize_team_role
before insert or update of role, legacy_permission_profile on public.pending_invitations
for each row execute function public.canonicalize_groundwork_team_role();

drop trigger if exists invite_tokens_canonicalize_team_role on public.invite_tokens;
create trigger invite_tokens_canonicalize_team_role
before insert or update of role, legacy_permission_profile on public.invite_tokens
for each row execute function public.canonicalize_groundwork_team_role();

-- Current clients read only canonical templates. Legacy template rows remain as
-- an internal compatibility surface for released clients during the transition.
alter table public.module_permission_templates
  drop constraint if exists module_permission_templates_role_check;

insert into public.module_permission_templates (role, module_key, access_level)
select 'owner', module_key, access_level
from public.module_permission_templates
where role = 'ceo'
on conflict (role, module_key) do update set access_level = excluded.access_level;

insert into public.module_permission_templates (role, module_key, access_level)
select 'administrator', module_key, access_level
from public.module_permission_templates
where role = 'manager'
on conflict (role, module_key) do update set access_level = excluded.access_level;

insert into public.module_permission_templates (role, module_key, access_level)
select 'crew_lead', module_key, access_level
from public.module_permission_templates
where role = 'foreman'
on conflict (role, module_key) do update set access_level = excluded.access_level;

insert into public.module_permission_templates (role, module_key, access_level)
select 'team_member', module_key, access_level
from public.module_permission_templates
where role = 'operator'
on conflict (role, module_key) do update set access_level = excluded.access_level;

alter table public.module_permission_templates
  add constraint module_permission_templates_role_check
  check (role in (
    'owner', 'administrator', 'manager', 'crew_lead', 'team_member',
    'ceo', 'foreman', 'mechanic', 'operator', 'fieldstaff'
  ));

-- The original notifications policy named only legacy top-level values. Once
-- memberships are canonical, keep the same Owner read access to company
-- notifications. All other RLS policies are membership-scoped rather than
-- role-scoped and therefore need no role migration.
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
        and lower(m.role) in ('owner', 'admin', 'executive', 'ceo')
    )
  );
