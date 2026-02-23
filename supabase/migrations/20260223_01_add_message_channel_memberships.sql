create table if not exists public.message_channel_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel_id uuid not null references public.message_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member',
  created_at timestamptz not null default now(),
  constraint message_channel_members_role_check check (member_role in ('member', 'owner'))
);

create unique index if not exists message_channel_members_company_channel_user_key
  on public.message_channel_members(company_id, channel_id, user_id);

create index if not exists message_channel_members_company_user_idx
  on public.message_channel_members(company_id, user_id);

create index if not exists message_channel_members_company_channel_idx
  on public.message_channel_members(company_id, channel_id);

alter table public.message_channels add column if not exists is_dm boolean not null default false;
alter table public.message_channels add column if not exists created_by uuid null references auth.users(id) on delete set null;

insert into public.message_channel_members (company_id, channel_id, user_id, member_role)
select c.company_id, c.id, m.user_id,
  case when c.created_by is not null and c.created_by = m.user_id then 'owner' else 'member' end
from public.message_channels c
join public.memberships m on m.company_id = c.company_id
where not exists (
  select 1
  from public.message_channel_members mm
  where mm.company_id = c.company_id
    and mm.channel_id = c.id
    and mm.user_id = m.user_id
);

alter table public.message_channel_members enable row level security;

drop policy if exists "message_channels_select_company" on public.message_channels;
drop policy if exists "message_channels_insert_company" on public.message_channels;
drop policy if exists "message_channels_update_company" on public.message_channels;
drop policy if exists "message_channels_delete_company" on public.message_channels;

do $$ begin
  create policy "message_channels_select_member"
    on public.message_channels
    for select
    using (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = message_channels.company_id
          and m.channel_id = message_channels.id
          and m.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channels_insert_company"
    on public.message_channels
    for insert
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channels_update_member"
    on public.message_channels
    for update
    using (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = message_channels.company_id
          and m.channel_id = message_channels.id
          and m.user_id = auth.uid()
      )
    )
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channels_delete_member"
    on public.message_channels
    for delete
    using (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = message_channels.company_id
          and m.channel_id = message_channels.id
          and m.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

drop policy if exists "messages_select_company" on public.messages;
drop policy if exists "messages_insert_company" on public.messages;
drop policy if exists "messages_update_company" on public.messages;
drop policy if exists "messages_delete_company" on public.messages;

do $$ begin
  create policy "messages_select_member"
    on public.messages
    for select
    using (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = messages.company_id
          and m.channel_id = messages.channel_id
          and m.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_insert_member"
    on public.messages
    for insert
    with check (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = messages.company_id
          and m.channel_id = messages.channel_id
          and m.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_update_member"
    on public.messages
    for update
    using (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = messages.company_id
          and m.channel_id = messages.channel_id
          and m.user_id = auth.uid()
      )
    )
    with check (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = messages.company_id
          and m.channel_id = messages.channel_id
          and m.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "messages_delete_member"
    on public.messages
    for delete
    using (
      exists (
        select 1 from public.message_channel_members m
        where m.company_id = messages.company_id
          and m.channel_id = messages.channel_id
          and m.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channel_members_select_member"
    on public.message_channel_members
    for select
    using (
      exists (
        select 1 from public.message_channel_members self
        where self.company_id = message_channel_members.company_id
          and self.channel_id = message_channel_members.channel_id
          and self.user_id = auth.uid()
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channel_members_insert_member"
    on public.message_channel_members
    for insert
    with check (
      public.is_company_member(company_id)
      and (
        user_id = auth.uid()
        or exists (
          select 1 from public.message_channel_members self
          where self.company_id = message_channel_members.company_id
            and self.channel_id = message_channel_members.channel_id
            and self.user_id = auth.uid()
        )
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_channel_members_delete_member"
    on public.message_channel_members
    for delete
    using (
      (user_id = auth.uid())
      or exists (
        select 1 from public.message_channel_members owner_row
        where owner_row.company_id = message_channel_members.company_id
          and owner_row.channel_id = message_channel_members.channel_id
          and owner_row.user_id = auth.uid()
          and owner_row.member_role = 'owner'
      )
    );
exception when duplicate_object then null; end $$;
