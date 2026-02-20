create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  alert_type text not null,
  title text not null,
  message text not null,
  entity_type text not null,
  entity_id text,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists alerts_company_dedupe_key_idx
  on public.alerts (company_id, dedupe_key);

create index if not exists alerts_company_created_at_idx
  on public.alerts (company_id, created_at desc);

create index if not exists alerts_company_is_read_idx
  on public.alerts (company_id, is_read);

alter table if exists public.alerts
  add constraint alerts_alert_type_check
  check (alert_type in ('low_inventory', 'overdue_maintenance'));

alter table if exists public.alerts
  add constraint alerts_entity_type_check
  check (entity_type in ('inventory', 'work_order', 'equipment'));

create or replace function public.set_alerts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_alerts_updated_at on public.alerts;
create trigger set_alerts_updated_at
before update on public.alerts
for each row
execute procedure public.set_alerts_updated_at();

alter table if exists public.alerts enable row level security;

drop policy if exists alerts_select on public.alerts;
create policy alerts_select
  on public.alerts
  for select
  using (public.is_company_member(company_id));

drop policy if exists alerts_insert on public.alerts;
create policy alerts_insert
  on public.alerts
  for insert
  with check (public.is_company_member(company_id));

drop policy if exists alerts_update on public.alerts;
create policy alerts_update
  on public.alerts
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists alerts_delete on public.alerts;
create policy alerts_delete
  on public.alerts
  for delete
  using (public.is_company_member(company_id));
