create table if not exists public.safety_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  safety_log_id uuid not null references public.safety_logs(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  title text not null,
  description text null,
  owner_employee_id uuid null references public.employees(id) on delete set null,
  due_date date null,
  status text not null default 'open' check (status in ('open','in_progress','closed')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  closed_at timestamptz null,
  closed_by uuid null,
  closure_notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  topic text not null,
  summary text null,
  occurred_on date not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.toolbox_talk_attendees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  toolbox_talk_id uuid not null references public.toolbox_talks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  acknowledged_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (company_id, toolbox_talk_id, employee_id)
);

create index if not exists safety_actions_company_status_due_idx
  on public.safety_actions(company_id, status, due_date);
create index if not exists safety_actions_company_log_idx
  on public.safety_actions(company_id, safety_log_id);
create index if not exists safety_actions_company_owner_idx
  on public.safety_actions(company_id, owner_employee_id);

create index if not exists toolbox_talks_company_occurred_idx
  on public.toolbox_talks(company_id, occurred_on desc);
create index if not exists toolbox_talks_company_job_occurred_idx
  on public.toolbox_talks(company_id, job_id, occurred_on desc);

create index if not exists toolbox_talk_attendees_company_talk_idx
  on public.toolbox_talk_attendees(company_id, toolbox_talk_id);
create index if not exists toolbox_talk_attendees_company_employee_idx
  on public.toolbox_talk_attendees(company_id, employee_id);

alter table public.safety_actions enable row level security;
alter table public.toolbox_talks enable row level security;
alter table public.toolbox_talk_attendees enable row level security;

do $$ begin
  create policy "safety_actions_select_company"
    on public.safety_actions
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "safety_actions_insert_company"
    on public.safety_actions
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "safety_actions_update_company"
    on public.safety_actions
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "safety_actions_delete_company"
    on public.safety_actions
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talks_select_company"
    on public.toolbox_talks
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talks_insert_company"
    on public.toolbox_talks
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talks_update_company"
    on public.toolbox_talks
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talks_delete_company"
    on public.toolbox_talks
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talk_attendees_select_company"
    on public.toolbox_talk_attendees
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talk_attendees_insert_company"
    on public.toolbox_talk_attendees
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talk_attendees_update_company"
    on public.toolbox_talk_attendees
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "toolbox_talk_attendees_delete_company"
    on public.toolbox_talk_attendees
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
