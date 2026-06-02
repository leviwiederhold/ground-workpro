-- ============================================================================
-- Fix: "Failed to delete user: Database error deleting user"
--
-- Cause: several public tables hold foreign keys to auth.users(id) that were
-- created with the default ON DELETE NO ACTION (RESTRICT). When an auth user is
-- deleted from the dashboard, those dependent rows block the delete.
--
-- This migration:
--   1. Rewrites EVERY single-column public FK referencing auth.users(id) to a
--      safe ON DELETE action — without needing to know the constraint names:
--        * "actor / creator / owner-audit" columns  -> ON DELETE SET NULL
--          (created_by, actor_user_id, owner_user_id, accepted_user_id, invited_by)
--          (only when the column is nullable; otherwise CASCADE)
--        * everything else (identity & per-user rows) -> ON DELETE CASCADE
--          (profiles.id, memberships.user_id, employees.user_id, notifications,
--           time_entries, module_permissions.user_id, messages, channel members,
--           dm threads, training progress, onboarding rows, etc.)
--   2. Adds a guard so a user who still OWNS an active company (admin membership
--      on an active/trialing company) cannot be deleted until ownership is
--      transferred or the subscription ends.
--
-- Idempotent: safe to run multiple times. Only touches schema `public`
-- (auth/storage/realtime system constraints are left untouched).
--
-- Does NOT touch Stripe/billing logic, the invite flow, or auth providers.
-- ============================================================================

-- 1. Normalize all public -> auth.users foreign keys -------------------------
do $$
declare
  r record;
  v_action text;
  v_is_nullable boolean;
  setnull_cols constant text[] :=
    array['created_by', 'actor_user_id', 'owner_user_id', 'accepted_user_id', 'invited_by'];
begin
  for r in
    select
      con.conname              as conname,
      ns.nspname               as schema_name,
      cl.relname               as table_name,
      att.attname              as col_name,
      con.confdeltype          as del_type
    from pg_constraint con
    join pg_class cl       on cl.oid = con.conrelid
    join pg_namespace ns   on ns.oid = cl.relnamespace
    join pg_attribute att  on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'auth.users'::regclass
      and array_length(con.conkey, 1) = 1
      and ns.nspname = 'public'
  loop
    -- Is the referencing column nullable?
    select a.attnotnull = false into v_is_nullable
    from pg_attribute a
    where a.attrelid = format('%I.%I', r.schema_name, r.table_name)::regclass
      and a.attname = r.col_name;

    -- Decide the desired ON DELETE action.
    if r.col_name = any(setnull_cols) and coalesce(v_is_nullable, false) then
      v_action := 'set null';
    else
      v_action := 'cascade';
    end if;

    -- Skip if it already has the desired action ('c' = cascade, 'n' = set null).
    if (v_action = 'cascade' and r.del_type = 'c')
       or (v_action = 'set null' and r.del_type = 'n') then
      continue;
    end if;

    -- Drop and recreate the FK with the correct action.
    execute format('alter table %I.%I drop constraint %I',
                   r.schema_name, r.table_name, r.conname);
    execute format(
      'alter table %I.%I add constraint %I foreign key (%I) references auth.users(id) on delete %s',
      r.schema_name, r.table_name, r.conname, r.col_name, v_action
    );

    raise notice 'FK %.% (%) -> on delete %', r.table_name, r.col_name, r.conname, v_action;
  end loop;
end $$;


-- 2. Protect active company owners from deletion ----------------------------
-- Ownership in this schema is expressed by a membership with an admin/ceo role
-- (companies has no owner column). A user may not be deleted while they are an
-- admin of a company whose subscription is active or trialing.
create or replace function public.prevent_active_company_owner_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_name text;
begin
  select c.name
    into v_company_name
  from public.memberships m
  join public.companies c on c.id = m.company_id
  where m.user_id = old.id
    and lower(coalesce(m.role, '')) in ('admin', 'ceo', 'executive', 'owner')
    and lower(coalesce(c.subscription_status, '')) in ('active', 'trialing')
  limit 1;

  if v_company_name is not null then
    raise exception
      'Cannot delete user %: they still own an active company (%). Transfer ownership or cancel the subscription first.',
      old.id, v_company_name
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_active_company_owner_deletion on auth.users;
create trigger trg_prevent_active_company_owner_deletion
  before delete on auth.users
  for each row
  execute function public.prevent_active_company_owner_deletion();
