create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  event_type text,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists action text,
  add column if not exists event_type text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb;

update public.audit_logs
set action = coalesce(action, event_type, 'unknown')
where action is null;

update public.audit_logs
set event_type = coalesce(event_type, action)
where event_type is null;

alter table public.audit_logs
  alter column action set not null;

create index if not exists audit_logs_company_created_idx
  on public.audit_logs(company_id, created_at desc);

create index if not exists audit_logs_action_idx
  on public.audit_logs(company_id, action, created_at desc);

alter table public.audit_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_select_company'
  ) then
    create policy "audit_logs_select_company"
      on public.audit_logs
      for select
      using (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_insert_company'
  ) then
    create policy "audit_logs_insert_company"
      on public.audit_logs
      for insert
      with check (public.is_company_member(company_id));
  end if;
end
$$;
