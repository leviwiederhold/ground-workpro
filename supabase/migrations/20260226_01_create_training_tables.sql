create table if not exists public.training_courses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  category text not null,
  duration_minutes integer not null default 0,
  video_url text,
  thumbnail_url text,
  required boolean not null default false,
  due_date date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id uuid not null references public.training_courses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  due_date date,
  required boolean not null default false,
  unique (company_id, course_id, employee_id)
);

create table if not exists public.training_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  course_id uuid not null references public.training_courses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, course_id, employee_id)
);

create index if not exists training_courses_company_created_idx
  on public.training_courses(company_id, created_at desc);

create index if not exists training_assignments_company_course_idx
  on public.training_assignments(company_id, course_id);

create index if not exists training_assignments_company_employee_idx
  on public.training_assignments(company_id, employee_id);

create index if not exists training_progress_company_course_idx
  on public.training_progress(company_id, course_id);

create index if not exists training_progress_company_employee_idx
  on public.training_progress(company_id, employee_id);

alter table public.training_courses enable row level security;
alter table public.training_assignments enable row level security;
alter table public.training_progress enable row level security;

do $$ begin
  create policy "training_courses_select_company"
    on public.training_courses
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_courses_insert_company"
    on public.training_courses
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_courses_update_company"
    on public.training_courses
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_courses_delete_company"
    on public.training_courses
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_assignments_select_company"
    on public.training_assignments
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_assignments_insert_company"
    on public.training_assignments
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_assignments_update_company"
    on public.training_assignments
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_assignments_delete_company"
    on public.training_assignments
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_progress_select_company"
    on public.training_progress
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_progress_insert_company"
    on public.training_progress
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_progress_update_company"
    on public.training_progress
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_progress_delete_company"
    on public.training_progress
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
