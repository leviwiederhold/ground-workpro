-- ============================================================================
-- Track message edits: an "edited" indicator that persists across refreshes.
-- edited_at is null for never-edited messages; set to now() when a sender edits
-- their own message (enforced server-side in the PATCH route). The UI shows the
-- edited time + an "edited" marker when edited_at is present.
-- ============================================================================

alter table public.messages
  add column if not exists edited_at timestamptz null;
