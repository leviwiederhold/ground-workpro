-- Fix infinite recursion in messaging RLS by removing self-referencing policies.
-- This migration rewrites policies for:
--   - message_threads
--   - message_participants
--   - messages
-- using only message_threads as the ownership anchor.

alter table if exists public.message_threads enable row level security;
alter table if exists public.message_participants enable row level security;
alter table if exists public.messages enable row level security;

drop policy if exists "message_threads_select_participant" on public.message_threads;
drop policy if exists "message_threads_insert_company" on public.message_threads;
drop policy if exists "message_threads_update_participant" on public.message_threads;
drop policy if exists "message_threads_delete_participant" on public.message_threads;

drop policy if exists "message_participants_select_participant" on public.message_participants;
drop policy if exists "message_participants_insert_company_member" on public.message_participants;
drop policy if exists "message_participants_update_self" on public.message_participants;
drop policy if exists "message_participants_delete_self" on public.message_participants;

drop policy if exists "messages_select_participant" on public.messages;
drop policy if exists "messages_insert_participant" on public.messages;
drop policy if exists "messages_update_participant" on public.messages;
drop policy if exists "messages_delete_participant" on public.messages;

do $$ begin
  create policy "message_threads_select_participant"
    on public.message_threads
    for select
    using (
      public.is_company_member(company_id)
      and auth.uid() in (dm_user_a, dm_user_b)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_threads_insert_company"
    on public.message_threads
    for insert
    with check (
      public.is_company_member(company_id)
      and created_by = auth.uid()
      and auth.uid() in (dm_user_a, dm_user_b)
      and kind = 'direct'
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_threads_update_participant"
    on public.message_threads
    for update
    using (
      public.is_company_member(company_id)
      and auth.uid() in (dm_user_a, dm_user_b)
    )
    with check (
      public.is_company_member(company_id)
      and auth.uid() in (dm_user_a, dm_user_b)
      and kind = 'direct'
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_threads_delete_participant"
    on public.message_threads
    for delete
    using (
      public.is_company_member(company_id)
      and auth.uid() in (dm_user_a, dm_user_b)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_select_participant"
    on public.message_participants
    for select
    using (
      public.is_company_member(company_id)
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = message_participants.company_id
          and t.id = message_participants.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_insert_company_member"
    on public.message_participants
    for insert
    with check (
      public.is_company_member(company_id)
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = message_participants.company_id
          and t.id = message_participants.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
          and message_participants.user_id in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_update_self"
    on public.message_participants
    for update
    using (
      public.is_company_member(company_id)
      and user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = message_participants.company_id
          and t.id = message_participants.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    )
    with check (
      public.is_company_member(company_id)
      and user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = message_participants.company_id
          and t.id = message_participants.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_participants_delete_self"
    on public.message_participants
    for delete
    using (
      public.is_company_member(company_id)
      and user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = message_participants.company_id
          and t.id = message_participants.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_select_participant"
    on public.messages
    for select
    using (
      public.is_company_member(company_id)
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = messages.company_id
          and t.id = messages.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_insert_participant"
    on public.messages
    for insert
    with check (
      public.is_company_member(company_id)
      and sender_user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = messages.company_id
          and t.id = messages.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_update_participant"
    on public.messages
    for update
    using (
      public.is_company_member(company_id)
      and sender_user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = messages.company_id
          and t.id = messages.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    )
    with check (
      public.is_company_member(company_id)
      and sender_user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = messages.company_id
          and t.id = messages.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_delete_participant"
    on public.messages
    for delete
    using (
      public.is_company_member(company_id)
      and sender_user_id = auth.uid()
      and exists (
        select 1
        from public.message_threads t
        where t.company_id = messages.company_id
          and t.id = messages.thread_id
          and auth.uid() in (t.dm_user_a, t.dm_user_b)
      )
    );
exception when duplicate_object then null; end $$;
