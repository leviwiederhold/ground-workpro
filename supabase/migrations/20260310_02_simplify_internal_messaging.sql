-- Simplified internal messaging MVP: direct threads + participants + messages.

-- Preserve legacy channel-based table so old data is retained.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'messages'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_messages'
  ) then
    alter table public.messages rename to legacy_messages;
  end if;
end $$;

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'direct',
  dm_user_a uuid not null references auth.users(id) on delete cascade,
  dm_user_b uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz null,
  constraint message_threads_kind_check check (kind in ('direct')),
  constraint message_threads_dm_pair_check check (dm_user_a <> dm_user_b)
);

create unique index if not exists message_threads_company_direct_pair_key
  on public.message_threads(company_id, dm_user_a, dm_user_b)
  where kind = 'direct';

create index if not exists message_threads_company_last_message_idx
  on public.message_threads(company_id, last_message_at desc nulls last, updated_at desc, created_at desc);

create unique index if not exists message_threads_id_company_key
  on public.message_threads(id, company_id);

create table if not exists public.message_participants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint message_participants_thread_fk
    foreign key (thread_id, company_id)
    references public.message_threads(id, company_id)
    on delete cascade
);

create unique index if not exists message_participants_company_thread_user_key
  on public.message_participants(company_id, thread_id, user_id);

create index if not exists message_participants_company_user_idx
  on public.message_participants(company_id, user_id);

create index if not exists message_participants_company_thread_idx
  on public.message_participants(company_id, thread_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid not null,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_thread_fk
    foreign key (thread_id, company_id)
    references public.message_threads(id, company_id)
    on delete cascade
);

create index if not exists messages_company_thread_created_idx
  on public.messages(company_id, thread_id, created_at desc);

create index if not exists messages_thread_created_idx
  on public.messages(thread_id, created_at);

alter table public.message_threads enable row level security;
alter table public.message_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "message_threads_select_participant" on public.message_threads;
drop policy if exists "message_threads_insert_company" on public.message_threads;
drop policy if exists "message_threads_update_participant" on public.message_threads;
drop policy if exists "message_threads_delete_participant" on public.message_threads;

do $$ begin
  create policy "message_threads_select_participant"
    on public.message_threads
    for select
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = message_threads.company_id
          and p.thread_id = message_threads.id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_threads_insert_company"
    on public.message_threads
    for insert
    with check (
      public.is_company_member(company_id)
      and created_by = auth.uid()
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_threads_update_participant"
    on public.message_threads
    for update
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = message_threads.company_id
          and p.thread_id = message_threads.id
          and p.user_id = auth.uid()
      )
    )
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_threads_delete_participant"
    on public.message_threads
    for delete
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = message_threads.company_id
          and p.thread_id = message_threads.id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

drop policy if exists "message_participants_select_participant" on public.message_participants;
drop policy if exists "message_participants_insert_company_member" on public.message_participants;
drop policy if exists "message_participants_update_self" on public.message_participants;
drop policy if exists "message_participants_delete_self" on public.message_participants;

do $$ begin
  create policy "message_participants_select_participant"
    on public.message_participants
    for select
    using (
      exists (
        select 1
        from public.message_participants self
        where self.company_id = message_participants.company_id
          and self.thread_id = message_participants.thread_id
          and self.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_insert_company_member"
    on public.message_participants
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_update_self"
    on public.message_participants
    for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid() and public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_delete_self"
    on public.message_participants
    for delete
    using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

drop policy if exists "messages_select_participant" on public.messages;
drop policy if exists "messages_insert_participant" on public.messages;
drop policy if exists "messages_update_participant" on public.messages;
drop policy if exists "messages_delete_participant" on public.messages;

do $$ begin
  create policy "messages_select_participant"
    on public.messages
    for select
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = messages.company_id
          and p.thread_id = messages.thread_id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_insert_participant"
    on public.messages
    for insert
    with check (
      sender_user_id = auth.uid()
      and exists (
        select 1
        from public.message_participants p
        where p.company_id = messages.company_id
          and p.thread_id = messages.thread_id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_update_participant"
    on public.messages
    for update
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = messages.company_id
          and p.thread_id = messages.thread_id
          and p.user_id = auth.uid()
      )
    )
    with check (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = messages.company_id
          and p.thread_id = messages.thread_id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_delete_participant"
    on public.messages
    for delete
    using (
      exists (
        select 1
        from public.message_participants p
        where p.company_id = messages.company_id
          and p.thread_id = messages.thread_id
          and p.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;
