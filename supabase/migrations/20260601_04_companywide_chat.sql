-- ============================================================================
-- Companywide chat: one permanent, default group thread per company that always
-- contains every active member. Reuses the existing group-thread model (kind =
-- 'group') so all group RLS/UI applies; flagged with is_companywide.
--
-- - Exactly one per company (partial unique index + ON CONFLICT).
-- - Auto-synced participants = active members (membership minus inactive/
--   deleted/archived/removed employees), via triggers on memberships + employees.
-- - Cannot be deleted (BEFORE DELETE guard).
-- - Isolated per company (company_id scoping + existing participant RLS).
-- ============================================================================

-- 1. Flag column ------------------------------------------------------------
alter table public.message_threads
  add column if not exists is_companywide boolean not null default false;

-- 2. The companywide thread is a group with no DM pair — relax NOT NULL so it
--    can have null dm_user_a/dm_user_b. (direct/group threads still set them.)
alter table public.message_threads alter column dm_user_a drop not null;
alter table public.message_threads alter column dm_user_b drop not null;

-- 3. Exactly one companywide thread per company.
create unique index if not exists message_threads_one_companywide_per_company
  on public.message_threads (company_id)
  where is_companywide;

-- 4. Idempotent: create the companywide thread (if missing) and reconcile its
--    participants to the company's current active members.
create or replace function public.ensure_companywide_thread(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
  v_owner uuid;
begin
  if p_company_id is null then
    return null;
  end if;

  -- Creator: prefer an admin/owner membership, else any member.
  select user_id
    into v_owner
  from public.memberships
  where company_id = p_company_id
    and user_id is not null
  order by
    case when lower(coalesce(role, '')) in ('admin', 'ceo', 'executive', 'owner') then 0 else 1 end,
    created_at asc
  limit 1;

  if v_owner is null then
    -- No members yet; nothing to attach a thread to.
    return null;
  end if;

  -- Create the thread atomically (partial unique index guards against dupes
  -- under concurrent opens).
  insert into public.message_threads
    (company_id, kind, type, name, is_companywide, dm_user_a, dm_user_b, created_by)
  values
    (p_company_id, 'group', 'group', 'Companywide', true, null, null, v_owner)
  on conflict (company_id) where is_companywide do nothing;

  select id into v_thread_id
  from public.message_threads
  where company_id = p_company_id and is_companywide
  limit 1;

  if v_thread_id is null then
    return null;
  end if;

  -- Add every active member who isn't already a participant.
  insert into public.message_participants (company_id, thread_id, user_id)
  select p_company_id, v_thread_id, m.user_id
  from public.memberships m
  where m.company_id = p_company_id
    and m.user_id is not null
    and not exists (
      select 1 from public.employees e
      where e.company_id = p_company_id and e.user_id = m.user_id
        and lower(coalesce(e.status, '')) in ('inactive', 'deleted', 'archived', 'removed')
    )
    and not exists (
      select 1 from public.message_participants p
      where p.company_id = p_company_id and p.thread_id = v_thread_id and p.user_id = m.user_id
    )
  group by m.user_id;

  -- Remove participants who are no longer active members.
  delete from public.message_participants p
  where p.company_id = p_company_id
    and p.thread_id = v_thread_id
    and (
      not exists (
        select 1 from public.memberships m
        where m.company_id = p_company_id and m.user_id = p.user_id
      )
      or exists (
        select 1 from public.employees e
        where e.company_id = p_company_id and e.user_id = p.user_id
          and lower(coalesce(e.status, '')) in ('inactive', 'deleted', 'archived', 'removed')
      )
    );

  return v_thread_id;
end;
$$;

-- 5. Keep participants in sync automatically on member/employee changes.
create or replace function public.trg_sync_companywide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if tg_op = 'DELETE' then
    v_company := old.company_id;
  else
    v_company := new.company_id;
  end if;
  if v_company is not null then
    perform public.ensure_companywide_thread(v_company);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists memberships_companywide_sync on public.memberships;
create trigger memberships_companywide_sync
  after insert or delete on public.memberships
  for each row execute function public.trg_sync_companywide();

drop trigger if exists employees_companywide_sync on public.employees;
create trigger employees_companywide_sync
  after insert or update of status, user_id or delete on public.employees
  for each row execute function public.trg_sync_companywide();

-- 6. The Companywide chat cannot be deleted.
create or replace function public.prevent_companywide_thread_delete()
returns trigger
language plpgsql
as $$
begin
  if old.is_companywide then
    raise exception 'The Companywide chat is permanent and cannot be deleted.';
  end if;
  return old;
end;
$$;

drop trigger if exists message_threads_block_companywide_delete on public.message_threads;
create trigger message_threads_block_companywide_delete
  before delete on public.message_threads
  for each row execute function public.prevent_companywide_thread_delete();

-- 7. Backfill: ensure every existing company has its companywide thread + members.
do $$
declare
  c record;
begin
  for c in select id from public.companies loop
    perform public.ensure_companywide_thread(c.id);
  end loop;
end;
$$;
