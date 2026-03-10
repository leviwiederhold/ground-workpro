do $$
begin
  if not exists (select 1 from pg_type where typname = 'module_access_level') then
    create type public.module_access_level as enum ('none', 'view', 'edit');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'module_permission_key') then
    create type public.module_permission_key as enum (
      'jobs',
      'fleet',
      'maintenance',
      'daily_reports',
      'safety',
      'messages',
      'finance',
      'team_management'
    );
  end if;
end $$;

create table if not exists public.module_permission_templates (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  module_key public.module_permission_key not null,
  access_level public.module_access_level not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_permission_templates_role_check check (role in ('ceo', 'manager', 'foreman', 'mechanic', 'operator', 'fieldstaff')),
  constraint module_permission_templates_unique unique (role, module_key)
);

create table if not exists public.module_permissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invitation_id uuid null references public.pending_invitations(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete cascade,
  module_key public.module_permission_key not null,
  access_level public.module_access_level not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_permissions_target_check check (
    (invitation_id is null and user_id is not null)
    or
    (invitation_id is not null and user_id is null)
  )
);

create unique index if not exists module_permissions_company_invite_module_idx
  on public.module_permissions(company_id, invitation_id, module_key)
  where invitation_id is not null;

create unique index if not exists module_permissions_company_user_module_idx
  on public.module_permissions(company_id, user_id, module_key)
  where user_id is not null;

create index if not exists module_permissions_company_module_idx
  on public.module_permissions(company_id, module_key);

alter table public.module_permission_templates enable row level security;
alter table public.module_permissions enable row level security;

do $$ begin
  create policy module_permission_templates_company_member
    on public.module_permission_templates
    for select
    using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy module_permissions_company_member
    on public.module_permissions
    for all
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

insert into public.module_permission_templates (role, module_key, access_level)
values
  -- ceo
  ('ceo', 'jobs', 'edit'),
  ('ceo', 'fleet', 'edit'),
  ('ceo', 'maintenance', 'edit'),
  ('ceo', 'daily_reports', 'edit'),
  ('ceo', 'safety', 'edit'),
  ('ceo', 'messages', 'edit'),
  ('ceo', 'finance', 'edit'),
  ('ceo', 'team_management', 'edit'),

  -- manager
  ('manager', 'jobs', 'edit'),
  ('manager', 'fleet', 'view'),
  ('manager', 'maintenance', 'edit'),
  ('manager', 'daily_reports', 'edit'),
  ('manager', 'safety', 'edit'),
  ('manager', 'messages', 'edit'),
  ('manager', 'finance', 'view'),
  ('manager', 'team_management', 'view'),

  -- foreman
  ('foreman', 'jobs', 'view'),
  ('foreman', 'fleet', 'view'),
  ('foreman', 'maintenance', 'view'),
  ('foreman', 'daily_reports', 'edit'),
  ('foreman', 'safety', 'edit'),
  ('foreman', 'messages', 'edit'),
  ('foreman', 'finance', 'none'),
  ('foreman', 'team_management', 'none'),

  -- mechanic
  ('mechanic', 'jobs', 'none'),
  ('mechanic', 'fleet', 'edit'),
  ('mechanic', 'maintenance', 'edit'),
  ('mechanic', 'daily_reports', 'none'),
  ('mechanic', 'safety', 'view'),
  ('mechanic', 'messages', 'edit'),
  ('mechanic', 'finance', 'none'),
  ('mechanic', 'team_management', 'none'),

  -- operator
  ('operator', 'jobs', 'view'),
  ('operator', 'fleet', 'view'),
  ('operator', 'maintenance', 'none'),
  ('operator', 'daily_reports', 'edit'),
  ('operator', 'safety', 'edit'),
  ('operator', 'messages', 'edit'),
  ('operator', 'finance', 'none'),
  ('operator', 'team_management', 'none'),

  -- fieldstaff
  ('fieldstaff', 'jobs', 'view'),
  ('fieldstaff', 'fleet', 'none'),
  ('fieldstaff', 'maintenance', 'none'),
  ('fieldstaff', 'daily_reports', 'edit'),
  ('fieldstaff', 'safety', 'edit'),
  ('fieldstaff', 'messages', 'view'),
  ('fieldstaff', 'finance', 'none'),
  ('fieldstaff', 'team_management', 'none')
on conflict (role, module_key) do update
set access_level = excluded.access_level,
    updated_at = now();

