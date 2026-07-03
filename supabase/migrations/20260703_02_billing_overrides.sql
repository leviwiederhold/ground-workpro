-- ============================================================================
-- Company billing overrides: platform-admin-only complimentary / discounted
-- access, decoupled from Stripe so normal customers keep using Stripe exactly
-- as before.
--
-- Override types:
--   none            -> no override; company uses Stripe status as usual
--   free_lifetime   -> always-active complimentary access (value null)
--   free_until      -> complimentary access until billing_override_until
--   percent_discount-> metadata only (percent in value); still needs Stripe*
--   fixed_discount  -> metadata only (amount in cents in value); still needs Stripe*
--
-- * Discounts are internal metadata in this PR. They do NOT by themselves grant
--   access and do NOT touch Stripe; connecting them to Stripe coupons is a
--   later PR. Only free_lifetime / (unexpired) free_until bypass the paywall.
--
-- These columns are managed EXCLUSIVELY by the platform-admin API. RLS is not
-- added for write access here because the app writes via the service-role admin
-- client behind requirePlatformAdmin(); company members can already read their
-- own companies row but the reason/notes are never exposed to them by the API.
-- ============================================================================

alter table public.companies
  add column if not exists billing_override_type text not null default 'none',
  add column if not exists billing_override_value numeric null,
  add column if not exists billing_override_until timestamptz null,
  add column if not exists billing_override_reason text null,
  add column if not exists billing_override_created_by uuid null references auth.users(id) on delete set null,
  add column if not exists billing_override_created_at timestamptz null,
  add column if not exists billing_override_updated_at timestamptz null;

do $$ begin
  alter table public.companies
    add constraint companies_billing_override_type_check
    check (billing_override_type in ('none', 'free_lifetime', 'free_until', 'percent_discount', 'fixed_discount'));
exception when duplicate_object then null; end $$;

-- Audit trail: who changed an override, when, and the before/after snapshot.
-- Append-only; platform-admin API is the only writer.
create table if not exists public.billing_override_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_email text null,
  action text not null,
  reason text null,
  previous jsonb null,
  next jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists billing_override_audit_company_idx
  on public.billing_override_audit(company_id, created_at desc);

alter table public.billing_override_audit enable row level security;
-- No policies: only the service-role admin client (which bypasses RLS) may read
-- or write this table. Company members can never see it.
