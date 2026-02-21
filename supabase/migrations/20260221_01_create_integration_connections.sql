create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  connected boolean not null default false,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists integration_connections_company_provider_key
  on public.integration_connections(company_id, provider);

create index if not exists integration_connections_company_idx
  on public.integration_connections(company_id);

create index if not exists integration_connections_provider_idx
  on public.integration_connections(provider);

alter table public.integration_connections enable row level security;

do $$ begin
  create policy "integration_connections_select_company"
    on public.integration_connections
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "integration_connections_insert_company"
    on public.integration_connections
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "integration_connections_update_company"
    on public.integration_connections
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "integration_connections_delete_company"
    on public.integration_connections
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
