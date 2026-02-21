create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  aggregate_type text,
  aggregate_id text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbox_events_company_status_run_idx
  on public.outbox_events(company_id, status, run_at, created_at);

create index if not exists outbox_events_company_created_idx
  on public.outbox_events(company_id, created_at);

create unique index if not exists outbox_events_company_idempotency_key_key
  on public.outbox_events(company_id, idempotency_key)
  where idempotency_key is not null;

alter table public.outbox_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'outbox_events'
      and policyname = 'outbox_events_select_company'
  ) then
    create policy "outbox_events_select_company"
      on public.outbox_events
      for select
      using (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'outbox_events'
      and policyname = 'outbox_events_insert_company'
  ) then
    create policy "outbox_events_insert_company"
      on public.outbox_events
      for insert
      with check (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'outbox_events'
      and policyname = 'outbox_events_update_company'
  ) then
    create policy "outbox_events_update_company"
      on public.outbox_events
      for update
      using (public.is_company_member(company_id))
      with check (public.is_company_member(company_id));
  end if;
end
$$;
