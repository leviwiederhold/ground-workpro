create table if not exists public.safety_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  occurred_on date not null,
  summary text not null,
  severity text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists safety_logs_company_id_idx
  on public.safety_logs(company_id);

create index if not exists safety_logs_occurred_on_desc_idx
  on public.safety_logs(occurred_on desc);

create index if not exists safety_logs_company_occurred_on_desc_idx
  on public.safety_logs(company_id, occurred_on desc);

alter table public.safety_logs enable row level security;

do $$ begin
  create policy "safety_logs_select_company"
    on public.safety_logs
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "safety_logs_insert_company"
    on public.safety_logs
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "safety_logs_update_company"
    on public.safety_logs
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "safety_logs_delete_company"
    on public.safety_logs
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
