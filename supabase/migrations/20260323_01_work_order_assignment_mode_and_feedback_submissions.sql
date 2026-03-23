alter table public.work_orders
  add column if not exists assignment_mode text not null default 'in_house';

alter table public.work_orders
  drop constraint if exists work_orders_assignment_mode_check;

alter table public.work_orders
  add constraint work_orders_assignment_mode_check
  check (assignment_mode in ('in_house', 'outsourced'));

update public.work_orders
set assignment_mode = 'in_house'
where assignment_mode is null
   or assignment_mode not in ('in_house', 'outsourced');

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('bug', 'feature_request', 'general_feedback')),
  message text not null,
  name text null,
  email text null,
  page text null,
  current_view text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_submissions_company_created_at
  on public.feedback_submissions (company_id, created_at desc);

alter table public.feedback_submissions enable row level security;

drop policy if exists feedback_submissions_insert_own on public.feedback_submissions;
drop policy if exists feedback_submissions_select_own on public.feedback_submissions;

do $$ begin
  create policy feedback_submissions_insert_own
    on public.feedback_submissions
    for insert
    with check (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy feedback_submissions_select_own
    on public.feedback_submissions
    for select
    using (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    );
exception when duplicate_object then null; end $$;
