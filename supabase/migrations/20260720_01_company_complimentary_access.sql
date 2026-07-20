-- ============================================================================
-- Company-level complimentary access entitlement.
--
-- A first-class, COMPANY-scoped entitlement for granting full access without a
-- Stripe subscription or trial. Access is granted to the company (and therefore
-- every one of its members) rather than to an individual email, so a person's
-- access never depends on which user happens to be logged in.
--
-- Evaluated server-side in getCompanyBillingStatus() alongside Stripe status and
-- the existing billing overrides. A complimentary company is `is_active`, so it
-- is never redirected to Stripe checkout. Regular companies are unaffected and
-- still require an active trial or paid subscription.
--
--   complimentary_access            -> when true, full access without Stripe.
--   complimentary_access_reason     -> INTERNAL note explaining WHY billing is
--                                      bypassed. Admin/audit only; never shown
--                                      to employees by the billing-status API.
--   complimentary_access_granted_at -> when access was granted (audit trail).
-- ============================================================================

alter table public.companies
  add column if not exists complimentary_access boolean not null default false,
  add column if not exists complimentary_access_reason text null,
  add column if not exists complimentary_access_granted_at timestamptz null;

-- Seed the two known complimentary companies by their OWNER'S email. Email is
-- used ONCE here, at migration time, purely to resolve the correct company —
-- runtime billing gates never compare emails. This no-ops in environments where
-- the user does not exist (local/dev/preview), so the migration is safe to run
-- everywhere.
do $$
declare
  target record;
  company_id_to_grant uuid;
begin
  for target in
    select *
    from (values
      ('wiedf03@gmail.com',   'Founding complimentary access (company owner wiedf03@gmail.com).'),
      ('jaden@cladlinesw.com', 'Partner complimentary access (company owner jaden@cladlinesw.com).')
    ) as t(email, reason)
  loop
    -- Prefer the company the user OWNS (admin membership); fall back to any
    -- company they belong to. Matches the intent: "if they belong to an existing
    -- company, make that company complimentary."
    select m.company_id
      into company_id_to_grant
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where lower(u.email) = target.email
    order by (m.role = 'admin') desc
    limit 1;

    if company_id_to_grant is not null then
      update public.companies
         set complimentary_access = true,
             complimentary_access_reason = target.reason,
             complimentary_access_granted_at = now()
       where id = company_id_to_grant;
    end if;
  end loop;
end $$;
