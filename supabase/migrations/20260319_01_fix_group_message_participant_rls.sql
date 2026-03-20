-- Restore participant-based access for group messaging without reintroducing
-- the prior self-recursive RLS problem.

create or replace function public.user_can_access_message_thread(
  target_company_id uuid,
  target_thread_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_company_member(target_company_id)
    and exists (
      select 1
      from public.message_participants p
      where p.company_id = target_company_id
        and p.thread_id = target_thread_id
        and p.user_id = target_user_id
    );
$$;

revoke all on function public.user_can_access_message_thread(uuid, uuid, uuid) from public;
grant execute on function public.user_can_access_message_thread(uuid, uuid, uuid) to authenticated;
grant execute on function public.user_can_access_message_thread(uuid, uuid, uuid) to service_role;

drop policy if exists "message_threads_select_participant" on public.message_threads;
drop policy if exists "message_threads_insert_company" on public.message_threads;
drop policy if exists "message_threads_update_participant" on public.message_threads;
drop policy if exists "message_threads_delete_participant" on public.message_threads;

create policy "message_threads_select_participant"
  on public.message_threads
  for select
  using (public.user_can_access_message_thread(company_id, id));

create policy "message_threads_insert_company"
  on public.message_threads
  for insert
  with check (
    public.is_company_member(company_id)
    and created_by = auth.uid()
  );

create policy "message_threads_update_participant"
  on public.message_threads
  for update
  using (public.user_can_access_message_thread(company_id, id))
  with check (public.is_company_member(company_id));

create policy "message_threads_delete_participant"
  on public.message_threads
  for delete
  using (public.user_can_access_message_thread(company_id, id));

drop policy if exists "message_participants_select_participant" on public.message_participants;
drop policy if exists "message_participants_insert_company_member" on public.message_participants;
drop policy if exists "message_participants_update_self" on public.message_participants;
drop policy if exists "message_participants_delete_self" on public.message_participants;

create policy "message_participants_select_participant"
  on public.message_participants
  for select
  using (public.user_can_access_message_thread(company_id, thread_id));

create policy "message_participants_insert_company_member"
  on public.message_participants
  for insert
  with check (public.is_company_member(company_id));

create policy "message_participants_update_self"
  on public.message_participants
  for update
  using (
    user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_company_member(company_id)
  );

create policy "message_participants_delete_self"
  on public.message_participants
  for delete
  using (
    user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
  );

drop policy if exists "messages_select_participant" on public.messages;
drop policy if exists "messages_insert_participant" on public.messages;
drop policy if exists "messages_update_participant" on public.messages;
drop policy if exists "messages_delete_participant" on public.messages;

create policy "messages_select_participant"
  on public.messages
  for select
  using (public.user_can_access_message_thread(company_id, thread_id));

create policy "messages_insert_participant"
  on public.messages
  for insert
  with check (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
  );

create policy "messages_update_participant"
  on public.messages
  for update
  using (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
  )
  with check (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
  );

create policy "messages_delete_participant"
  on public.messages
  for delete
  using (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
  );
