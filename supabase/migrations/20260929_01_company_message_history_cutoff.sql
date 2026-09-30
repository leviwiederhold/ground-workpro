-- Preserve existing messaging access while bounding history for memberships
-- created after this migration. The cutoff is assigned only by PostgreSQL.

alter table public.memberships
  add column if not exists message_history_cutoff_at timestamptz null;

comment on column public.memberships.message_history_cutoff_at is
  'Database-assigned lower bound for company message visibility. NULL grandfathers memberships present at rollout and full-history roles.';

create or replace function public.set_membership_message_history_cutoff()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_role text;
begin
  if tg_op = 'UPDATE' then
    -- A membership moved to another identity/workspace is a new membership;
    -- all other updates retain the original database-assigned boundary.
    if new.company_id is distinct from old.company_id
       or new.user_id is distinct from old.user_id then
      new.created_at := clock_timestamp();
      normalized_role := lower(regexp_replace(coalesce(new.role, ''), '[^a-z0-9]', '', 'g'));
      if normalized_role in ('owner', 'coowner', 'admin', 'administrator', 'ceo', 'executive') then
        new.message_history_cutoff_at := null;
      else
        new.message_history_cutoff_at := new.created_at;
      end if;
      return new;
    end if;

    -- Membership join time and its history boundary are immutable to clients.
    new.created_at := old.created_at;
    new.message_history_cutoff_at := old.message_history_cutoff_at;
    return new;
  end if;

  -- Do not accept a timestamp supplied by an application or service caller as
  -- the membership creation time. The same database timestamp is the cutoff.
  new.created_at := clock_timestamp();
  normalized_role := lower(regexp_replace(coalesce(new.role, ''), '[^a-z0-9]', '', 'g'));
  if normalized_role in ('owner', 'coowner', 'admin', 'administrator', 'ceo', 'executive') then
    new.message_history_cutoff_at := null;
  else
    new.message_history_cutoff_at := new.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_set_message_history_cutoff on public.memberships;
create trigger memberships_set_message_history_cutoff
before insert or update on public.memberships
for each row execute function public.set_membership_message_history_cutoff();

create or replace function public.user_can_view_company_message_at(
  target_company_id uuid,
  target_user_id uuid,
  target_message_created_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id = auth.uid()
    and exists (
    select 1
    from public.memberships m
    where m.company_id = target_company_id
      and m.user_id = target_user_id
      and (
        m.message_history_cutoff_at is null
        or lower(regexp_replace(coalesce(m.role, ''), '[^a-z0-9]', '', 'g'))
          in ('owner', 'coowner', 'admin', 'administrator', 'ceo', 'executive')
        or target_message_created_at >= m.message_history_cutoff_at
      )
  );
$$;

revoke all on function public.user_can_view_company_message_at(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.user_can_view_company_message_at(uuid, uuid, timestamptz) to authenticated, service_role;

create or replace function public.user_can_access_visible_message_thread(
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
  select target_user_id = auth.uid()
    and public.user_can_access_message_thread(target_company_id, target_thread_id, target_user_id)
    and (
      exists (
        select 1
        from public.memberships m
        where m.company_id = target_company_id
          and m.user_id = target_user_id
          and (
            m.message_history_cutoff_at is null
            or lower(regexp_replace(coalesce(m.role, ''), '[^a-z0-9]', '', 'g'))
              in ('owner', 'coowner', 'admin', 'administrator', 'ceo', 'executive')
          )
      )
      or exists (
        select 1
        from public.messages msg
        where msg.company_id = target_company_id
          and msg.thread_id = target_thread_id
          and public.user_can_view_company_message_at(
            target_company_id,
            target_user_id,
            msg.created_at
          )
      )
    );
$$;

revoke all on function public.user_can_access_visible_message_thread(uuid, uuid, uuid) from public, anon;
grant execute on function public.user_can_access_visible_message_thread(uuid, uuid, uuid) to authenticated, service_role;

-- Avoid exposing last_message_at, thread names, and participant lists for an
-- old-only conversation through direct PostgREST reads. The app's privileged
-- inbox route still returns the empty/new-history conversation shell.
drop policy if exists "message_threads_select_participant" on public.message_threads;
create policy "message_threads_select_participant"
  on public.message_threads
  for select
  using (public.user_can_access_visible_message_thread(company_id, id));

drop policy if exists message_threads_history_guard on public.message_threads;
create policy message_threads_history_guard
  on public.message_threads
  as restrictive
  for select
  using (public.user_can_access_visible_message_thread(company_id, id));

drop policy if exists "message_participants_select_participant" on public.message_participants;
create policy "message_participants_select_participant"
  on public.message_participants
  for select
  using (public.user_can_access_visible_message_thread(company_id, thread_id));

drop policy if exists message_participants_history_guard on public.message_participants;
create policy message_participants_history_guard
  on public.message_participants
  as restrictive
  for select
  using (public.user_can_access_visible_message_thread(company_id, thread_id));

-- PostgREST and Supabase Realtime both honor this SELECT policy. Keep the
-- existing participant rule and add the membership-derived time boundary.
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages
  for select
  using (
    public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  );

drop policy if exists messages_history_select_guard on public.messages;
create policy messages_history_select_guard
  on public.messages
  as restrictive
  for select
  using (
    public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  );

-- Employees cannot backdate a message update, nor edit/delete a message they
-- are not allowed to see. Inserts remain governed by the existing policy.
drop policy if exists "messages_update_participant" on public.messages;
create policy "messages_update_participant"
  on public.messages
  for update
  using (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  )
  with check (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  );

drop policy if exists messages_history_update_guard on public.messages;
create policy messages_history_update_guard
  on public.messages
  as restrictive
  for update
  using (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  )
  with check (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  );

drop policy if exists "messages_delete_participant" on public.messages;
create policy "messages_delete_participant"
  on public.messages
  for delete
  using (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  );

drop policy if exists messages_history_delete_guard on public.messages;
create policy messages_history_delete_guard
  on public.messages
  as restrictive
  for delete
  using (
    sender_user_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
  );

-- Attachment rows and direct Storage object requests must pass through the
-- parent message's visibility check as well as the existing participant rule.
drop policy if exists "message_attachments_select_participant" on public.message_attachments;
create policy "message_attachments_select_participant"
  on public.message_attachments
  for select
  using (
    public.user_can_access_message_thread(company_id, thread_id)
    and exists (
      select 1
      from public.messages m
      where m.company_id = message_attachments.company_id
        and m.thread_id = message_attachments.thread_id
        and m.id = message_attachments.message_id
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

drop policy if exists message_attachments_history_select_guard on public.message_attachments;
create policy message_attachments_history_select_guard
  on public.message_attachments
  as restrictive
  for select
  using (
    public.user_can_access_message_thread(company_id, thread_id)
    and exists (
      select 1
      from public.messages m
      where m.company_id = message_attachments.company_id
        and m.thread_id = message_attachments.thread_id
        and m.id = message_attachments.message_id
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

drop policy if exists "message_attachments_insert_participant" on public.message_attachments;
create policy "message_attachments_insert_participant"
  on public.message_attachments
  for insert
  with check (
    uploader_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and exists (
      select 1
      from public.messages m
      where m.company_id = message_attachments.company_id
        and m.thread_id = message_attachments.thread_id
        and m.id = message_attachments.message_id
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

drop policy if exists message_attachments_history_insert_guard on public.message_attachments;
create policy message_attachments_history_insert_guard
  on public.message_attachments
  as restrictive
  for insert
  with check (
    public.user_can_access_message_thread(company_id, thread_id)
    and exists (
      select 1
      from public.messages m
      where m.company_id = message_attachments.company_id
        and m.thread_id = message_attachments.thread_id
        and m.id = message_attachments.message_id
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

drop policy if exists "message_attachments_delete_participant" on public.message_attachments;
create policy "message_attachments_delete_participant"
  on public.message_attachments
  for delete
  using (
    uploader_id = auth.uid()
    and public.user_can_access_message_thread(company_id, thread_id)
    and exists (
      select 1
      from public.messages m
      where m.company_id = message_attachments.company_id
        and m.thread_id = message_attachments.thread_id
        and m.id = message_attachments.message_id
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

drop policy if exists message_attachments_history_delete_guard on public.message_attachments;
create policy message_attachments_history_delete_guard
  on public.message_attachments
  as restrictive
  for delete
  using (
    public.user_can_access_message_thread(company_id, thread_id)
    and exists (
      select 1
      from public.messages m
      where m.company_id = message_attachments.company_id
        and m.thread_id = message_attachments.thread_id
        and m.id = message_attachments.message_id
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

drop policy if exists "message_attachments_storage_history_select" on storage.objects;
create policy "message_attachments_storage_history_select"
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and exists (
      select 1
      from public.message_attachments a
      join public.messages m
        on m.company_id = a.company_id
       and m.thread_id = a.thread_id
       and m.id = a.message_id
      where a.storage_bucket = storage.objects.bucket_id
        and a.storage_path = storage.objects.name
        and public.user_can_access_message_thread(a.company_id, a.thread_id)
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

-- Restrictive policies compose with every permissive Storage policy, including
-- any dashboard-created one, so a broad bucket policy cannot bypass the cutoff.
drop policy if exists message_attachments_storage_history_guard on storage.objects;
create policy message_attachments_storage_history_guard
  on storage.objects
  as restrictive
  for select to authenticated
  using (
    bucket_id <> 'message-attachments'
    or exists (
      select 1
      from public.message_attachments a
      join public.messages m
        on m.company_id = a.company_id
       and m.thread_id = a.thread_id
       and m.id = a.message_id
      where a.storage_bucket = storage.objects.bucket_id
        and a.storage_path = storage.objects.name
        and public.user_can_access_message_thread(a.company_id, a.thread_id)
        and public.user_can_view_company_message_at(m.company_id, auth.uid(), m.created_at)
    )
  );

-- Message notifications persist previews, so apply the same guard at the row
-- boundary. Other notification types keep their existing access semantics.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  using (
    (
      user_id = auth.uid()
      and (
        type <> 'new_message'
        or public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
      )
    )
    or exists (
      select 1
      from public.memberships m
      where m.company_id = notifications.company_id
        and m.user_id = auth.uid()
        and lower(m.role) in ('owner', 'co_owner', 'admin', 'executive', 'ceo')
    )
  );

drop policy if exists notifications_message_history_guard on public.notifications;
create policy notifications_message_history_guard
  on public.notifications
  as restrictive
  for select
  using (
    type <> 'new_message'
    or (
      public.user_can_view_company_message_at(company_id, auth.uid(), created_at)
      and (
        user_id = auth.uid()
        or exists (
          select 1
          from public.memberships m
          where m.company_id = notifications.company_id
            and m.user_id = auth.uid()
            and lower(m.role) in ('owner', 'co_owner', 'admin', 'executive', 'ceo')
        )
      )
    )
  );

-- The pre-2026 direct-channel table was retained as legacy_messages when the
-- current thread model was introduced. Keep direct PostgREST access to those
-- preserved rows under the same cutoff when that legacy table exists.
do $$
begin
  if to_regclass('public.legacy_messages') is not null then
    execute 'alter table public.legacy_messages enable row level security';
    execute 'drop policy if exists legacy_messages_history_select_guard on public.legacy_messages';
    execute $policy$
      create policy legacy_messages_history_select_guard
        on public.legacy_messages
        as restrictive
        for select
        using (public.user_can_view_company_message_at(company_id, auth.uid(), created_at))
    $policy$;
    execute 'drop policy if exists legacy_messages_history_update_guard on public.legacy_messages';
    execute $policy$
      create policy legacy_messages_history_update_guard
        on public.legacy_messages
        as restrictive
        for update
        using (public.user_can_view_company_message_at(company_id, auth.uid(), created_at))
        with check (public.user_can_view_company_message_at(company_id, auth.uid(), created_at))
    $policy$;
    execute 'drop policy if exists legacy_messages_history_delete_guard on public.legacy_messages';
    execute $policy$
      create policy legacy_messages_history_delete_guard
        on public.legacy_messages
        as restrictive
        for delete
        using (public.user_can_view_company_message_at(company_id, auth.uid(), created_at))
    $policy$;
    execute 'drop policy if exists legacy_messages_history_insert_guard on public.legacy_messages';
    execute $policy$
      create policy legacy_messages_history_insert_guard
        on public.legacy_messages
        as restrictive
        for insert
        with check (public.user_can_view_company_message_at(company_id, auth.uid(), created_at))
    $policy$;
  end if;
end;
$$;
