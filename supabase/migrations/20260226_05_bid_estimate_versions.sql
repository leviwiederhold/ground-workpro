create table if not exists public.bid_estimate_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bid_id uuid not null references public.bids(id) on delete cascade,
  version_no integer not null,
  name text not null,
  status text not null default 'draft',
  estimated_revenue numeric not null default 0,
  subtotal_cost numeric not null default 0,
  contingency_percent numeric not null default 0,
  contingency_amount numeric not null default 0,
  total_cost numeric not null default 0,
  margin_percent numeric not null default 0,
  target_margin_percent numeric not null default 0,
  is_below_target boolean not null default false,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  locked_at timestamptz null,
  constraint bid_estimate_versions_status_check check (status in ('draft','locked'))
);

create unique index if not exists bid_estimate_versions_company_bid_version_no_key
  on public.bid_estimate_versions(company_id, bid_id, version_no);

create table if not exists public.bid_estimate_version_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version_id uuid not null references public.bid_estimate_versions(id) on delete cascade,
  line_type text not null,
  description text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint bid_estimate_version_lines_type_check check (line_type in ('assumption','exclusion','alternate'))
);

create index if not exists bid_estimate_version_lines_company_version_idx
  on public.bid_estimate_version_lines(company_id, version_id);

create table if not exists public.bid_estimate_risks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version_id uuid not null references public.bid_estimate_versions(id) on delete cascade,
  title text not null,
  owner_user_id uuid null references auth.users(id) on delete set null,
  severity text not null default 'medium',
  status text not null default 'open',
  cost_impact numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint bid_estimate_risks_severity_check check (severity in ('low','medium','high')),
  constraint bid_estimate_risks_status_check check (status in ('open','mitigated','accepted'))
);

create index if not exists bid_estimate_risks_company_version_idx
  on public.bid_estimate_risks(company_id, version_id);

alter table public.bid_estimate_versions enable row level security;
alter table public.bid_estimate_version_lines enable row level security;
alter table public.bid_estimate_risks enable row level security;

do $$ begin
  create policy "bid_estimate_versions_company_member"
    on public.bid_estimate_versions
    for all
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bid_estimate_version_lines_company_member"
    on public.bid_estimate_version_lines
    for all
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "bid_estimate_risks_company_member"
    on public.bid_estimate_risks
    for all
    using (public.is_company_member(company_id))
    with check (public.is_company_member(company_id));
exception when duplicate_object then null; end $$;
