create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.inventory(id) on delete cascade,
  type text not null check (type in ('receive', 'issue', 'adjust', 'transfer')),
  qty numeric not null default 0,
  unit_cost numeric not null default 0,
  from_location text,
  to_location text,
  job_id uuid references public.jobs(id) on delete set null,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_transactions_company_item_created
  on public.inventory_transactions (company_id, item_id, created_at desc);

create index if not exists idx_inventory_transactions_company_created
  on public.inventory_transactions (company_id, created_at desc);

create index if not exists idx_inventory_transactions_company_job
  on public.inventory_transactions (company_id, job_id);

alter table if exists public.inventory_transactions enable row level security;

drop policy if exists inventory_transactions_select on public.inventory_transactions;
create policy inventory_transactions_select
  on public.inventory_transactions
  for select
  using (public.is_company_member(company_id));

drop policy if exists inventory_transactions_insert on public.inventory_transactions;
create policy inventory_transactions_insert
  on public.inventory_transactions
  for insert
  with check (public.is_company_member(company_id));

drop policy if exists inventory_transactions_update on public.inventory_transactions;
create policy inventory_transactions_update
  on public.inventory_transactions
  for update
  using (false)
  with check (false);

drop policy if exists inventory_transactions_delete on public.inventory_transactions;
create policy inventory_transactions_delete
  on public.inventory_transactions
  for delete
  using (false);
