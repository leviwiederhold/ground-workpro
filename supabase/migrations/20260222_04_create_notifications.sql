create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('assignment_created','assignment_removed','event_invited','event_updated','event_canceled')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists notifications_company_user_read_idx
  on public.notifications (company_id, user_id, read_at);

create index if not exists notifications_company_created_idx
  on public.notifications (company_id, created_at desc);

alter table public.notifications enable row level security;

do $$ begin
  create policy notifications_select_own
    on public.notifications
    for select
    using (
      user_id = auth.uid()
      or exists (
        select 1
        from public.memberships m
        where m.company_id = notifications.company_id
          and m.user_id = auth.uid()
          and lower(m.role) in ('admin','executive','ceo')
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy notifications_insert_member
    on public.notifications
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy notifications_update_own
    on public.notifications
    for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid() and public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
