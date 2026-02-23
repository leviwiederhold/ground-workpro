create table if not exists public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  date date not null,
  employee_id uuid references public.employees(id) on delete set null,
  equipment_id uuid references public.equipment(id) on delete set null,
  notes text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists schedule_assignments_company_date_idx
  on public.schedule_assignments (company_id, date);

create index if not exists schedule_assignments_company_job_date_idx
  on public.schedule_assignments (company_id, job_id, date);

create index if not exists schedule_assignments_company_employee_date_idx
  on public.schedule_assignments (company_id, employee_id, date);

create index if not exists schedule_assignments_company_equipment_date_idx
  on public.schedule_assignments (company_id, equipment_id, date);

alter table public.schedule_assignments enable row level security;

drop policy if exists schedule_assignments_select on public.schedule_assignments;
create policy schedule_assignments_select
  on public.schedule_assignments
  for select
  using (public.is_company_member(company_id));

drop policy if exists schedule_assignments_insert on public.schedule_assignments;
create policy schedule_assignments_insert
  on public.schedule_assignments
  for insert
  with check (public.is_company_member(company_id));

drop policy if exists schedule_assignments_update on public.schedule_assignments;
create policy schedule_assignments_update
  on public.schedule_assignments
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists schedule_assignments_delete on public.schedule_assignments;
create policy schedule_assignments_delete
  on public.schedule_assignments
  for delete
  using (public.is_company_member(company_id));
