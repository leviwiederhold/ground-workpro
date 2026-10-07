-- Company employee removal is a single transaction so a failed membership or
-- permission delete cannot leave an employee row and account access divergent.
-- The API performs the caller's module authorization before invoking this
-- service-role-only function.
create or replace function public.remove_company_employee(
  p_company_id uuid,
  p_employee_id text,
  p_actor_user_id uuid
)
returns table (linked_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid;
begin
  if p_company_id is null or p_employee_id is null or p_actor_user_id is null then
    raise exception 'Company, employee, and authorized actor are required';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = p_actor_user_id
  ) then
    raise exception 'Actor is not a member of this company';
  end if;

  select e.user_id into target_user_id
  from public.employees e
  where e.company_id = p_company_id and e.id::text = p_employee_id
  for update;

  if not found then
    raise exception 'Employee not found';
  end if;

  if target_user_id is not null and exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.primary_owner_user_id = target_user_id
  ) then
    raise exception 'Primary owner cannot be removed';
  end if;

  delete from public.employees e
  where e.company_id = p_company_id and e.id::text = p_employee_id;

  if target_user_id is not null then
    delete from public.module_permissions mp
    where mp.company_id = p_company_id and mp.user_id = target_user_id;
    delete from public.memberships m
    where m.company_id = p_company_id and m.user_id = target_user_id;
  end if;

  return query select target_user_id;
end;
$$;

revoke all on function public.remove_company_employee(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.remove_company_employee(uuid, text, uuid) to service_role;

-- Let signed-in users receive their own authoritative role changes immediately.
-- Membership RLS still limits rows visible over Realtime; the app subscribes to
-- its user_id only and refetches /api/nav after any matching update.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'memberships'
     ) then
    alter publication supabase_realtime add table public.memberships;
  end if;
end;
$$;

-- Enforce account deletion blockers at the database boundary too. API checks
-- provide clear messages; this trigger protects Auth deletion from alternate
-- server paths and concurrent membership/history creation.
create or replace function public.prevent_unsafe_auth_user_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_legacy_message boolean;
begin
  if exists (select 1 from public.companies c where c.primary_owner_user_id = old.id) then
    raise exception 'Cannot delete a primary company owner';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = old.id) then
    raise exception 'Cannot delete an account with company memberships';
  end if;
  if exists (select 1 from public.messages m where m.sender_user_id = old.id) then
    raise exception 'Cannot delete an account with retained message history';
  end if;
  if to_regclass('public.legacy_messages') is not null then
    execute 'select exists (select 1 from public.legacy_messages m where m.sender_user_id = $1)'
      into has_legacy_message using old.id;
    if has_legacy_message then
      raise exception 'Cannot delete an account with retained legacy message history';
    end if;
  end if;
  if exists (select 1 from public.message_participants p where p.user_id = old.id) then
    raise exception 'Cannot delete an account referenced by message history';
  end if;
  if exists (select 1 from public.message_threads t where old.id in (t.created_by, t.dm_user_a, t.dm_user_b)) then
    raise exception 'Cannot delete an account referenced by message threads';
  end if;
  if exists (select 1 from public.time_entries t where t.user_id = old.id) then
    raise exception 'Cannot delete an account with retained time history';
  end if;
  if exists (
    select 1 from public.profiles p where p.id = old.id and nullif(trim(p.avatar_url), '') is not null
  ) then
    raise exception 'Remove the profile avatar before deleting this account';
  end if;
  if exists (select 1 from storage.objects o where o.owner_id = old.id::text) then
    raise exception 'Remove user-owned storage files before deleting this account';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_unsafe_auth_user_deletion() from public, anon, authenticated;

drop trigger if exists trg_prevent_unsafe_auth_user_deletion on auth.users;
create trigger trg_prevent_unsafe_auth_user_deletion
  before delete on auth.users
  for each row execute function public.prevent_unsafe_auth_user_deletion();
