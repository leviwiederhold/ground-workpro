create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_clock_order_check check (
    clock_out_at is null or clock_out_at >= clock_in_at
  )
);

create index if not exists idx_time_entries_company_user_clock_in
  on public.time_entries (company_id, user_id, clock_in_at desc);

create index if not exists idx_time_entries_company_user_clock_out
  on public.time_entries (company_id, user_id, clock_out_at);

create unique index if not exists uq_time_entries_active_shift_per_user
  on public.time_entries (company_id, user_id)
  where clock_out_at is null;

create or replace function public.set_time_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_time_entries_updated_at on public.time_entries;
create trigger set_time_entries_updated_at
before update on public.time_entries
for each row
execute procedure public.set_time_entries_updated_at();

alter table public.time_entries enable row level security;

drop policy if exists time_entries_select_own on public.time_entries;
drop policy if exists time_entries_insert_own on public.time_entries;
drop policy if exists time_entries_update_own on public.time_entries;
drop policy if exists time_entries_delete_own on public.time_entries;

do $$ begin
  create policy time_entries_select_own
    on public.time_entries
    for select
    using (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy time_entries_insert_own
    on public.time_entries
    for insert
    with check (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy time_entries_update_own
    on public.time_entries
    for update
    using (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    )
    with check (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy time_entries_delete_own
    on public.time_entries
    for delete
    using (
      public.is_company_member(company_id)
      and user_id = auth.uid()
    );
exception when duplicate_object then null; end $$;
