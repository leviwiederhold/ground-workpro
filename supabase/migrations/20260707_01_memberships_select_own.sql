-- ============================================================================
-- Root-cause fix for the protected-API 403 storm: guarantee every user can read
-- their OWN membership row via RLS. If this SELECT policy is missing/broken, the
-- membership-role lookup returns nothing → getEffectiveRole is null → every
-- guarded module API returns 403 for a valid member (CEO/co-CEO included), even
-- though auth succeeds.
--
-- This policy is permissive and non-recursive (references only auth.uid(), never
-- memberships itself), so it cannot cause RLS recursion. It is additive — other
-- existing policies still apply (RLS SELECT is the OR of all policies).
-- ============================================================================

alter table public.memberships enable row level security;

drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own"
  on public.memberships
  for select
  using (user_id = auth.uid());
