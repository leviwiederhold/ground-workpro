create table if not exists public.invite_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  email text not null,
  role text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  used_at timestamptz null
);

create index if not exists invite_tokens_company_email_idx
  on public.invite_tokens(company_id, email);

create index if not exists invite_tokens_token_idx
  on public.invite_tokens(token);

alter table public.invite_tokens enable row level security;

do $$ begin
  create policy "invite_tokens_company_member"
    on public.invite_tokens
    for all
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
