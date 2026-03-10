create table if not exists public.pending_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null,
  employee_id uuid null references public.employees(id) on delete set null,
  invite_token text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '72 hours'),
  accepted_at timestamptz null,
  accepted_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_invitations_email_check check (position('@' in email) > 1),
  constraint pending_invitations_role_check check (role in ('ceo', 'manager', 'foreman', 'mechanic', 'operator', 'fieldstaff')),
  constraint pending_invitations_accept_pair_check check (
    (accepted_at is null and accepted_user_id is null)
    or
    (accepted_at is not null and accepted_user_id is not null)
  )
);

create unique index if not exists pending_invitations_company_email_active_idx
  on public.pending_invitations(company_id, lower(email))
  where accepted_at is null;

create index if not exists pending_invitations_company_created_idx
  on public.pending_invitations(company_id, created_at desc);

create index if not exists pending_invitations_company_role_idx
  on public.pending_invitations(company_id, role);

alter table public.pending_invitations enable row level security;

do $$ begin
  create policy pending_invitations_company_member
    on public.pending_invitations
    for all
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

