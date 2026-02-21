create table if not exists public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  scopes text[] not null default '{}',
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_credentials_company_provider_key unique (company_id, provider)
);

create index if not exists provider_credentials_company_idx
  on public.provider_credentials(company_id);

create index if not exists provider_credentials_provider_idx
  on public.provider_credentials(provider);

alter table public.provider_credentials enable row level security;

do $$ begin
  create policy "provider_credentials_select_company"
    on public.provider_credentials
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "provider_credentials_insert_company"
    on public.provider_credentials
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "provider_credentials_update_company"
    on public.provider_credentials
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "provider_credentials_delete_company"
    on public.provider_credentials
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
