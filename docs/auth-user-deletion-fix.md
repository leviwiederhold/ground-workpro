# Fix: "Failed to delete user: Database error deleting user"

## 1. Root cause

Deleting a user from **Supabase Auth → Users** removes a row from `auth.users`.
Several tables hold foreign keys pointing at `auth.users(id)`. Any such FK created
with the default **`ON DELETE NO ACTION`** (RESTRICT) blocks the delete whenever a
dependent row exists — GoTrue surfaces this generically as
*"Database error deleting user."*

### Foreign keys referencing `auth.users`

Audited from `supabase/migrations/**` plus live introspection of the project
(`ucyalowqzvkybnfgucem`). Two groups:

**Already safe (defined in migrations):**

| Behavior | Columns |
|---|---|
| `ON DELETE CASCADE` | `notifications.user_id`, `time_entries.user_id`, `module_permissions.user_id`, `message_channel_members.user_id`, `messages.sender_user_id`, `dm_threads.dm_user_a/b`, `dm_threads.created_by`, `training_video_progress.user_id`, `onboarding_checklist.user_id`, `work_order_feedback.user_id`, `invite_tokens.created_by`, `pending_invitations.invited_by` |
| `ON DELETE SET NULL` | `module_permissions.created_by`, `pending_invitations.accepted_user_id`, `bids.owner_user_id`, `bid_estimate_versions.created_by`, `audit_logs.actor_user_id`, `message_channels.created_by` |

**The blockers (base-schema tables created via the dashboard, *not* in migrations):**

| Table.column | Was | Now |
|---|---|---|
| `profiles.id` | `NO ACTION` | `CASCADE` |
| `memberships.user_id` | `NO ACTION` | `CASCADE` |
| `employees.user_id` | `NO ACTION` | `CASCADE` |

Live probe on a seeded test user confirmed it had rows in `memberships`,
`employees`, and `notifications`. `notifications` already cascades, so
`memberships` and `employees` (plus `profiles` for users that have one) were the
constraints blocking deletion.

> Note: `companies` has **no owner column** — ownership is expressed by a
> `memberships` row with an admin role. So companies never directly block an
> `auth.users` delete.

## 2. Which constraint blocks deletion

Whichever of `profiles.id` / `memberships.user_id` / `employees.user_id` still
has a row for that user — all three defaulted to `NO ACTION`. Run section (A) of
`20260601_03_auth_user_deletion_VERIFY.sql` to see the exact list; any row
showing `NO ACTION`/`RESTRICT` is a blocker.

## 3. Employees vs. company owners

- **Employees / non-owners:** their per-user rows should disappear with the
  account → all identity FKs set to `ON DELETE CASCADE`. Deletion just works.
- **Company owners (admin membership on an active/trialing company):** must NOT
  be silently deletable, or the company would be left ownerless while still
  billing. A `BEFORE DELETE` trigger on `auth.users` blocks deletion with a clear
  message until ownership is transferred or the subscription ends.

## 4. What the migration does

`supabase/migrations/20260601_03_auth_user_deletion_fks.sql`:

1. **Dynamic FK normalization** — a `DO` block iterates over *every* single-column
   FK in schema `public` that references `auth.users(id)` and recreates it with
   the correct `ON DELETE` action (no constraint names hard-coded):
   - actor/creator/audit columns (`created_by`, `actor_user_id`, `owner_user_id`,
     `accepted_user_id`, `invited_by`) → `SET NULL` when nullable;
   - all other (identity / per-user) columns → `CASCADE`.
   It skips constraints that already have the desired action, so it is idempotent
   and only touches schema `public` (auth/storage/realtime are left alone).
2. **Owner protection** — `public.prevent_active_company_owner_deletion()` +
   `BEFORE DELETE` trigger on `auth.users` raises if the user is an admin of an
   `active`/`trialing` company.

Not touched: Stripe/billing logic, seat-quantity sync, the invite flow, and auth
providers.

## 5. How to apply

This DDL must run with database privileges (the service-role API key cannot run
DDL). Apply it one of these ways:

- **Supabase Dashboard → SQL Editor:** paste the contents of
  `20260601_03_auth_user_deletion_fks.sql` and run.
- **Supabase CLI:** `supabase db push` (or include it in your migration deploy).

## 6. Verify

1. Run `20260601_03_auth_user_deletion_VERIFY.sql` section (A): **no** row should
   read `NO ACTION` / `RESTRICT` anymore.
2. Section (B): the `trg_prevent_active_company_owner_deletion` trigger is listed.
3. **Dashboard → Authentication → Users:**
   - Delete a non-owner / employee account → succeeds; their `profiles`,
     `memberships`, `employees`, `notifications`, etc. rows are removed
     automatically.
   - Try to delete an owner of an active company → blocked with
     *"Cannot delete user …: they still own an active company …"*. Cancel the
     subscription or transfer the admin membership, then deletion succeeds.

## 7. Rollback

To revert the owner guard: `drop trigger trg_prevent_active_company_owner_deletion
on auth.users;` and `drop function public.prevent_active_company_owner_deletion();`.
The FK `ON DELETE` actions are safe to leave in place (they are the standard,
correct behavior); reverting them to `NO ACTION` would simply re-introduce the
bug.
