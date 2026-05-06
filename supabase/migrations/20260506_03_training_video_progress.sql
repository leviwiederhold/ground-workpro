create table if not exists public.training_video_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  training_video_id uuid not null references public.training_courses(id) on delete cascade,
  watched_segments jsonb not null default '[]'::jsonb,
  watched_seconds numeric not null default 0,
  duration_seconds numeric not null default 0,
  completion_percent numeric not null default 0,
  last_position_seconds numeric not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, training_video_id)
);

create index if not exists training_video_progress_company_video_idx
  on public.training_video_progress (company_id, training_video_id);

create index if not exists training_video_progress_company_user_idx
  on public.training_video_progress (company_id, user_id);

alter table public.training_video_progress enable row level security;

do $$ begin
  create policy "training_video_progress_select_company"
    on public.training_video_progress
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_video_progress_insert_self"
    on public.training_video_progress
    for insert
    with check (public.is_company_member(company_id) and user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "training_video_progress_update_self"
    on public.training_video_progress
    for update
    using (public.is_company_member(company_id) and user_id = auth.uid())
    with check (public.is_company_member(company_id) and user_id = auth.uid());
exception when duplicate_object then null; end $$;
