alter table if exists public.companies
  add column if not exists plan_type text not null default 'free',
  add column if not exists subscription_status text not null default 'active',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

alter table if exists public.companies
  drop constraint if exists companies_subscription_status_check;

alter table if exists public.companies
  add constraint companies_subscription_status_check
  check (subscription_status in ('inactive', 'trialing', 'active', 'past_due', 'canceled'));
