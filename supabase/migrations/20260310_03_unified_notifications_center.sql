-- Unified in-app notifications center schema updates.

alter table if exists public.notifications
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists link text,
  add column if not exists is_read boolean not null default false,
  add column if not exists actor_user_id uuid null references auth.users(id) on delete set null,
  add column if not exists entity_type text null,
  add column if not exists entity_id text null,
  add column if not exists updated_at timestamptz not null default now();

-- Keep read_at compatibility, but make is_read the canonical unread flag.
update public.notifications
set is_read = coalesce(read_at is not null, false)
where is_read is distinct from coalesce(read_at is not null, false);

-- Expand/replace notification types for MVP.
update public.notifications
set type = case
  when type = 'assignment_created' then 'task_assigned'
  when type = 'assignment_removed' then 'task_assigned'
  when type = 'event_invited' then 'calendar_invite'
  when type = 'event_updated' then 'calendar_event_reminder'
  when type = 'event_canceled' then 'calendar_event_reminder'
  when type = 'work_order_reported' then 'maintenance_assigned'
  when type = 'safety_log_created' then 'safety_assigned'
  else type
end;

alter table if exists public.notifications
  drop constraint if exists notifications_type_check;

alter table if exists public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'new_message',
      'calendar_invite',
      'calendar_event_reminder',
      'job_assigned',
      'task_assigned',
      'company_invite',
      'bid_won',
      'maintenance_assigned',
      'safety_assigned'
    )
  );

create index if not exists notifications_company_user_is_read_idx
  on public.notifications (company_id, user_id, is_read);

create index if not exists notifications_company_user_created_idx
  on public.notifications (company_id, user_id, created_at desc);

create index if not exists notifications_company_entity_idx
  on public.notifications (company_id, entity_type, entity_id);
