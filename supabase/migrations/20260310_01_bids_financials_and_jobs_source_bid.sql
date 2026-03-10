alter table public.bids
  add column if not exists actual_job_cost numeric not null default 0,
  add column if not exists revenue numeric not null default 0,
  add column if not exists profit numeric not null default 0,
  add column if not exists margin numeric not null default 0;

update public.bids
set
  revenue = coalesce(revenue, total, total_amount, amount, 0),
  actual_job_cost = coalesce(actual_job_cost, subtotal, 0),
  profit = coalesce(revenue, total, total_amount, amount, 0) - coalesce(actual_job_cost, subtotal, 0),
  margin = case
    when coalesce(revenue, total, total_amount, amount, 0) > 0
      then (coalesce(revenue, total, total_amount, amount, 0) - coalesce(actual_job_cost, subtotal, 0))
        / coalesce(revenue, total, total_amount, amount, 0)
    else 0
  end;

do $$
declare
  bids_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into bids_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'bids'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if bids_id_type is null then
    bids_id_type := 'uuid';
  end if;

  execute format(
    'alter table public.jobs add column if not exists source_bid_id %s',
    bids_id_type
  );
end $$;

do $$ begin
  alter table public.jobs
    add constraint jobs_source_bid_id_fkey
    foreign key (source_bid_id) references public.bids(id) on delete set null;
exception
  when duplicate_object then null;
  when undefined_table then null;
  when undefined_column then null;
  when datatype_mismatch then null;
end $$;

create index if not exists jobs_company_source_bid_idx on public.jobs(company_id, source_bid_id);
