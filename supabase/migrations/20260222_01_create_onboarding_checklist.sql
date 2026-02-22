create table if not exists public.onboarding_checklist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, key)
);

create index if not exists onboarding_checklist_company_id_idx
  on public.onboarding_checklist (company_id);

create index if not exists onboarding_checklist_company_key_idx
  on public.onboarding_checklist (company_id, key);

alter table public.onboarding_checklist enable row level security;

drop policy if exists onboarding_checklist_select on public.onboarding_checklist;
create policy onboarding_checklist_select
  on public.onboarding_checklist
  for select
  using (public.is_company_member(company_id));

drop policy if exists onboarding_checklist_insert on public.onboarding_checklist;
create policy onboarding_checklist_insert
  on public.onboarding_checklist
  for insert
  with check (public.is_company_member(company_id));

drop policy if exists onboarding_checklist_update on public.onboarding_checklist;
create policy onboarding_checklist_update
  on public.onboarding_checklist
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists onboarding_checklist_delete on public.onboarding_checklist;
create policy onboarding_checklist_delete
  on public.onboarding_checklist
  for delete
  using (public.is_company_member(company_id));
