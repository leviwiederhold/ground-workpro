create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  company_id uuid references public.companies(id) on delete set null,
  idempotency_key text,
  headers_hash text not null,
  body_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webhook_events_provider_received_idx
  on public.webhook_events(provider, received_at desc);

create index if not exists webhook_events_company_received_idx
  on public.webhook_events(company_id, received_at desc);

create index if not exists webhook_events_status_idx
  on public.webhook_events(status);

create unique index if not exists webhook_events_provider_idempotency_key
  on public.webhook_events(provider, idempotency_key)
  where idempotency_key is not null;

alter table public.webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'webhook_events'
      and policyname = 'webhook_events_select_company'
  ) then
    create policy "webhook_events_select_company"
      on public.webhook_events
      for select
      using (
        company_id is not null and public.is_company_member(company_id)
      );
  end if;
end
$$;
