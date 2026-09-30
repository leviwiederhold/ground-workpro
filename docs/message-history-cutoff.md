# Company Message History Cutoff

New non-admin memberships can read company messages created at or after their
database-assigned membership `created_at` timestamp. The cutoff is inclusive.
The browser and API do not accept a join date from the user. A database trigger
replaces caller-supplied membership creation times and records the matching
`message_history_cutoff_at` value.

Memberships that existed when this migration is applied keep a `NULL` cutoff,
which preserves their existing history access. Owner, co-owner, and
administrator roles retain the history access already granted by the current
thread participation model. Direct and group threads remain participant-scoped.

The cutoff applies to message rows, inbox previews/counts/unread totals,
attachment metadata and Storage reads, old-message edits/deletes, message
notifications, and queued push delivery. Realtime `messages` reads use the same
RLS policy. The preserved legacy channel-message table is also guarded for
direct PostgREST reads. The inbox can show an empty conversation shell until a message at or
after the employee's cutoff exists; older preview text, counts, and timestamps
are omitted. The current app has no message-text search or threaded replies; if
those are added, they must filter by the same cutoff before returning text or
previews. Existing message rows and attachment objects are not changed.

## Deployment

Apply `supabase/migrations/20260929_01_company_message_history_cutoff.sql`
before deploying the application code. The migration adds a nullable membership
column (existing rows remain null), installs a database trigger, and updates
RLS policies. It does not rewrite or delete messages. Deploy the app after the
migration so service-role inbox, attachment, notification-fallback, and push
paths also apply the boundary.

Previously issued signed attachment URLs remain usable until they expire; the
cutoff prevents new URLs and direct Storage reads after policy deployment.
Push notifications already delivered to a device cannot be recalled; queued
push jobs are checked against the membership cutoff before delivery.
