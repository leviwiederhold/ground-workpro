create table if not exists public.bg_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bg_jobs_dlq (
  id uuid primary key default gen_random_uuid(),
  bg_job_id uuid,
  type text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text,
  failed_at timestamptz not null default now()
);

create index if not exists bg_jobs_company_status_run_at_idx
  on public.bg_jobs(company_id, status, run_at);

create index if not exists bg_jobs_dlq_company_failed_at_idx
  on public.bg_jobs_dlq(company_id, failed_at desc);

alter table public.bg_jobs enable row level security;
alter table public.bg_jobs_dlq enable row level security;

do $$ begin
  create policy "bg_jobs_select_company"
    on public.bg_jobs
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bg_jobs_insert_company"
    on public.bg_jobs
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bg_jobs_update_company"
    on public.bg_jobs
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bg_jobs_delete_company"
    on public.bg_jobs
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bg_jobs_dlq_select_company"
    on public.bg_jobs_dlq
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bg_jobs_dlq_insert_company"
    on public.bg_jobs_dlq
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

create or replace function public.claim_bg_jobs(p_company_id uuid, p_limit integer)
returns setof public.bg_jobs
language sql
as $$
  with picked as (
    select j.id
    from public.bg_jobs j
    where j.company_id = p_company_id
      and j.status = 'queued'
      and j.run_at <= now()
    order by j.run_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 1), 1)
  ),
  updated as (
    update public.bg_jobs j
    set
      status = 'processing',
      attempts = j.attempts + 1,
      updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*
  )
  select * from updated;
$$;
