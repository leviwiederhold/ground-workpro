alter table if exists public.companies
  add column if not exists plan_type text not null default 'starter',
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists trial_ends_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists current_period_end timestamptz;

create index if not exists companies_subscription_status_idx
  on public.companies (subscription_status);

create index if not exists companies_current_period_end_idx
  on public.companies (current_period_end);
