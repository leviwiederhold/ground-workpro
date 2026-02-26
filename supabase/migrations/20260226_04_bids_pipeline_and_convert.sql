alter table public.bids
  add column if not exists stage text not null default 'estimating',
  add column if not exists owner_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists due_date date null,
  add column if not exists review_ready_at timestamptz null,
  add column if not exists review_approved_at timestamptz null,
  add column if not exists converted_job_id uuid null references public.jobs(id) on delete set null,
  add column if not exists converted_at timestamptz null;

do $$ begin
  alter table public.bids
    add constraint bids_stage_check check (stage in ('lead','qualified','estimating','review','won','lost'));
exception when duplicate_object then null; end $$;

create index if not exists bids_company_stage_idx on public.bids(company_id, stage);
create index if not exists bids_company_owner_idx on public.bids(company_id, owner_user_id);
create index if not exists bids_company_due_date_idx on public.bids(company_id, due_date);
