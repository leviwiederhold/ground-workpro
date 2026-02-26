alter table public.message_channels
  add column if not exists kind text not null default 'channel',
  add column if not exists dm_user_a uuid null references auth.users(id) on delete set null,
  add column if not exists dm_user_b uuid null references auth.users(id) on delete set null;

do $$ begin
  alter table public.message_channels
    add constraint message_channels_kind_check check (kind in ('channel', 'direct'));
exception when duplicate_object then null; end $$;

alter table public.message_channel_members
  add column if not exists last_read_at timestamptz null;

create index if not exists message_channels_company_kind_idx
  on public.message_channels(company_id, kind);

create unique index if not exists message_channels_direct_pair_key
  on public.message_channels(company_id, dm_user_a, dm_user_b)
  where kind = 'direct' and dm_user_a is not null and dm_user_b is not null;

create index if not exists message_channel_members_company_user_read_idx
  on public.message_channel_members(company_id, user_id, last_read_at);
