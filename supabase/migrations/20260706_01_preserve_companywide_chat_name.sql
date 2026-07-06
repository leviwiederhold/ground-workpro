-- Preserve custom companywide chat names.
-- The sync helper should create the permanent thread when missing and reconcile
-- participants, but it must never overwrite a saved thread name on refresh.

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
    return null;
  end if;

  insert into public.message_threads
    (company_id, kind, type, name, is_companywide, dm_user_a, dm_user_b, created_by)
  values
    (p_company_id, 'group', 'group', null, true, null, null, v_owner)
  on conflict (company_id) where is_companywide do nothing;

  select id into v_thread_id
  from public.message_threads
  where company_id = p_company_id and is_companywide
  limit 1;

  if v_thread_id is null then
    return null;
  end if;

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
