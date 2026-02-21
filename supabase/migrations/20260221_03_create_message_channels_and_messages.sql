create table if not exists public.message_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.message_channels(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists message_channels_company_id_idx
  on public.message_channels(company_id);

create unique index if not exists message_channels_company_name_key
  on public.message_channels(company_id, name);

create index if not exists messages_company_id_idx
  on public.messages(company_id);

create index if not exists messages_channel_id_created_at_idx
  on public.messages(channel_id, created_at);

alter table public.message_channels enable row level security;
alter table public.messages enable row level security;

do $$ begin
  create policy "message_channels_select_company"
    on public.message_channels
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channels_insert_company"
    on public.message_channels
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channels_update_company"
    on public.message_channels
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channels_delete_company"
    on public.message_channels
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_select_company"
    on public.messages
    for select
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_insert_company"
    on public.messages
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_update_company"
    on public.messages
    for update
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_delete_company"
    on public.messages
    for delete
    using (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
