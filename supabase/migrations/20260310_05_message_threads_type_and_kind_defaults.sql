-- Ensure message thread discriminator columns are always populated.
-- Some environments enforce NOT NULL on `type`; newer code paths use `kind`.

alter table if exists public.message_threads
  add column if not exists type text,
  add column if not exists kind text;

update public.message_threads
set
  type = coalesce(nullif(type, ''), nullif(kind, ''), 'direct'),
  kind = coalesce(nullif(kind, ''), nullif(type, ''), 'direct')
where
  type is null
  or kind is null
  or type = ''
  or kind = '';

alter table if exists public.message_threads
  alter column type set default 'direct',
  alter column kind set default 'direct';

do $$
begin
  alter table public.message_threads
    alter column type set not null;
exception when others then null;
end $$;

do $$
begin
  alter table public.message_threads
    alter column kind set not null;
exception when others then null;
end $$;

alter table if exists public.message_threads
  drop constraint if exists message_threads_type_check;

alter table if exists public.message_threads
  drop constraint if exists message_threads_kind_check;

alter table if exists public.message_threads
  add constraint message_threads_type_check
  check (type in ('direct', 'group'));

alter table if exists public.message_threads
  add constraint message_threads_kind_check
  check (kind in ('direct', 'group'));
