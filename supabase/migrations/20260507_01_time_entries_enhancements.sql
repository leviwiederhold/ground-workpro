alter table if exists public.time_entries
  add column if not exists duration_minutes integer,
  add column if not exists status text not null default 'active',
  add column if not exists job_id uuid,
  add column if not exists notes text,
  add column if not exists edited_by uuid,
  add column if not exists edited_at timestamptz;

update public.time_entries
set status = case when clock_out_at is null then 'active' else coalesce(nullif(status, ''), 'completed') end
where status is null or status = '';

create index if not exists idx_time_entries_status on public.time_entries(company_id, status);
