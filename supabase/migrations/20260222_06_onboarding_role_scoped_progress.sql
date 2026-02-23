alter table public.onboarding_checklist
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Replace legacy uniqueness (company_id,key) with scope-aware uniqueness.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'onboarding_checklist_company_id_key_key'
      and conrelid = 'public.onboarding_checklist'::regclass
  ) then
    alter table public.onboarding_checklist
      drop constraint onboarding_checklist_company_id_key_key;
  end if;
end
$$;

create unique index if not exists onboarding_checklist_company_user_key_idx
  on public.onboarding_checklist (company_id, user_id, key)
  where user_id is not null;

create unique index if not exists onboarding_checklist_company_key_company_scope_idx
  on public.onboarding_checklist (company_id, key)
  where user_id is null;

create index if not exists onboarding_checklist_company_user_idx
  on public.onboarding_checklist (company_id, user_id);
